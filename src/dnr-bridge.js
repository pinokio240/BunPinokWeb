import http from 'node:http';
import { session } from 'electron';

const BRIDGE_PORT = 33123;

function globToRegex(pattern) {
    let out = '^';
    for (const ch of pattern) {
        if (ch === '*') {
            out += '.*';
        } else if (ch === '^') {
            out += '[^A-Za-z0-9_\\-\\.]';
        } else {
            out += ch.replace(/[.*+?${}()|[\]\\]/g, '\\$&');
        }
    }
    return out + '$';
}

function getInitiatorDomain(details) {
    let origin = '';
    if (details.referrer) {
        try {
            origin = new URL(details.referrer).origin;
        } catch (err) {
            origin = '';
        }
    }
    if (!origin && details.webContents && !details.webContents.isDestroyed()) {
        try {
            origin = new URL(details.webContents.getURL()).origin;
        } catch (err) {
            origin = '';
        }
    }
    if (origin.startsWith('chrome-extension://')) {
        return origin.replace('chrome-extension://', '').split('/')[0];
    }
    if (origin.startsWith('http://') || origin.startsWith('https://')) {
        try {
            return new URL(origin).hostname;
        } catch (err) {
            return origin;
        }
    }
    return origin;
}

function domainMatches(host, domainList) {
    for (const domain of domainList) {
        if (host === domain) {
            return true;
        }
        if (host.endsWith('.' + domain)) {
            return true;
        }
    }
    return false;
}

export class DnrBridge {
    constructor() {
        this.rules = [];
        this._startServer();
        this._setupWebRequest();
    }

    _startServer() {
        const server = http.createServer((req, res) => {
            if (req.method !== 'POST' || req.url !== '/rules') {
                res.writeHead(404);
                res.end();
                return;
            }
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body);
                    this._applyRules(payload);
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end('{}');
                } catch (err) {
                    res.writeHead(400);
                    res.end();
                }
            });
        });
        server.on('error', (err) => {
            console.error('DNR мост не запустился:', err.message);
        });
        server.listen(BRIDGE_PORT, '127.0.0.1');
    }

    _applyRules(payload) {
        const removeRuleIds = Array.isArray(payload.removeRuleIds) ? payload.removeRuleIds : [];
        const addRules = Array.isArray(payload.addRules) ? payload.addRules : [];
        if (removeRuleIds.length > 0) {
            this.rules = this.rules.filter((rule) => {
                return !removeRuleIds.includes(rule.id);
            });
        }
        for (const rule of addRules) {
            if (!rule || !rule.id) {
                continue;
            }
            this.rules = this.rules.filter((existing) => {
                return existing.id !== rule.id;
            });
            this.rules.push(rule);
        }
        console.log('DNR мост: правил активных — ' + this.rules.length);
    }

    _setupWebRequest() {
        session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
            const headers = {};
            for (const key of Object.keys(details.requestHeaders)) {
                headers[key] = details.requestHeaders[key];
            }
            for (const rule of this.rules) {
                if (!this._matches(details, rule.condition)) {
                    continue;
                }
                if (rule.action && rule.action.type === 'modifyHeaders' && Array.isArray(rule.action.requestHeaders)) {
                    for (const op of rule.action.requestHeaders) {
                        if (op.operation === 'set') {
                            headers[op.header] = op.value;
                        } else if (op.operation === 'remove') {
                            delete headers[op.header];
                        } else if (op.operation === 'append') {
                            const current = headers[op.header];
                            if (current) {
                                headers[op.header] = current + ', ' + op.value;
                            } else {
                                headers[op.header] = op.value;
                            }
                        }
                    }
                }
            }
            callback({ requestHeaders: headers });
        });

        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            const responseHeaders = details.responseHeaders || {};
            for (const rule of this.rules) {
                if (!this._matches(details, rule.condition)) {
                    continue;
                }
                if (rule.action && rule.action.type === 'modifyHeaders' && Array.isArray(rule.action.responseHeaders)) {
                    for (const op of rule.action.responseHeaders) {
                        if (op.operation === 'set') {
                            responseHeaders[op.header] = [op.value];
                        } else if (op.operation === 'remove') {
                            delete responseHeaders[op.header];
                        }
                    }
                }
            }
            callback({ responseHeaders: responseHeaders });
        });
    }

    _matches(details, condition) {
        if (!condition) {
            return false;
        }
        if (condition.urlFilter) {
            const regex = new RegExp(globToRegex(condition.urlFilter));
            if (!regex.test(details.url)) {
                return false;
            }
        }
        if (condition.regexFilter) {
            try {
                const regex = new RegExp(condition.regexFilter);
                if (!regex.test(details.url)) {
                    return false;
                }
            } catch (err) {
                return false;
            }
        }
        if (condition.resourceTypes && Array.isArray(condition.resourceTypes)) {
            if (!condition.resourceTypes.includes(details.resourceType)) {
                return false;
            }
        }
        const initiator = getInitiatorDomain(details);
        if (condition.initiatorDomains && Array.isArray(condition.initiatorDomains) && condition.initiatorDomains.length > 0) {
            if (!domainMatches(initiator, condition.initiatorDomains)) {
                return false;
            }
        }
        if (condition.excludedInitiatorDomains && Array.isArray(condition.excludedInitiatorDomains)) {
            if (domainMatches(initiator, condition.excludedInitiatorDomains)) {
                return false;
            }
        }
        return true;
    }
}

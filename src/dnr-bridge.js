import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { app, session } from 'electron';

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
    constructor(settingsStore) {
        this.settingsStore = settingsStore;
        this.rules = [];
        this.downloads = [];
        this.nextDownloadId = 1;
        this.logger = null;
        this._startServer();
        this._setupWebRequest();
    }

    setLogger(logger) {
        this.logger = logger;
    }

    _startServer() {
        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                try {
                    if (req.method === 'POST' && req.url === '/rules') {
                        const payload = JSON.parse(body);
                        this._applyRules(payload);
                        this._json(res, {});
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/download') {
                        const payload = JSON.parse(body);
                        const result = this._handleDownload(payload);
                        this._json(res, result);
                        return;
                    }
                    if (req.method === 'GET' && req.url === '/downloads-list') {
                        this._json(res, this.downloads);
                        return;
                    }
                    res.writeHead(404);
                    res.end();
                } catch (err) {
                    res.writeHead(400);
                    res.end();
                }
            });
        });
        server.on('error', (err) => {
            console.error('Мост расширений не запустился:', err.message);
        });
        server.listen(BRIDGE_PORT, '127.0.0.1');
    }

    _json(res, payload) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
    }

    _handleDownload(payload) {
        const filename = payload.filename || 'download.bin';
        const base64Data = payload.data || '';
        try {
            let dir = '';
            if (this.settingsStore) {
                dir = this.settingsStore.get('downloads.path', '');
            }
            let savePath = filename;
            if (dir) {
                savePath = path.join(dir, filename);
            } else {
                savePath = path.join(app.getPath('downloads'), filename);
            }
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(savePath, buffer);
            const id = this.nextDownloadId;
            this.nextDownloadId = this.nextDownloadId + 1;
            const record = {
                id: id,
                filename: filename,
                url: payload.url || '',
                state: 'complete',
                bytesReceived: buffer.length,
                totalBytes: buffer.length
            };
            this.downloads.unshift(record);
            if (this.downloads.length > 200) {
                this.downloads.pop();
            }
            if (this.logger) {
                this.logger.info('downloads', 'Расширение сохранило файл: ' + savePath + ' (' + buffer.length + ' байт)');
            }
            return { id: id };
        } catch (err) {
            if (this.logger) {
                this.logger.error('downloads', 'Не удалось сохранить файл расширения: ' + err.message);
            }
            return { id: 0, error: err.message };
        }
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

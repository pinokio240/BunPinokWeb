import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { app, session, BrowserWindow } from 'electron';

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

function matchPatternToRegex(pattern) {
    const parts = pattern.split('://');
    const scheme = parts[0];
    const rest = parts.length > 1 ? parts[1] : '';
    const slashIdx = rest.indexOf('/');
    const host = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;
    const pathPart = slashIdx >= 0 ? rest.slice(slashIdx) : '/*';
    const schemeRe = scheme === '*' ? '(https?|wss?)' : scheme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hostRe = host === '*' ? '[^/]+' : host.replace(/\*/g, '[^/]*').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pathRe = pathPart.replace(/\*/g, '.*').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + schemeRe + '://' + hostRe + pathRe);
}

function getInitiatorDomain(details) {    let origin = '';
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
        this.offscreenWindows = new Map();
        this.wrListeners = [];
        this.pendingQueries = [];
        this.wrAnswers = new Map();
        this.wrSeq = 0;
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
                    if (req.method === 'POST' && req.url === '/offscreen') {
                        const payload = JSON.parse(body);
                        this._createOffscreen(payload);
                        this._json(res, { success: true });
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/offscreen-close') {
                        const payload = JSON.parse(body);
                        this._closeOffscreen(payload.extId);
                        this._json(res, { success: true });
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/offscreen-has') {
                        const payload = JSON.parse(body);
                        const win = this.offscreenWindows.get(payload.extId);
                        const has = win !== undefined && !win.isDestroyed();
                        this._json(res, { has: has });
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/webrq-register') {
                        const payload = JSON.parse(body);
                        this._registerWebRequestListener(payload);
                        this._json(res, { success: true });
                        return;
                    }
                    if (req.method === 'GET' && req.url === '/webrq-pending') {
                        const delivered = this.pendingQueries.splice(0, this.pendingQueries.length);
                        this._json(res, delivered);
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/webrq-answer') {
                        const payload = JSON.parse(body);
                        this.wrAnswers.set(payload.queryId, payload.response);
                        this._json(res, { success: true });
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

    _createOffscreen(payload) {
        try {
            const key = payload.extId || payload.url;
            const existing = this.offscreenWindows.get(key);
            if (existing && !existing.isDestroyed()) {
                return;
            }
            const win = new BrowserWindow({
                show: false,
                width: 480,
                height: 400,
                skipTaskbar: true,
                webPreferences: {
                    session: session.defaultSession,
                    sandbox: true,
                    contextIsolation: true,
                    nodeIntegration: false
                }
            });
            win.webContents.setAudioMuted(false);
            win.loadURL(payload.url).catch(() => {});
            this.offscreenWindows.set(key, win);
            win.on('closed', () => {
                this.offscreenWindows.delete(key);
            });
            if (this.logger) {
                this.logger.info('offscreen', 'Создан скрытый offscreen-документ: ' + payload.url);
            }
        } catch (err) {
            if (this.logger) {
                this.logger.error('offscreen', 'Не удалось создать offscreen: ' + err.message);
            }
        }
    }

    _closeOffscreen(extId) {
        const win = this.offscreenWindows.get(extId);
        if (win && !win.isDestroyed()) {
            win.close();
        }
        this.offscreenWindows.delete(extId);
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

    _registerWebRequestListener(payload) {
        const listener = {
            listenerId: payload.listenerId,
            event: payload.event,
            urls: Array.isArray(payload.urls) ? payload.urls : [],
            types: Array.isArray(payload.types) ? payload.types : [],
            blocking: payload.blocking === true
        };
        this.wrListeners = this.wrListeners.filter((existing) => {
            return existing.listenerId !== listener.listenerId;
        });
        this.wrListeners.push(listener);
        if (this.logger) {
            this.logger.info('webRequest', 'Зарегистрирован слушатель ' + listener.event + ' (id=' + listener.listenerId + ', blocking=' + listener.blocking + ')');
        }
    }

    _matchesWrListener(listener, details) {
        if (listener.urls.length > 0) {
            let urlMatched = false;
            for (const pattern of listener.urls) {
                const regex = matchPatternToRegex(pattern);
                if (regex.test(details.url)) {
                    urlMatched = true;
                    break;
                }
            }
            if (!urlMatched) {
                return false;
            }
        }
        if (listener.types.length > 0 && !listener.types.includes(details.resourceType)) {
            return false;
        }
        return true;
    }

    _queryWebRequestListeners(event, details) {
        const matches = this.wrListeners.filter((listener) => {
            return listener.event === event && this._matchesWrListener(listener, details);
        });
        if (matches.length === 0) {
            return Promise.resolve(null);
        }
        const pending = [];
        for (const listener of matches) {
            const queryId = 'q-' + (++this.wrSeq);
            pending.push({
                queryId: queryId,
                listenerId: listener.listenerId,
                details: {
                    url: details.url,
                    method: details.method,
                    type: details.resourceType,
                    tabId: -1,
                    frameId: 0,
                    requestHeaders: details.requestHeaders || {},
                    responseHeaders: details.responseHeaders || {}
                }
            });
        }
        this.pendingQueries.push(...pending);
        return new Promise((resolve) => {
            const answers = {};
            const startedAt = Date.now();
            const check = () => {
                let allAnswered = true;
                for (const query of pending) {
                    const answer = this.wrAnswers.get(query.queryId);
                    if (answer !== undefined) {
                        answers[query.queryId] = answer;
                    } else {
                        allAnswered = false;
                    }
                }
                if (allAnswered || Date.now() - startedAt > 2500) {
                    resolve(answers);
                } else {
                    setTimeout(check, 40);
                }
            };
            check();
        });
    }

    _applyWebRequestAnswers(answers, callback, kind) {
        if (!answers) {
            callback({});
            return;
        }
        for (const key of Object.keys(answers)) {
            const response = answers[key];
            if (!response || typeof response !== 'object') {
                continue;
            }
            if (kind === 'request' && response.cancel === true) {
                callback({ cancel: true });
                return;
            }
            if (kind === 'request' && response.redirectUrl) {
                callback({ redirectURL: response.redirectUrl });
                return;
            }
        }
        callback({});
    }

    _setupWebRequest() {
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
            if (this.wrListeners.length === 0) {
                callback({});
                return;
            }
            this._queryWebRequestListeners('onBeforeRequest', details).then((answers) => {
                this._applyWebRequestAnswers(answers, callback, 'request');
            });
        });

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
            if (this.wrListeners.length === 0) {
                callback({ requestHeaders: headers });
                return;
            }
            this._queryWebRequestListeners('onBeforeSendHeaders', details).then((answers) => {
                if (answers) {
                    for (const key of Object.keys(answers)) {
                        const response = answers[key];
                        if (response && response.requestHeaders) {
                            for (const headerKey of Object.keys(response.requestHeaders)) {
                                const value = response.requestHeaders[headerKey];
                                if (value === null || value === undefined) {
                                    delete headers[headerKey];
                                } else {
                                    headers[headerKey] = value;
                                }
                            }
                        }
                        if (response && response.cancel === true) {
                            callback({ cancel: true });
                            return;
                        }
                    }
                }
                callback({ requestHeaders: headers });
            });
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

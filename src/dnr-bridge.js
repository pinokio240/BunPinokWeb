import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { app, session, BrowserWindow, screen, globalShortcut, net, dialog } from 'electron';

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

function getInitiatorDomain(details) {
    let origin = '';
    if (details.referrer && details.referrer !== 'null') {
        try {
            origin = new URL(details.referrer).origin;
        } catch (err) {
            origin = '';
        }
    }
    if ((!origin || origin === 'null') && details.webContents && !details.webContents.isDestroyed()) {
        try {
            origin = new URL(details.webContents.getURL()).origin;
        } catch (err) {
            origin = '';
        }
    }
    if (!origin || origin === 'null') {
        return 'chrome-extension-unknown';
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
        if (domain === 'chrome-extension') {
            if (/^[a-p]{32}$/.test(host) || host === 'chrome-extension-unknown') {
                return true;
            }
            continue;
        }
        if (host === domain) {
            return true;
        }
        if (host.endsWith('.' + domain)) {
            return true;
        }
    }
    return false;
}

const BUILTIN_VK_RULES = [
    {
        id: 9001,
        action: {
            type: 'modifyHeaders',
            requestHeaders: [
                { header: 'origin', operation: 'set', value: 'https://m.vk.ru' },
                { header: 'referer', operation: 'set', value: 'https://m.vk.ru/' }
            ]
        },
        condition: { urlFilter: 'https://login.vk.ru/*act=web_token*', initiatorDomains: ['chrome-extension'] }
    },
    {
        id: 9002,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'set', value: 'https://vk.ru/' }] },
        condition: { urlFilter: 'https://api.vk.ru/*', initiatorDomains: ['chrome-extension'] }
    },
    {
        id: 9003,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'set', value: 'https://vk.ru/' }] },
        condition: { urlFilter: 'https://vk.ru/al_audio.php*', initiatorDomains: ['chrome-extension'] }
    }
];

export class DnrBridge {
    constructor(settingsStore) {
        this.settingsStore = settingsStore;
        this.rules = [];
        this._dnrLogged = new Set();
        for (const rule of BUILTIN_VK_RULES) {
            this.rules.push(rule);
        }
        this.downloads = [];
        this.nextDownloadId = 1;
        this.logger = null;
        this.offscreenWindows = new Map();
        this.wrListeners = [];
        this.pendingQueries = [];
        this.wrAnswers = new Map();
        this.wrSeq = 0;
        this.pendingCommands = [];
        this.identityLaunches = new Map();
        this.identityResults = new Map();
        this.identitySeq = 0;
        this.beforeRequestHandlers = [];
        this.beforeSendHeadersHandlers = [];
        this.beforeRequestHandlers.push((details) => {
            if (details.url.startsWith('https://cdn.ghostery.com/')) {
                return { redirectURL: 'https://ghostery-cdn.b-cdn.net/' + details.url.slice('https://cdn.ghostery.com/'.length) };
            }
            return null;
        });
        this.context = null;
        this._startServer();
        this._setupWebRequest();
    }

    addOnBeforeRequestHandler(fn) {
        this.beforeRequestHandlers.push(fn);
    }

    addOnBeforeSendHeadersHandler(fn) {
        this.beforeSendHeadersHandlers.push(fn);
    }

    setContext(context) {
        this.context = context;
    }

    setLogger(logger) {
        this.logger = logger;
    }

    _startServer() {
        const server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                try {
                    const origin = req.headers.origin || '';
                    const isExtensionOrigin = origin.startsWith('chrome-extension://');
                    const isFsRoute = req.url.indexOf('/fs-') === 0;
                    if (isFsRoute) {
                        if (!isExtensionOrigin && !this._fsOriginAllowed(origin)) {
                            res.writeHead(403);
                            res.end();
                            return;
                        }
                    } else if (!isExtensionOrigin) {
                        res.writeHead(403);
                        res.end();
                        return;
                    }
                    if (this.logger && req.url !== '/webrq-pending' && req.url !== '/commands-pending') {
                        this.logger.info('bridge', req.method + ' ' + req.url + (body ? ' ' + body.slice(0, 200) : ''));
                    }
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
                    if (req.method === 'POST' && req.url === '/bm-gettree') {
                        this._json(res, this._bookmarksTree());
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/bm-create') {
                        const payload = JSON.parse(body);
                        this._json(res, this._bookmarkCreate(payload));
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/bm-remove') {
                        const payload = JSON.parse(body);
                        this._json(res, this._bookmarkRemove(payload));
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/bm-search') {
                        const payload = JSON.parse(body);
                        this._json(res, this._bookmarkSearch(payload));
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/hist-search') {
                        const payload = JSON.parse(body);
                        this._json(res, this._historySearch(payload));
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/hist-add') {
                        const payload = JSON.parse(body);
                        this._json(res, this._historyAdd(payload));
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/hist-del') {
                        const payload = JSON.parse(body);
                        this._json(res, this._historyDelete(payload));
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/hist-delall') {
                        this._json(res, this._historyDeleteAll());
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/browsingdata') {
                        const payload = JSON.parse(body);
                        this._json(res, this._browsingData(payload));
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/topsites') {
                        this._json(res, this._topSites());
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/search') {
                        const payload = JSON.parse(body);
                        this._json(res, this._openSearch(payload));
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/sysdisplay') {
                        this._json(res, this._systemDisplay());
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/sessions') {
                        this._json(res, []);
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/cs-get') {
                        const payload = JSON.parse(body);
                        this._json(res, this._contentSettingGet(payload));
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/cs-set') {
                        const payload = JSON.parse(body);
                        this._json(res, this._contentSettingSet(payload));
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/proxy-get') {
                        this._json(res, this._proxyGet());
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/proxy-set') {
                        const payload = JSON.parse(body);
                        this._json(res, this._proxySet(payload));
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/commands-register') {
                        const payload = JSON.parse(body);
                        this._registerCommands(payload);
                        this._json(res, { success: true });
                        return;
                    }
                    if (req.method === 'GET' && req.url === '/commands-pending') {
                        const delivered = this.pendingCommands.splice(0, this.pendingCommands.length);
                        this._json(res, delivered);
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/identity-token') {
                        const payload = JSON.parse(body);
                        this._identityToken(payload).then((result) => {
                            this._json(res, result);
                        }).catch((err) => {
                            this._json(res, { success: false, error: err.message });
                        });
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/identity-launch') {
                        const payload = JSON.parse(body);
                        this._json(res, this._identityLaunch(payload));
                        return;
                    }
                    if (req.method === 'GET' && req.url.indexOf('/identity-result') === 0) {
                        const parsed = new URL(req.url, 'http://127.0.0.1:33123');
                        const launchId = parsed.searchParams.get('launchId') || '';
                        this._json(res, this._identityResult(launchId));
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/storage-get') {
                        const payload = JSON.parse(body);
                        const extId = payload.extId || '';
                        const area = payload.area || 'local';
                        const data = this._storageLoad(extId, area);
                        const keys = payload.payload && Array.isArray(payload.payload.keys) ? payload.payload.keys : null;
                        if (keys === null) {
                            this._json(res, { data: data });
                        } else {
                            const out = {};
                            for (const key of keys) {
                                if (typeof data[key] !== 'undefined') {
                                    out[key] = data[key];
                                }
                            }
                            this._json(res, { data: out });
                        }
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/storage-set') {
                        const payload = JSON.parse(body);
                        const extId = payload.extId || '';
                        const area = payload.area || 'local';
                        const data = this._storageLoad(extId, area);
                        const items = payload.payload && payload.payload.items ? payload.payload.items : {};
                        for (const key of Object.keys(items)) {
                            data[key] = items[key];
                        }
                        this._storageSave(extId, area, data);
                        this._json(res, { success: true });
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/storage-remove') {
                        const payload = JSON.parse(body);
                        const extId = payload.extId || '';
                        const area = payload.area || 'local';
                        const data = this._storageLoad(extId, area);
                        const keys = payload.payload && Array.isArray(payload.payload.keys) ? payload.payload.keys : [];
                        for (const key of keys) {
                            delete data[key];
                        }
                        this._storageSave(extId, area, data);
                        this._json(res, { success: true });
                        return;
                    }
                    if (req.method === 'POST' && req.url === '/storage-clear') {
                        const payload = JSON.parse(body);
                        const extId = payload.extId || '';
                        const area = payload.area || 'local';
                        this._storageSave(extId, area, {});
                        this._json(res, { success: true });
                        return;
                    }
                    if (req.method === 'POST' && req.url.indexOf('/fs-') === 0) {
                        const origin = req.headers.origin || '';
                        if (!this._fsOriginAllowed(origin)) {
                            this._json(res, { success: false, error: 'origin not allowed' });
                            return;
                        }
                        const payload = JSON.parse(body);
                        if (req.url === '/fs-pick') {
                            this._json(res, this._fsPick(payload));
                            return;
                        }
                        if (req.url === '/fs-write') {
                            this._json(res, this._fsWrite(payload));
                            return;
                        }
                        if (req.url === '/fs-read') {
                            this._json(res, this._fsRead(payload));
                            return;
                        }
                        if (req.url === '/fs-mkdir') {
                            this._json(res, this._fsMkdir(payload));
                            return;
                        }
                        if (req.url === '/fs-remove') {
                            this._json(res, this._fsRemove(payload));
                            return;
                        }
                        this._json(res, { success: false, error: 'unknown fs op' });
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
                    nodeIntegration: false,
                    autoplayPolicy: 'no-user-gesture-required'
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

    _bookmarksTree() {
        const bookmarkStore = this.context && this.context.bookmarkStore ? this.context.bookmarkStore : null;
        if (!bookmarkStore) {
            return [{ id: '0', title: '', children: [] }];
        }
        const children = bookmarkStore.getAll().map((bookmark, index) => {
            return { id: 'bm-' + index, title: bookmark.title || bookmark.url, url: bookmark.url };
        });
        return [{ id: '0', title: '', children: children }];
    }

    _bookmarkCreate(payload) {
        const bookmarkStore = this.context && this.context.bookmarkStore ? this.context.bookmarkStore : null;
        if (!bookmarkStore) {
            return {};
        }
        const url = payload.url || '';
        const title = payload.title || url;
        bookmarkStore.add(url, title);
        if (this.context && this.context.broadcastBookmarks) {
            this.context.broadcastBookmarks();
        }
        return { id: url, url: url, title: title };
    }

    _bookmarkRemove(payload) {
        const bookmarkStore = this.context && this.context.bookmarkStore ? this.context.bookmarkStore : null;
        if (!bookmarkStore) {
            return { success: false };
        }
        bookmarkStore.removeByUrl(payload.url || payload.id || '');
        if (this.context && this.context.broadcastBookmarks) {
            this.context.broadcastBookmarks();
        }
        return { success: true };
    }

    _bookmarkSearch(payload) {
        const bookmarkStore = this.context && this.context.bookmarkStore ? this.context.bookmarkStore : null;
        if (!bookmarkStore) {
            return [];
        }
        const query = (payload.query || '').toLowerCase();
        return bookmarkStore.getAll().filter((bookmark) => {
            return bookmark.url.toLowerCase().includes(query) || bookmark.title.toLowerCase().includes(query);
        }).map((bookmark, index) => {
            return { id: 'bm-' + index, title: bookmark.title || bookmark.url, url: bookmark.url };
        });
    }

    _historySearch(payload) {
        const historyStore = this.context && this.context.historyStore ? this.context.historyStore : null;
        if (!historyStore) {
            return [];
        }
        const text = payload.text || '';
        return historyStore.search(text).slice(0, 500).map((entry, index) => {
            return { id: 'h-' + index, url: entry.url, title: entry.title, lastVisitTime: entry.timestamp };
        });
    }

    _historyAdd(payload) {
        const historyStore = this.context && this.context.historyStore ? this.context.historyStore : null;
        if (!historyStore) {
            return { success: false };
        }
        historyStore.add(payload.url || '', payload.title || '');
        return { success: true };
    }

    _historyDelete(payload) {
        const historyStore = this.context && this.context.historyStore ? this.context.historyStore : null;
        if (!historyStore) {
            return { success: false };
        }
        historyStore.removeByUrl(payload.url || '');
        return { success: true };
    }

    _historyDeleteAll() {
        const historyStore = this.context && this.context.historyStore ? this.context.historyStore : null;
        if (historyStore) {
            historyStore.clear();
        }
        return { success: true };
    }

    _browsingData(payload) {
        const options = payload || {};
        if (options.cookies || options.cache || options.localStorage) {
            const storages = [];
            if (options.cookies) {
                storages.push('cookies');
            }
            if (options.localStorage) {
                storages.push('localstorage');
            }
            if (storages.length > 0) {
                session.defaultSession.clearStorageData({ storages: storages });
            }
            if (options.cache) {
                session.defaultSession.clearCache();
            }
        }
        if (options.history && this.context && this.context.historyStore) {
            this.context.historyStore.clear();
        }
        return { success: true };
    }

    _topSites() {
        const historyStore = this.context && this.context.historyStore ? this.context.historyStore : null;
        if (!historyStore) {
            return [];
        }
        const domainCounts = new Map();
        for (const entry of historyStore.getAll()) {
            try {
                const hostname = new URL(entry.url).hostname;
                domainCounts.set(hostname, (domainCounts.get(hostname) || 0) + 1);
            } catch (err) {
                // пропуск некорректных URL
            }
        }
        const sorted = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
        return sorted.map(([hostname]) => {
            return { title: hostname, url: 'https://' + hostname };
        });
    }

    _openSearch(payload) {
        const tabManager = this.context && this.context.tabManager ? this.context.tabManager : null;
        if (!tabManager) {
            return { success: false };
        }
        const query = payload.query || '';
        const engine = this.settingsStore ? this.settingsStore.get('search.engine', 'google') : 'google';
        const engines = {
            google: 'https://www.google.com/search?q=',
            yandex: 'https://yandex.ru/search/?text=',
            bing: 'https://www.bing.com/search?q=',
            duckduckgo: 'https://duckduckgo.com/?q='
        };
        const base = engines[engine] || engines.google;
        tabManager.createTab(base + encodeURIComponent(query));
        if (this.context && this.context.updateBounds) {
            this.context.updateBounds();
        }
        return { success: true };
    }

    _systemDisplay() {
        try {
            return screen.getAllDisplays().map((display, index) => {
                return {
                    id: String(index),
                    name: 'Дисплей ' + (index + 1),
                    bounds: display.bounds,
                    workArea: display.workArea,
                    isPrimary: display.id === screen.getPrimaryDisplay().id
                };
            });
        } catch (err) {
            return [];
        }
    }

    _contentSettingGet(payload) {
        if (!this.settingsStore) {
            return { setting: 'allow' };
        }
        const type = payload.type || '';
        const primaryUrl = payload.primaryUrl || '';
        let host = '';
        try {
            host = new URL(primaryUrl).hostname;
        } catch (err) {
            host = '';
        }
        const permissionMap = {
            notifications: 'privacy.notifications',
            geolocation: 'privacy.geolocation',
            camera: 'privacy.camera',
            microphone: 'privacy.microphone',
            javascript: 'javascript',
            popups: 'privacy.popups',
            cookies: 'cookies'
        };
        const settingKey = permissionMap[type];
        if (settingKey === 'javascript') {
            return { setting: 'allow' };
        }
        if (settingKey === 'cookies') {
            return { setting: 'allow' };
        }
        if (settingKey && host) {
            const sitePermissions = this.settingsStore.get('privacy.sitePermissions', {});
            if (sitePermissions && sitePermissions[host] && typeof sitePermissions[host][type] === 'string') {
                const value = sitePermissions[host][type];
                if (value === 'ask') {
                    return { setting: 'ask' };
                }
                return { setting: value === 'allow' ? 'allow' : 'block' };
            }
        }
        if (settingKey) {
            const value = this.settingsStore.get(settingKey, 'allow');
            if (value === 'ask') {
                return { setting: 'ask' };
            }
            return { setting: value === 'allow' ? 'allow' : 'block' };
        }
        return { setting: 'allow' };
    }

    _contentSettingSet(payload) {
        if (!this.settingsStore) {
            return { success: false };
        }
        const type = payload.type || '';
        const primaryUrl = payload.primaryUrl || '';
        const value = payload.value || 'allow';
        let host = '';
        try {
            host = new URL(primaryUrl).hostname;
        } catch (err) {
            host = '';
        }
        if (!host) {
            return { success: false };
        }
        const sitePermissions = this.settingsStore.get('privacy.sitePermissions', {});
        const copy = {};
        for (const key of Object.keys(sitePermissions)) {
            copy[key] = sitePermissions[key];
        }
        if (!copy[host]) {
            copy[host] = {};
        }
        copy[host][type] = value === 'block' ? 'block' : 'allow';
        this.settingsStore.set('privacy.sitePermissions', copy);
        return { success: true };
    }

    _proxyGet() {
        if (!this.settingsStore) {
            return { value: { mode: 'system' } };
        }
        return { value: { mode: this.settingsStore.get('system.proxyMode', 'system') } };
    }

    _proxySet(payload) {
        if (!this.settingsStore) {
            return { success: false };
        }
        const value = payload.value || {};
        const mode = value.mode === 'fixed_servers' || value.mode === 'direct' ? value.mode : 'system';
        this.settingsStore.set('system.proxyMode', mode);
        if (this.context && this.context.applyProxy) {
            this.context.applyProxy();
        }
        return { success: true };
    }

    _registerCommands(payload) {
        const extId = payload.extId || '';
        const commands = payload.commands || {};
        try {
            for (const name of Object.keys(commands)) {
                const command = commands[name];
                if (!command || !command.global) {
                    continue;
                }
                const suggestedKey = command.suggested_key;
                const accelerator = suggestedKey ? (suggestedKey.default || suggestedKey.windows) : '';
                if (!accelerator) {
                    continue;
                }
                const accelKey = accelerator.replace(/\s+/g, '');
                try {
                    globalShortcut.register(accelKey, () => {
                        this.pendingCommands.push({ extId: extId, name: name, shortcut: accelerator });
                    });
                    if (this.logger) {
                        this.logger.info('commands', 'Глобальная клавиша зарегистрирована: ' + accelerator + ' (' + name + ')');
                    }
                } catch (regErr) {
                    if (this.logger) {
                        this.logger.warn('commands', 'Не удалось зарегистрировать ' + accelerator + ': ' + regErr.message);
                    }
                }
            }
        } catch (err) {
            if (this.logger) {
                this.logger.error('commands', 'Ошибка регистрации команд: ' + err.message);
            }
        }
    }

    async _identityToken(payload) {
        const appId = payload && payload.appId ? payload.appId : 6287487;
        const cookiePairs = new Map();
        const cookieDomains = [
            'https://vk.ru', 'https://m.vk.ru', 'https://login.vk.ru',
            'https://id.vk.ru', 'https://web.api.vk.ru',
            'https://vk.com', 'https://login.vk.com'
        ];
        for (const domain of cookieDomains) {
            try {
                const cookies = await session.defaultSession.cookies.get({ url: domain });
                for (const cookie of cookies) {
                    if (cookie.name && cookie.value) {
                        cookiePairs.set(cookie.name, cookie.value);
                    }
                }
            } catch (err) {
                // cookie read не критичен
            }
        }
        const cookieHeader = [];
        for (const entry of cookiePairs.entries()) {
            cookieHeader.push(entry[0] + '=' + entry[1]);
        }

        const strategies = [
            { origin: 'https://m.vk.ru', referer: 'https://m.vk.ru/', url: null, label: 'mweb' },
            { origin: 'https://id.vk.ru', referer: 'https://id.vk.ru/', url: null, label: 'id' },
            { origin: 'https://login.vk.ru', referer: 'https://login.vk.ru/', url: null, label: 'login' },
            { origin: null, referer: 'https://m.vk.ru/', url: null, label: 'no-origin' },
            { origin: null, referer: 'https://m.vk.ru/', url: 'https://login.vk.ru/?act=web_token&app_id=' + appId + '&version=1&origin=m.vk.ru', label: 'query-param' },
            { origin: 'https://id.vk.com', referer: 'https://id.vk.com/', url: 'https://login.vk.com/?act=web_token&app_id=' + appId + '&version=1', label: 'com-endpoint' }
        ];

        const errors = [];
        for (const strategy of strategies) {
            const result = await this._postWebToken(appId, strategy, cookieHeader.join('; '));
            if (result.success) {
                if (this.logger) {
                    this.logger.info('identity', 'web_token получен (' + strategy.label + ', user_id=' + (result.userId || '?') + ')');
                }
                return result;
            }
            errors.push(strategy.label + ': ' + result.error);
        }
        if (this.logger) {
            this.logger.error('identity', 'web_token: все Origin-стратегии не сработали — ' + errors.join(' | '));
        }
        return { success: false, error: errors.join(' | ') };
    }

    _postWebToken(appId, strategy, cookieHeader) {
        return new Promise((resolve) => {
            const urlStr = strategy.url || ('https://login.vk.ru/?act=web_token&app_id=' + appId + '&version=1');
            const request = net.request({
                method: 'POST',
                url: urlStr
            });
            if (strategy.origin) {
                request.setHeader('Origin', strategy.origin);
            }
            if (strategy.referer) {
                request.setHeader('Referer', strategy.referer);
            }
            request.setHeader('Content-Type', 'application/x-www-form-urlencoded');
            if (cookieHeader) {
                request.setHeader('Cookie', cookieHeader);
            }
            request.on('response', (response) => {
                let body = '';
                response.on('data', (chunk) => {
                    body = body + chunk.toString('utf-8');
                });
                response.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        if (parsed && parsed.type === 'okay' && parsed.data && parsed.data.access_token) {
                            resolve({
                                success: true,
                                token: parsed.data.access_token,
                                userId: parsed.data.user_id,
                                expires: parsed.data.expires
                            });
                            return;
                        }
                        resolve({
                            success: false,
                            error: 'type=' + (parsed && parsed.type ? parsed.type : 'parse') +
                                ' info=' + (parsed && parsed.error_info ? parsed.error_info : '')
                        });
                    } catch (err) {
                        resolve({ success: false, error: 'non-json: ' + body.slice(0, 80) });
                    }
                });
            });
            request.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
            request.end('version=1&app_id=' + appId);
        });
    }

    _identityLaunch(payload) {
        const url = payload && payload.url ? payload.url : '';
        const redirectPrefix = payload && payload.redirectPrefix ? payload.redirectPrefix : '';
        if (!url) {
            return { launchId: '', error: 'no url' };
        }
        const launchId = 'la-' + (++this.identitySeq);
        const parent = this.context && this.context.mainWindow ? this.context.mainWindow : null;
        const win = new BrowserWindow({
            width: 900,
            height: 720,
            parent: parent,
            title: 'Авторизация',
            autoHideMenuBar: true,
            webPreferences: {
                session: session.defaultSession,
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false
            }
        });
        const finish = (resultUrl) => {
            if (win && !win.isDestroyed()) {
                win.close();
            }
            this.identityResults.set(launchId, { redirectUrl: resultUrl });
        };
        const checkUrl = (navUrl) => {
            if (redirectPrefix && navUrl && navUrl.indexOf(redirectPrefix) === 0) {
                finish(navUrl);
            }
        };
        win.webContents.on('will-redirect', (_e, navUrl) => {
            checkUrl(navUrl);
        });
        win.webContents.on('did-navigate', (_e, navUrl) => {
            checkUrl(navUrl);
        });
        win.on('closed', () => {
            if (!this.identityResults.has(launchId)) {
                this.identityResults.set(launchId, { cancelled: true });
            }
            this.identityLaunches.delete(launchId);
        });
        win.loadURL(url).catch((err) => {
            if (this.logger) {
                this.logger.error('identity', 'launchWebAuthFlow: ' + err.message);
            }
            if (!this.identityResults.has(launchId)) {
                this.identityResults.set(launchId, { cancelled: true });
            }
            if (win && !win.isDestroyed()) {
                win.close();
            }
        });
        this.identityLaunches.set(launchId, win);
        if (this.logger) {
            this.logger.info('identity', 'launchWebAuthFlow открыт: ' + url);
        }
        return { launchId: launchId };
    }

    _identityResult(launchId) {
        if (this.identityResults.has(launchId)) {
            const result = this.identityResults.get(launchId);
            this.identityResults.delete(launchId);
            return result;
        }
        return { pending: true };
    }

    _storageFilePath(extId, area) {
        const dir = path.join(app.getPath('userData'), 'extension-storage');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return path.join(dir, extId + '.' + area + '.json');
    }

    _storageLoad(extId, area) {
        try {
            const filePath = this._storageFilePath(extId, area);
            if (fs.existsSync(filePath)) {
                const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed;
                }
            }
        } catch (err) {
            if (this.logger) {
                this.logger.error('storage', 'Не удалось прочитать хранилище ' + extId + '.' + area + ': ' + err.message);
            }
        }
        return {};
    }

    _storageSave(extId, area, data) {
        try {
            fs.writeFileSync(this._storageFilePath(extId, area), JSON.stringify(data), 'utf-8');
        } catch (err) {
            if (this.logger) {
                this.logger.error('storage', 'Не удалось сохранить хранилище ' + extId + '.' + area + ': ' + err.message);
            }
        }
    }

    _fsOriginAllowed(origin) {
        if (!origin) {
            return false;
        }
        if (origin.startsWith('chrome-extension://')) {
            return true;
        }
        try {
            const hostname = new URL(origin).hostname;
            for (const allowed of ['vk.com', 'vk.ru', 'vknext.net']) {
                if (hostname === allowed || hostname.endsWith('.' + allowed)) {
                    return true;
                }
            }
        } catch (err) {
            return false;
        }
        return false;
    }

    _fsSanitizeName(name) {
        const base = path.basename(String(name || ''));
        if (!base || base === '.' || base === '..') {
            return '';
        }
        return base;
    }

    _fsPick(payload) {
        try {
            const win = this.context && this.context.mainWindow ? this.context.mainWindow : null;
            const options = {
                title: 'Выберите папку для сохранения',
                buttonLabel: 'Выбрать папку',
                properties: ['openDirectory', 'createDirectory']
            };
            const result = dialog.showOpenDialogSync(win, options);
            if (!result || result.length === 0) {
                return { cancelled: true };
            }
            if (this.logger) {
                this.logger.info('fs', 'Выбрана папка сохранения: ' + result[0]);
            }
            return { path: result[0], name: path.basename(result[0]) };
        } catch (err) {
            return { cancelled: true };
        }
    }

    _fsWrite(payload) {
        try {
            const dir = String(payload.dir || '');
            const name = this._fsSanitizeName(payload.name);
            if (!dir || !name) {
                return { success: false, error: 'Некорректный путь' };
            }
            if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
                return { success: false, error: 'Папка не существует' };
            }
            const buffer = Buffer.from(payload.data || '', 'base64');
            const target = path.join(dir, name);
            fs.writeFileSync(target, buffer);
            if (this.logger) {
                this.logger.info('fs', 'Файл сохранён: ' + target + ' (' + buffer.length + ' байт)');
            }
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    _fsRead(payload) {
        try {
            const dir = String(payload.dir || '');
            const name = this._fsSanitizeName(payload.name);
            const target = path.join(dir, name);
            if (!dir || !name || !fs.existsSync(target)) {
                return { success: false, error: 'Файл не найден' };
            }
            const buffer = fs.readFileSync(target);
            return { success: true, data: buffer.toString('base64') };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    _fsMkdir(payload) {
        try {
            const dir = String(payload.dir || '');
            const name = this._fsSanitizeName(payload.name);
            if (!dir || !name) {
                return { success: false, error: 'Некорректный путь' };
            }
            fs.mkdirSync(path.join(dir, name), { recursive: true });
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    _fsRemove(payload) {
        try {
            const dir = String(payload.dir || '');
            const name = this._fsSanitizeName(payload.name);
            if (!dir || !name) {
                return { success: false, error: 'Некорректный путь' };
            }
            const target = path.join(dir, name);
            if (fs.existsSync(target)) {
                fs.rmSync(target, { recursive: true, force: true });
            }
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
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
        if (this.logger) {
            this.logger.info('dnr', 'DNR-правила расширения обновлены: активных правил — ' + this.rules.length);
        }
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
                if (allAnswered || Date.now() - startedAt > 800) {
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
            for (const handler of this.beforeRequestHandlers) {
                let result = null;
                try {
                    result = handler(details);
                } catch (err) {
                    result = null;
                }
                if (result) {
                    if (result.cancel === true) {
                        callback({ cancel: true });
                        return;
                    }
                    if (result.redirectURL) {
                        callback({ redirectURL: result.redirectURL });
                        return;
                    }
                }
            }
            if (this.wrListeners.length === 0) {
                callback({});
                return;
            }
            this._queryWebRequestListeners('onBeforeRequest', details).then((answers) => {
                this._applyWebRequestAnswers(answers, callback, 'request');
            });
        });

        session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
            if (this.logger && (details.url.includes('login.vk') || details.url.includes('api.vk.ru') || details.url.includes('al_audio.php'))) {
                this.logger.info('vkreq', details.method + ' ' + details.url.slice(0, 160) + ' initiator=' + getInitiatorDomain(details));
            }
            const headers = {};
            for (const key of Object.keys(details.requestHeaders)) {
                headers[key] = details.requestHeaders[key];
            }
            for (const handler of this.beforeSendHeadersHandlers) {
                let result = null;
                try {
                    result = handler(details, headers);
                } catch (err) {
                    result = null;
                }
                if (result) {
                    if (result.cancel === true) {
                        callback({ cancel: true });
                        return;
                    }
                    if (result.requestHeaders) {
                        for (const headerKey of Object.keys(result.requestHeaders)) {
                            const value = result.requestHeaders[headerKey];
                            if (value === null || value === undefined) {
                                delete headers[headerKey];
                            } else {
                                headers[headerKey] = value;
                            }
                        }
                    }
                }
            }
            const applyDnrPass = (builtinOnly) => {
                let matched = false;
                for (const rule of this.rules) {
                    if (builtinOnly && rule.id < 9000) {
                        continue;
                    }
                    if (!builtinOnly && rule.id >= 9000) {
                        continue;
                    }
                    if (!this._matches(details, rule.condition)) {
                        continue;
                    }
                    matched = true;
                    if (rule.id >= 9000 && this.logger && !this._dnrLogged.has(details.url) && this._dnrLogged.size < 50) {
                        this._dnrLogged.add(details.url);
                        this.logger.info('dnr', 'Правило VK применено к ' + details.url.slice(0, 140));
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
                return matched;
            };
            const extensionRuleMatched = applyDnrPass(false);
            if (!extensionRuleMatched) {
                applyDnrPass(true);
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
            let initiatorOrigin = '';
            try {
                if (details.referrer && details.referrer !== 'null') {
                    initiatorOrigin = new URL(details.referrer).origin;
                }
            } catch (err) {
                initiatorOrigin = '';
            }
            if ((!initiatorOrigin || initiatorOrigin === 'null') && details.webContents && !details.webContents.isDestroyed()) {
                try {
                    initiatorOrigin = new URL(details.webContents.getURL()).origin;
                } catch (err) {
                    initiatorOrigin = '';
                }
            }
            if (!initiatorOrigin || initiatorOrigin === 'null') {
                try {
                    const reqHeaders = details.requestHeaders || {};
                    const originHeader = reqHeaders['Origin'] || reqHeaders['origin'];
                    if (originHeader && originHeader.startsWith('chrome-extension://')) {
                        initiatorOrigin = originHeader;
                    }
                } catch (err) {
                    initiatorOrigin = '';
                }
            }
            if (initiatorOrigin.startsWith('chrome-extension://')) {
                const hasAcao = Object.keys(responseHeaders).some((k) => k.toLowerCase() === 'access-control-allow-origin');
                if (!hasAcao) {
                    responseHeaders['Access-Control-Allow-Origin'] = ['*'];
                }
                if (details.method === 'OPTIONS') {
                    const hasMethods = Object.keys(responseHeaders).some((k) => k.toLowerCase() === 'access-control-allow-methods');
                    if (!hasMethods) {
                        responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, PATCH, OPTIONS'];
                    }
                    const hasHeaders = Object.keys(responseHeaders).some((k) => k.toLowerCase() === 'access-control-allow-headers');
                    if (!hasHeaders) {
                        responseHeaders['Access-Control-Allow-Headers'] = ['*'];
                    }
                }
            }
            if (details.resourceType === 'mainFrame') {
                try {
                    const urlObj = new URL(details.url);
                    const hostname = urlObj.hostname;
                    let isVk = false;
                    for (const domain of ['vk.com', 'vk.ru', 'vknext.net']) {
                        if (hostname === domain || hostname.endsWith('.' + domain)) {
                            isVk = true;
                            break;
                        }
                    }
                    if (isVk) {
                        const cspKeys = ['content-security-policy', 'Content-Security-Policy'];
                        for (const key of cspKeys) {
                            const values = responseHeaders[key];
                            if (!Array.isArray(values)) {
                                continue;
                            }
                            for (let i = 0; i < values.length; i++) {
                                const value = values[i];
                                const cspExtra = 'http://127.0.0.1:33123 https://api.genius.com https://api.vknext.net';
                                if (value.includes(cspExtra)) {
                                    continue;
                                }
                                if (value.includes('connect-src')) {
                                    values[i] = value.replace(/connect-src/, 'connect-src ' + cspExtra);
                                } else {
                                    values[i] = value + '; connect-src ' + cspExtra;
                                }
                            }
                            responseHeaders[key] = values;
                        }
                    }
                } catch (err) {
                    // URL не разобран — пропускаем
                }
            }
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

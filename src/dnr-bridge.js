import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { app, session, BrowserWindow, screen, globalShortcut } from 'electron';

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
        if (domain === 'chrome-extension') {
            if (/^[a-p]{32}$/.test(host)) {
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
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'set', value: 'https://vk.ru/' }] },
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
        this.context = null;
        this._startServer();
        this._setupWebRequest();
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
        try {
            const appId = payload && payload.appId ? payload.appId : 6287487;
            const url = new URL('https://login.vk.ru');
            url.searchParams.set('act', 'web_token');
            const body = new URLSearchParams();
            body.set('version', '1');
            body.set('app_id', String(appId));
            const resp = await session.defaultSession.fetch(url.toString(), {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    'origin': 'https://vk.ru/'
                },
                body: body.toString()
            });
            const data = await resp.json();
            if (data && data.type === 'okay' && data.data && data.data.access_token) {
                if (this.logger) {
                    this.logger.info('identity', 'web_token получен (user_id=' + (data.data.user_id || '?') + ')');
                }
                return {
                    success: true,
                    token: data.data.access_token,
                    userId: data.data.user_id,
                    expires: data.data.expires
                };
            }
            return { success: false, error: 'web_token не получен (type=' + (data && data.type ? data.type : 'error') + ')' };
        } catch (err) {
            if (this.logger) {
                this.logger.error('identity', 'web_token ошибка: ' + err.message);
            }
            return { success: false, error: err.message };
        }
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

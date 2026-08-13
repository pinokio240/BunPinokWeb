import path from 'node:path';
import fs from 'node:fs';
import AdmZip from 'adm-zip';

const POLYFILL = `(function () {
    if (typeof globalThis !== 'undefined' && typeof globalThis.browser !== 'undefined' && globalThis.browserApi.runtime && globalThis.browserApi.runtime.id) {
        return;
    }
    const chromeObj = (typeof chrome !== 'undefined') ? chrome : null;
    const browserApi = {};

    function promisify(target, src, methods) {
        for (const method of methods) {
            target[method] = function () {
                const args = Array.prototype.slice.call(arguments);
                return new Promise(function (resolve, reject) {
                    try {
                        args.push(function (result) {
                            const lastError = chromeObj && chromeObj.runtime ? chromeObj.runtime.lastError : null;
                            if (lastError) {
                                reject(new Error(lastError.message));
                            } else {
                                resolve(result);
                            }
                        });
                        src[method].apply(src, args);
                    } catch (err) {
                        reject(err);
                    }
                });
            };
        }
    }

    function event(api, name) {
        Object.defineProperty(api, name, {
            value: {
                addListener: function (fn) {
                    if (chromeObj && chromeObj[name] && chromeObj[name].addListener) {
                        chromeObj[name].addListener(function () {
                            return fn.apply(null, arguments);
                        });
                    }
                },
                removeListener: function (fn) {
                    if (chromeObj && chromeObj[name] && chromeObj[name].removeListener) {
                        chromeObj[name].removeListener(fn);
                    }
                },
                hasListener: function (fn) {
                    if (chromeObj && chromeObj[name] && chromeObj[name].hasListener) {
                        return chromeObj[name].hasListener(fn);
                    }
                    return false;
                }
            }
        });
    }

    if (chromeObj) {
        browserApi.runtime = {};
        event(browserApi.runtime, 'onMessage');
        event(browserApi.runtime, 'onInstalled');
        event(browserApi.runtime, 'onStartup');
        promisify(browserApi.runtime, chromeObj.runtime, ['sendMessage', 'getBackgroundPage', 'getPlatformInfo']);
        browserApi.runtime.getURL = function (p) { return chromeObj.runtime.getURL(p); };
        Object.defineProperty(browserApi.runtime, 'id', { get: function () { return chromeObj.runtime.id; } });
        Object.defineProperty(browserApi.runtime, 'lastError', { get: function () { return chromeObj.runtime.lastError; } });

        browserApi.storage = { local: {}, sync: {}, managed: {} };
        promisify(browserApi.storage.local, chromeObj.storage.local, ['get', 'set', 'remove', 'clear']);
        promisify(browserApi.storage.sync, chromeObj.storage.sync, ['get', 'set', 'remove', 'clear']);
        event(browserApi.storage, 'onChanged');

        browserApi.tabs = {};
        promisify(browserApi.tabs, chromeObj.tabs, ['query', 'create', 'update', 'remove', 'get', 'executeScript', 'insertCSS', 'sendMessage']);
        event(browserApi.tabs, 'onCreated');
        event(browserApi.tabs, 'onUpdated');
        event(browserApi.tabs, 'onRemoved');
        event(browserApi.tabs, 'onActivated');

        browserApi.windows = {};
        promisify(browserApi.windows, chromeObj.windows, ['create', 'get', 'getAll', 'update', 'remove']);

        browserApi.notifications = {};
        promisify(browserApi.notifications, chromeObj.notifications, ['create', 'update', 'clear', 'getAll']);
        event(browserApi.notifications, 'onClicked');
        event(browserApi.notifications, 'onClosed');

        browserApi.i18n = {};
        browserApi.i18n.getMessage = function () { return chromeObj.i18n.getMessage.apply(chromeObj.i18n, arguments); };

        browserApi.commands = {};
        promisify(browserApi.commands, chromeObj.commands, ['getAll']);
        event(browserApi.commands, 'onCommand');

        browserApi.bookmarks = {};
        promisify(browserApi.bookmarks, chromeObj.bookmarks, ['create', 'get', 'getChildren', 'getTree', 'update', 'remove', 'search']);

        browserApi.history = {};
        promisify(browserApi.history, chromeObj.history, ['search', 'deleteUrl', 'deleteAll']);

        browserApi.action = {};
        browserApi.browserAction = {};
        const actionApi = chromeObj.action || chromeObj.browserAction || {};
        promisify(browserApi.action, actionApi, ['setBadgeText', 'setBadgeBackgroundColor', 'setIcon', 'setTitle', 'setPopup', 'getBadgeText', 'getTitle', 'getPopup']);
        promisify(browserApi.browserAction, actionApi, ['setBadgeText', 'setBadgeBackgroundColor', 'setIcon', 'setTitle', 'setPopup', 'getBadgeText', 'getTitle', 'getPopup']);
        event(browserApi.action, 'onClicked');
        event(browserApi.browserAction, 'onClicked');

        browserApi.webRequest = {};
        event(browserApi.webRequest, 'onBeforeRequest');
        event(browserApi.webRequest, 'onHeadersReceived');
        event(browserApi.webRequest, 'onBeforeSendHeaders');
        event(browserApi.webRequest, 'onCompleted');
        event(browserApi.webRequest, 'onErrorOccurred');

        browserApi.cookies = {};
        promisify(browserApi.cookies, chromeObj.cookies, ['get', 'getAll', 'set', 'remove']);
        event(browserApi.cookies, 'onChanged');

        browserApi.contextMenus = browserApi.menus = {};
        const menusApi = chromeObj.contextMenus || {};
        promisify(browserApi.contextMenus, menusApi, ['create', 'remove', 'removeAll', 'update']);
        event(browserApi.contextMenus, 'onClicked');

        browserApi.sidebarAction = {};
        if (chromeObj.sidebarAction) {
            promisify(browserApi.sidebarAction, chromeObj.sidebarAction, ['setPanel', 'setTitle', 'setIcon', 'open', 'close', 'toggle']);
        }

        browserApi.browserSettings = {};
        browserApi.sessions = {};
        if (chromeObj.sessions) {
            promisify(browserApi.sessions, chromeObj.sessions, ['getRecentlyClosed', 'restore']);
        }
        browserApi.extension = {};
        browserApi.extension.getURL = function (p) { return chromeObj.runtime.getURL(p); };
    }

    if (typeof globalThis !== 'undefined') {
        globalThis.browser = browserApi;
    }
    if (typeof window !== 'undefined') {
        window.browser = browserApi;
    }
    if (typeof global !== 'undefined') {
        global.browser = browserApi;
    }
})();`;

const UNSUPPORTED_PERMISSIONS = [
    'browserSettings',
    'geckoProfiler',
    'menus.overrideContext',
    'nativeMessagingFromContent',
    'mozAddonManager',
    'networkStatus',
    'normandyAddonStudy',
    'pkcs11',
    'privacy.trackingProtection',
    'telemetry',
    'theme',
    'unlimitedStorage',
    'urlbar',
    'userScripts',
    'webRequestFilterResponse'
];

export class XpiConverter {
    constructor() {
        this.logger = null;
    }

    setLogger(logger) {
        this.logger = logger;
    }

    _unzip(zipBuffer, targetDir) {
        const zip = new AdmZip(zipBuffer);
        if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true, force: true });
        }
        zip.extractAllTo(targetDir, true);
    }

    _transformManifest(manifest) {
        delete manifest.browser_specific_settings;
        delete manifest.applications;
        if (manifest.options_ui) {
            delete manifest.options_ui.browser_style;
            delete manifest.options_ui.open_in_tab;
        }
        if (manifest.sidebar_action) {
            delete manifest.sidebar_action;
        }

        if (Array.isArray(manifest.permissions)) {
            manifest.permissions = manifest.permissions
                .map((permission) => {
                    if (permission === 'menus') {
                        return 'contextMenus';
                    }
                    return permission;
                })
                .filter((permission) => {
                    return !UNSUPPORTED_PERMISSIONS.includes(permission);
                });
        }

        if (manifest.manifest_version === 3 && manifest.background && Array.isArray(manifest.background.scripts)) {
            manifest.manifest_version = 2;
        }

        return manifest;
    }

    convert(xpiPath, targetDir) {
        const buffer = fs.readFileSync(xpiPath);
        this._unzip(buffer, targetDir);

        const manifestPath = path.join(targetDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            fs.rmSync(targetDir, { recursive: true, force: true });
            throw new Error('В XPI нет manifest.json — это не расширение Firefox');
        }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        this._transformManifest(manifest);

        const hasOwnPolyfill = fs.existsSync(path.join(targetDir, 'browser-polyfill.js'));

        if (!hasOwnPolyfill) {
            fs.writeFileSync(path.join(targetDir, 'browser-polyfill.js'), POLYFILL, 'utf-8');

            if (manifest.background) {
                if (Array.isArray(manifest.background.scripts)) {
                    if (!manifest.background.scripts.includes('browser-polyfill.js')) {
                        manifest.background.scripts.unshift('browser-polyfill.js');
                    }
                } else if (typeof manifest.background.service_worker === 'string') {
                    const workerName = manifest.background.service_worker;
                    const workerPath = path.join(targetDir, workerName);
                    if (fs.existsSync(workerPath)) {
                        const wrapperName = 'bunpinok-web-worker.js';
                        fs.writeFileSync(
                            path.join(targetDir, wrapperName),
                            "importScripts('browser-polyfill.js');\nimportScripts('" + workerName + "');\n",
                            'utf-8'
                        );
                        manifest.background.service_worker = wrapperName;
                    }
                }
            }

            if (Array.isArray(manifest.content_scripts)) {
                for (const contentScript of manifest.content_scripts) {
                    if (Array.isArray(contentScript.js)) {
                        if (!contentScript.js.includes('browser-polyfill.js')) {
                            contentScript.js.unshift('browser-polyfill.js');
                        }
                    }
                }
            }

            const htmlFiles = this._findHtmlFiles(targetDir);
            for (const htmlFile of htmlFiles) {
                this._injectPolyfillIntoHtml(htmlFile);
            }
        } else {
            if (this.logger) {
                this.logger.info('xpi', 'Расширение имеет собственный browser-polyfill.js — используем его');
            }
        }

        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
        return manifest;
    }

    _findHtmlFiles(dir) {
        const results = [];
        const walk = (currentDir) => {
            let entries = [];
            try {
                entries = fs.readdirSync(currentDir, { withFileTypes: true });
            } catch (err) {
                return;
            }
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (entry.name.toLowerCase().endsWith('.html') || entry.name.toLowerCase().endsWith('.htm')) {
                    results.push(fullPath);
                }
            }
        };
        walk(dir);
        return results;
    }

    _injectPolyfillIntoHtml(htmlFile) {
        try {
            let html = fs.readFileSync(htmlFile, 'utf-8');
            if (html.includes('browser-polyfill.js')) {
                return;
            }
            const tag = '<script src="browser-polyfill.js"></script>';
            const headIndex = html.search(/<head[^>]*>/i);
            if (headIndex >= 0) {
                const insertAt = headIndex + html.slice(headIndex).indexOf('>') + 1;
                html = html.slice(0, insertAt) + tag + html.slice(insertAt);
            } else {
                html = tag + html;
            }
            fs.writeFileSync(htmlFile, html, 'utf-8');
        } catch (err) {
            console.error('Не удалось пропатчить ' + htmlFile + ':', err);
        }
    }
}

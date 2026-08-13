import path from 'node:path';
import fs from 'node:fs';

const UNKNOWN_PERMISSIONS = [
    'commands',
    'identity',
    'identity.email',
    'gcm',
    'offscreen',
    'sidePanel',
    'declarativeNetRequest',
    'declarativeNetRequestWithHostAccess',
    'declarativeNetRequestFeedback',
    'enterprise.deviceAttributes',
    'enterprise.hardwarePlatform',
    'enterprise.networkingAttributes',
    'enterprise.platformKeys',
    'platformKeys',
    'fileSystemProvider',
    'printerProvider',
    'vpnProvider',
    'wallpaper',
    'system.display',
    'system.cpu',
    'system.memory',
    'system.storage',
    'documentScan',
    'printing',
    'printingMetrics',
    'tabGroups',
    'favicon',
    'topSites',
    'history',
    'processes'
];

const COMPAT_SHIM = `(function () {
    try {
    if (typeof chrome === 'undefined') {
        return;
    }
    if (!chrome.commands) {
        chrome.commands = {
            getAll: function (cb) {
                if (cb) { cb([]); }
            },
            onCommand: { addListener: function () {}, removeListener: function () {} }
        };
    }
    if (!chrome.identity) {
        const identityBridge = 'http://127.0.0.1:33123';
        const identityCacheKey = 'bunpinok.identity.token';
        const identityAppId = 6287487;
        const identityFail = function (message, cb) {
            if (chrome.runtime) {
                chrome.runtime.lastError = { message: message };
            }
            if (cb) { cb(); }
            setTimeout(function () {
                if (chrome.runtime) { chrome.runtime.lastError = null; }
            }, 0);
        };
        const identityFetchToken = function () {
            return fetch(identityBridge + '/identity-token', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ extId: chrome.runtime.id, appId: identityAppId })
            }).then(function (r) { return r.json(); });
        };
        const identityCached = function (cb) {
            if (!chrome.storage || !chrome.storage.local) {
                cb(null);
                return;
            }
            chrome.storage.local.get([identityCacheKey], function (result) {
                const cached = result && result[identityCacheKey] ? result[identityCacheKey] : null;
                if (cached && cached.token && cached.expires && (cached.expires * 1000) > Date.now()) {
                    cb(cached.token);
                } else {
                    cb(null);
                }
            });
        };
        chrome.identity = {
            getAuthToken: function (details, cb) {
                identityCached(function (cachedToken) {
                    if (cachedToken) {
                        if (cb) { cb(cachedToken); }
                        return;
                    }
                    identityFetchToken().then(function (result) {
                        if (result && result.success && result.token) {
                            if (chrome.storage && chrome.storage.local) {
                                const record = {};
                                record[identityCacheKey] = { token: result.token, expires: result.expires || 0 };
                                chrome.storage.local.set(record, function () {});
                            }
                            if (cb) { cb(result.token); }
                        } else {
                            identityFail((result && result.error) || 'web_token failed', cb);
                        }
                    }).catch(function (err) {
                        identityFail(err && err.message ? err.message : 'identity bridge unreachable', cb);
                    });
                });
            },
            removeCachedAuthToken: function (details, cb) {
                if (chrome.storage && chrome.storage.local) {
                    chrome.storage.local.remove([identityCacheKey], function () {
                        if (cb) { cb(); }
                    });
                } else if (cb) { cb(); }
            },
            launchWebAuthFlow: function (details, cb) {
                const url = details && details.url ? details.url : '';
                let redirectPrefix = '';
                try {
                    const parsed = new URL(url);
                    redirectPrefix = parsed.searchParams.get('redirect_uri') || '';
                } catch (err) {
                    redirectPrefix = '';
                }
                if (!redirectPrefix) {
                    redirectPrefix = 'https://' + chrome.runtime.id + '.chromiumapp.org';
                }
                fetch(identityBridge + '/identity-launch', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ extId: chrome.runtime.id, url: url, redirectPrefix: redirectPrefix })
                }).then(function (r) { return r.json(); }).then(function (launch) {
                    const launchId = launch && launch.launchId ? launch.launchId : '';
                    if (!launchId) {
                        identityFail('launchWebAuthFlow failed', cb);
                        return;
                    }
                    const startedAt = Date.now();
                    const poll = function () {
                        fetch(identityBridge + '/identity-result?launchId=' + encodeURIComponent(launchId))
                            .then(function (r) { return r.json(); })
                            .then(function (res) {
                                if (res && res.redirectUrl) {
                                    if (cb) { cb(res.redirectUrl); }
                                    return;
                                }
                                if (res && res.cancelled) {
                                    identityFail('User cancelled', cb);
                                    return;
                                }
                                if (Date.now() - startedAt > 300000) {
                                    identityFail('Timeout', cb);
                                    return;
                                }
                                setTimeout(poll, 250);
                            }).catch(function () {
                                setTimeout(poll, 250);
                            });
                    };
                    poll();
                }).catch(function () {
                    identityFail('identity bridge unreachable', cb);
                });
            },
            getProfileUserInfo: function (cb) {
                if (cb) { cb({}); }
            },
            onSignInChanged: { addListener: function () {}, removeListener: function () {} }
        };
    }
    if (!chrome.sidePanel) {
        chrome.sidePanel = {
            setOptions: function (opts, cb) { if (cb) { cb(); } },
            setPanelBehavior: function (opts, cb) { if (cb) { cb(); } },
            open: function (opts, cb) { if (cb) { cb(); } }
        };
    }
    if (!chrome.action) {
        chrome.action = {};
    }
    if (chrome.action && !chrome.action.setBadgeText) {
        const fake = function (cb) { if (cb) { cb(); } };
        chrome.action.setBadgeText = function (d, cb) { if (cb) { cb(); } };
        chrome.action.setBadgeBackgroundColor = function (d, cb) { if (cb) { cb(); } };
        chrome.action.setIcon = function (d, cb) { if (cb) { cb(); } };
        chrome.action.setTitle = function (d, cb) { if (cb) { cb(); } };
        chrome.action.setPopup = function (d, cb) { if (cb) { cb(); } };
        chrome.action.getBadgeText = function (d, cb) { if (cb) { cb(''); } };
        chrome.action.getTitle = function (d, cb) { if (cb) { cb(''); } };
        chrome.action.getPopup = function (d, cb) { if (cb) { cb(''); } };
        chrome.action.onClicked = { addListener: function () {}, removeListener: function () {} };
    }
    (function () {
        const storageExtId = chrome.runtime.id;
        const storageBridge = 'http://127.0.0.1:33123';
        const storageListeners = [];
        const storageCall = function (area, action, payload) {
            return fetch(storageBridge + '/storage-' + action, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ extId: storageExtId, area: area, payload: payload || {} })
            }).then(function (r) { return r.json(); }).catch(function () { return { data: {} }; });
        };
        const storageNotify = function (changes, area) {
            if (storageListeners.length === 0) {
                return;
            }
            for (const listener of storageListeners) {
                try { listener(changes, area); } catch (err) { }
            }
        };
        const storageMakeArea = function (area) {
            const get = function (keys, cb) {
                let query = null;
                let defaults = null;
                if (keys === null || typeof keys === 'undefined') {
                    query = null;
                } else if (typeof keys === 'string') {
                    query = [keys];
                } else if (Array.isArray(keys)) {
                    query = keys;
                } else if (typeof keys === 'object') {
                    query = Object.keys(keys);
                    defaults = keys;
                }
                const promise = storageCall(area, 'get', { keys: query }).then(function (result) {
                    const data = result && result.data ? result.data : {};
                    if (defaults) {
                        for (const key of Object.keys(defaults)) {
                            if (typeof data[key] === 'undefined') {
                                data[key] = defaults[key];
                            }
                        }
                    }
                    if (cb) { cb(data); }
                    return data;
                });
                if (cb) {
                    return undefined;
                }
                return promise;
            };
            const set = function (items, cb) {
                const itemsToSet = items || {};
                const changes = {};
                for (const key of Object.keys(itemsToSet)) {
                    changes[key] = { newValue: itemsToSet[key] };
                }
                const promise = storageCall(area, 'set', { items: itemsToSet }).then(function () {
                    storageNotify(changes, area);
                    if (cb) { cb(); }
                });
                if (cb) {
                    return undefined;
                }
                return promise;
            };
            const remove = function (keys, cb) {
                let list = [];
                if (typeof keys === 'string') {
                    list = [keys];
                }
                if (Array.isArray(keys)) {
                    list = keys;
                }
                const changes = {};
                for (const key of list) {
                    changes[key] = {};
                }
                const promise = storageCall(area, 'remove', { keys: list }).then(function () {
                    storageNotify(changes, area);
                    if (cb) { cb(); }
                });
                if (cb) {
                    return undefined;
                }
                return promise;
            };
            const clear = function (cb) {
                const promise = storageCall(area, 'clear', {}).then(function () {
                    storageNotify({}, area);
                    if (cb) { cb(); }
                });
                if (cb) {
                    return undefined;
                }
                return promise;
            };
            const getBytesInUse = function (keys, cb) {
                if (typeof keys === 'function') {
                    cb = keys;
                }
                if (cb) { cb(0); }
                return Promise.resolve(0);
            };
            return {
                get: get,
                set: set,
                remove: remove,
                clear: clear,
                getBytesInUse: getBytesInUse,
                QUOTA_BYTES: 10485760,
                QUOTA_BYTES_PER_ITEM: 8192
            };
        };
        const storageBase = chrome.storage || {};
        storageBase.local = storageMakeArea('local');
        storageBase.sync = storageMakeArea('sync');
        storageBase.session = storageMakeArea('session');
        storageBase.onChanged = {
            addListener: function (fn) { storageListeners.push(fn); },
            removeListener: function (fn) {
                const idx = storageListeners.indexOf(fn);
                if (idx >= 0) { storageListeners.splice(idx, 1); }
            },
            hasListener: function (fn) { return storageListeners.indexOf(fn) >= 0; }
        };
        chrome.storage = storageBase;
    })();
    if (!chrome.alarms) {
        chrome.alarms = {
            create: function (name, info) {},
            clear: function (name, cb) { if (cb) { cb(false); } },
            clearAll: function (cb) { if (cb) { cb(false); } },
            get: function (name, cb) { if (cb) { cb(null); } },
            getAll: function (cb) { if (cb) { cb([]); } },
            onAlarm: { addListener: function () {}, removeListener: function () {} }
        };
    }
    if (!chrome.declarativeNetRequest) {
        chrome.declarativeNetRequest = {
            updateDynamicRules: function (options, cb) {
                const payload = {
                    addRules: options && options.addRules ? options.addRules : [],
                    removeRuleIds: options && options.removeRuleIds ? options.removeRuleIds : []
                };
                fetch('http://127.0.0.1:33123/rules', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(payload)
                }).then(() => { if (cb) { cb(); } }).catch(() => { if (cb) { cb(); } });
            },
            updateSessionRules: function (options, cb) {
                const payload = {
                    addRules: options && options.addRules ? options.addRules : [],
                    removeRuleIds: options && options.removeRuleIds ? options.removeRuleIds : []
                };
                fetch('http://127.0.0.1:33123/rules', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(payload)
                }).then(() => { if (cb) { cb(); } }).catch(() => { if (cb) { cb(); } });
            },
            getDynamicRules: function (cb) { if (cb) { cb([]); } },
            getSessionRules: function (cb) { if (cb) { cb([]); } },
            setExtensionActionOptions: function (options, cb) { if (cb) { cb(); } }
        };
    }
    if (!chrome.downloads) {        const downloadsEvent = function () {
            return { addListener: function () {}, removeListener: function () {}, hasListener: function () { return false; } };
        };
        chrome.downloads = {
            download: function (options, cb) {
                const doDownload = async () => {
                    try {
                        const resp = await fetch(options.url, { credentials: 'include' });
                        if (!resp.ok) {
                            if (cb) { cb(undefined); }
                            return;
                        }
                        const blob = await resp.blob();
                        const arrayBuffer = await blob.arrayBuffer();
                        const bytes = new Uint8Array(arrayBuffer);
                        let binary = '';
                        const chunk = 0x8000;
                        for (let i = 0; i < bytes.length; i += chunk) {
                            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
                        }
                        const base64 = btoa(binary);
                        const result = await fetch('http://127.0.0.1:33123/download', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ url: options.url, filename: options.filename, data: base64 })
                        }).then(function (r) { return r.json(); });
                        if (cb) { cb(result && result.id ? result.id : undefined); }
                    } catch (err) {
                        if (cb) { cb(undefined); }
                    }
                };
                doDownload();
            },
            search: function (query, cb) {
                fetch('http://127.0.0.1:33123/downloads-list')
                    .then(function (r) { return r.json(); })
                    .then(function (list) { if (cb) { cb(list || []); } })
                    .catch(function () { if (cb) { cb([]); } });
            },
            cancel: function (id, cb) { if (cb) { cb(); } },
            erase: function (query, cb) { if (cb) { cb(); } },
            removeFile: function (id, cb) { if (cb) { cb(); } },
            open: function (id, cb) { if (cb) { cb(); } },
            pause: function (id, cb) { if (cb) { cb(); } },
            resume: function (id, cb) { if (cb) { cb(); } },
            onCreated: downloadsEvent(),
            onChanged: downloadsEvent(),
            onDeterminingFilename: downloadsEvent()
        };
    }
    if (chrome.webRequest && !chrome.webRequest.handlerBehaviorChanged) {
        chrome.webRequest.handlerBehaviorChanged = function (cb) { if (cb) { cb(); } };
    }
    if (!chrome.offscreen) {
        chrome.offscreen = {
            Reason: {
                AUDIO_PLAYBACK: 'AUDIO_PLAYBACK',
                USER_MEDIA: 'USER_MEDIA',
                DISPLAY_MEDIA: 'DISPLAY_MEDIA',
                DOM_SCRAPING: 'DOM_SCRAPING',
                BLOBS: 'BLOBS',
                LOCAL_STORAGE: 'LOCAL_STORAGE',
                WORKERS: 'WORKERS',
                IFRAME_SCRIPTING: 'IFRAME_SCRIPTING',
                CLIPBOARD: 'CLIPBOARD'
            },
            createDocument: function (options, cb) {
                const relativeUrl = options && options.url ? options.url : 'offscreen.html';
                const fullUrl = chrome.runtime.getURL(relativeUrl);
                const extId = chrome.runtime.id;
                fetch('http://127.0.0.1:33123/offscreen', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ extId: extId, url: fullUrl })
                }).then(function () { if (cb) { cb(); } }).catch(function () { if (cb) { cb(); } });
            },
            closeDocument: function (cb) {
                const extId = chrome.runtime.id;
                fetch('http://127.0.0.1:33123/offscreen-close', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ extId: extId })
                }).then(function () { if (cb) { cb(); } }).catch(function () { if (cb) { cb(); } });
            },
            hasDocument: function (cb) {
                const extId = chrome.runtime.id;
                fetch('http://127.0.0.1:33123/offscreen-has', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ extId: extId })
                }).then(function (r) { return r.json(); }).then(function (data) { if (cb) { cb(data && data.has === true); } }).catch(function () { if (cb) { cb(false); } });
            }
        };
    }
    if (chrome.offscreen) {
        if (!chrome.offscreen.Reason) {
            chrome.offscreen.Reason = {
                AUDIO_PLAYBACK: 'AUDIO_PLAYBACK',
                USER_MEDIA: 'USER_MEDIA',
                DISPLAY_MEDIA: 'DISPLAY_MEDIA',
                DOM_SCRAPING: 'DOM_SCRAPING',
                BLOBS: 'BLOBS',
                LOCAL_STORAGE: 'LOCAL_STORAGE',
                WORKERS: 'WORKERS',
                IFRAME_SCRIPTING: 'IFRAME_SCRIPTING',
                CLIPBOARD: 'CLIPBOARD'
            };
        }
        if (!chrome.offscreen.REASON) {
            chrome.offscreen.REASON = chrome.offscreen.Reason;
        }
    }
    if (!chrome.runtime.ContextType) {
        chrome.runtime.ContextType = {
            BACKGROUND: 'BACKGROUND',
            EXTENSION_SERVICE_WORKER: 'SERVICE_WORKER',
            OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT',
            POPUP: 'POPUP',
            TAB: 'TAB',
            WINDOW: 'WINDOW',
            SIDE_PANEL: 'SIDE_PANEL'
        };
    }
    if (!chrome.i18n) {
        chrome.i18n = {};
    }
    if (chrome.i18n && !chrome.i18n.getMessage) {
        let i18nMessages = null;
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', chrome.runtime.getURL('_locales/ru/messages.json'), false);
            xhr.send(null);
            if (xhr.status === 200) {
                i18nMessages = JSON.parse(xhr.responseText);
            }
        } catch (err) {
            i18nMessages = null;
        }
        chrome.i18n.getMessage = function (name, substitutions) {
            let message = name;
            if (i18nMessages && i18nMessages[name] && i18nMessages[name].message) {
                message = i18nMessages[name].message;
            }
            if (substitutions && substitutions.length) {
                for (let i = 0; i < substitutions.length; i++) {
                    message = message.replace('$' + (i + 1), String(substitutions[i]));
                }
            }
            return message;
        };
        chrome.i18n.getUILanguage = function () { return 'ru'; };
    }
    if (!chrome.privacy) {
        const privacyStub = function () {
            return {
                get: function (details, cb) { if (cb) { cb({ value: false, levelOfControl: 'not_controllable' }); } },
                set: function (details, cb) { if (cb) { cb(true); } },
                clear: function (details, cb) { if (cb) { cb(true); } }
            };
        };
        const privacySettings = {
            thirdPartyCookiesAllowed: privacyStub(),
            hyperlinkAuditingEnabled: privacyStub(),
            referrersEnabled: privacyStub(),
            protectedContentEnabled: privacyStub(),
            doNotTrackEnabled: privacyStub(),
            safeBrowsingEnabled: privacyStub(),
            autofillEnabled: privacyStub(),
            alternateErrorPagesEnabled: privacyStub()
        };
        chrome.privacy = {
            network: {
                networkPredictionEnabled: privacyStub(),
                webRTCIPHandlingPolicy: privacyStub(),
                webRTCNonProxiedUdpEnabled: privacyStub(),
                globalPrivacyControlEnabled: privacyStub(),
                httpsOnlyMode: privacyStub()
            },
            services: {
                passwordSavingEnabled: privacyStub(),
                safeBrowsingEnabled: privacyStub(),
                safeBrowsingExtendedReportingEnabled: privacyStub(),
                searchSuggestEnabled: privacyStub(),
                spellingServiceEnabled: privacyStub(),
                translationServiceEnabled: privacyStub(),
                autofillAddressEnabled: privacyStub(),
                autofillCreditCardEnabled: privacyStub()
            },
            websites: privacySettings
        };
    }
    if (chrome.webRequest) {
        const bridgeBase = 'http://127.0.0.1:33123';
        const wrListenerRegistry = {};
        let wrSeq = 0;
        const wrEvents = ['onBeforeRequest', 'onBeforeSendHeaders', 'onHeadersReceived', 'onSendHeaders', 'onCompleted', 'onErrorOccurred'];
        for (const evtName of wrEvents) {
            const api = chrome.webRequest[evtName];
            if (!api || !api.addListener || api.__bunpinokHooked) {
                continue;
            }
            const origAdd = api.addListener.bind(api);
            api.addListener = function (fn, filter, extra) {
                const listenerId = 'wr-' + (++wrSeq);
                const extraList = Array.isArray(extra) ? extra : [];
                wrListenerRegistry[listenerId] = { fn: fn, extra: extraList };
                const urls = filter && Array.isArray(filter.urls) ? filter.urls : [];
                const types = filter && Array.isArray(filter.types) ? filter.types : [];
                const blocking = extraList.includes('blocking');
                fetch(bridgeBase + '/webrq-register', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ listenerId: listenerId, event: evtName, urls: urls, types: types, blocking: blocking })
                }).catch(function () {});
                try { origAdd(fn, filter, extra); } catch (err) { }
            };
            api.__bunpinokHooked = true;
        }
        setInterval(function () {
            fetch(bridgeBase + '/webrq-pending').then(function (r) { return r.json(); }).then(function (queries) {
                if (!queries || queries.length === 0) {
                    return;
                }
                for (const query of queries) {
                    const listener = wrListenerRegistry[query.listenerId];
                    let response = {};
                    if (listener) {
                        try {
                            const ret = listener.fn(query.details);
                            if (ret) {
                                response = ret;
                            }
                        } catch (err) {
                            response = {};
                        }
                    }
                    fetch(bridgeBase + '/webrq-answer', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ queryId: query.queryId, response: response })
                    }).catch(function () {});
                }
            }).catch(function () {});
        }, 60);
    }
    if (!chrome.cast) {
        chrome.cast = {
            isAvailable: false,
            initialize: function (apiConfig, onSuccess, onError) { if (onError) { onError('chrome.cast не поддерживается'); } },
            requestSession: function (onSuccess, onError) { if (onError) { onError('chrome.cast не поддерживается'); } },
            SessionRequest: function () { },
            ApiConfig: function () { },
            SessionStatus: { STARTED: 'started', STOPPED: 'stopped' }
        };
    }
    if (!chrome.alarms) {
        const alarmTimers = {};
        const alarmListeners = [];
        chrome.alarms = {
            create: function (name, info) {
                const key = name || '';
                const delayMinutes = info && info.delayInMinutes ? info.delayInMinutes : 1;
                const periodMinutes = info && info.periodInMinutes ? info.periodInMinutes : 0;
                const delayMs = delayMinutes * 60000;
                if (alarmTimers[key]) {
                    clearTimeout(alarmTimers[key]);
                    clearInterval(alarmTimers[key + ':iv']);
                }
                const fire = function () {
                    for (const listener of alarmListeners) {
                        try { listener({ name: name || '' }); } catch (err) { }
                    }
                };
                alarmTimers[key] = setTimeout(function () {
                    fire();
                    if (periodMinutes > 0) {
                        alarmTimers[key + ':iv'] = setInterval(fire, periodMinutes * 60000);
                    }
                }, delayMs);
            },
            clear: function (name, cb) {
                const key = name || '';
                if (alarmTimers[key]) { clearTimeout(alarmTimers[key]); delete alarmTimers[key]; }
                if (alarmTimers[key + ':iv']) { clearInterval(alarmTimers[key + ':iv']); delete alarmTimers[key + ':iv']; }
                if (cb) { cb(true); }
            },
            clearAll: function (cb) {
                for (const key of Object.keys(alarmTimers)) {
                    if (String(key).endsWith(':iv')) { clearInterval(alarmTimers[key]); } else { clearTimeout(alarmTimers[key]); }
                    delete alarmTimers[key];
                }
                if (cb) { cb(true); }
            },
            get: function (name, cb) { if (cb) { cb(null); } },
            getAll: function (cb) { if (cb) { cb([]); } },
            onAlarm: {
                addListener: function (fn) { alarmListeners.push(fn); },
                removeListener: function (fn) {
                    const idx = alarmListeners.indexOf(fn);
                    if (idx >= 0) { alarmListeners.splice(idx, 1); }
                },
                hasListener: function (fn) { return alarmListeners.indexOf(fn) >= 0; }
            }
        };
    }
    if (!chrome.bookmarks) {
        chrome.bookmarks = {
            getTree: function (cb) {
                fetch('http://127.0.0.1:33123/bm-gettree', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
                    .then(function (r) { return r.json(); })
                    .then(function (tree) { if (cb) { cb(tree); } })
                    .catch(function () { if (cb) { cb([{ id: '0', title: '', children: [] }]); } });
            },
            create: function (details, cb) {
                fetch('http://127.0.0.1:33123/bm-create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(details || {}) })
                    .then(function (r) { return r.json(); })
                    .then(function (node) { if (cb) { cb(node); } })
                    .catch(function () { if (cb) { cb({}); } });
            },
            remove: function (id, cb) {
                fetch('http://127.0.0.1:33123/bm-remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id }) })
                    .then(function () { if (cb) { cb(); } })
                    .catch(function () { if (cb) { cb(); } });
            },
            search: function (query, cb) {
                fetch('http://127.0.0.1:33123/bm-search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: query }) })
                    .then(function (r) { return r.json(); })
                    .then(function (nodes) { if (cb) { cb(nodes); } })
                    .catch(function () { if (cb) { cb([]); } });
            },
            get: function (id, cb) { if (cb) { cb(null); } },
            update: function (id, changes, cb) { if (cb) { cb({}); } }
        };
    }
    if (!chrome.history) {
        chrome.history = {
            search: function (query, cb) {
                fetch('http://127.0.0.1:33123/hist-search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: query && query.text ? query.text : '' }) })
                    .then(function (r) { return r.json(); })
                    .then(function (items) { if (cb) { cb(items); } })
                    .catch(function () { if (cb) { cb([]); } });
            },
            addUrl: function (details, cb) {
                fetch('http://127.0.0.1:33123/hist-add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(details || {}) })
                    .then(function () { if (cb) { cb(); } })
                    .catch(function () { if (cb) { cb(); } });
            },
            deleteUrl: function (details, cb) {
                fetch('http://127.0.0.1:33123/hist-del', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(details || {}) })
                    .then(function () { if (cb) { cb(); } })
                    .catch(function () { if (cb) { cb(); } });
            },
            deleteAll: function (cb) {
                fetch('http://127.0.0.1:33123/hist-delall', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
                    .then(function () { if (cb) { cb(); } })
                    .catch(function () { if (cb) { cb(); } });
            },
            onVisited: { addListener: function () {}, removeListener: function () {} },
            onVisitRemoved: { addListener: function () {}, removeListener: function () {} }
        };
    }
    if (!chrome.browsingData) {
        chrome.browsingData = {
            remove: function (options, dataToRemove, cb) {
                fetch('http://127.0.0.1:33123/browsingdata', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        cookies: dataToRemove && dataToRemove.cookies,
                        cache: dataToRemove && dataToRemove.cache,
                        localStorage: dataToRemove && dataToRemove.localStorage,
                        history: dataToRemove && dataToRemove.history
                    })
                }).then(function () { if (cb) { cb(); } }).catch(function () { if (cb) { cb(); } });
            },
            removeCache: function (options, cb) {
                fetch('http://127.0.0.1:33123/browsingdata', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cache: true }) })
                    .then(function () { if (cb) { cb(); } }).catch(function () { if (cb) { cb(); } });
            },
            removeCookies: function (options, cb) {
                fetch('http://127.0.0.1:33123/browsingdata', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cookies: true, localStorage: true }) })
                    .then(function () { if (cb) { cb(); } }).catch(function () { if (cb) { cb(); } });
            },
            removeHistory: function (options, cb) {
                fetch('http://127.0.0.1:33123/browsingdata', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ history: true }) })
                    .then(function () { if (cb) { cb(); } }).catch(function () { if (cb) { cb(); } });
            }
        };
    }
    if (!chrome.topSites) {
        chrome.topSites = {
            get: function (cb) {
                fetch('http://127.0.0.1:33123/topsites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
                    .then(function (r) { return r.json(); })
                    .then(function (sites) { if (cb) { cb(sites); } })
                    .catch(function () { if (cb) { cb([]); } });
            }
        };
    }
    if (!chrome.search) {
        chrome.search = {
            query: function (options, cb) {
                fetch('http://127.0.0.1:33123/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(options || {}) })
                    .then(function () { if (cb) { cb(); } })
                    .catch(function () { if (cb) { cb(); } });
            }
        };
    }
    if (!chrome.sessions) {
        chrome.sessions = {
            getRecentlyClosed: function (cb) { if (cb) { cb([]); } },
            restore: function (sessionId, cb) { if (cb) { cb({}); } },
            onChanged: { addListener: function () {}, removeListener: function () {} }
        };
    }
    if (!chrome.contentSettings) {
        const contentSettingApi = function () {
            return {
                get: function (details, cb) {
                    fetch('http://127.0.0.1:33123/cs-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(details || {}) })
                        .then(function (r) { return r.json(); })
                        .then(function (result) { if (cb) { cb(result); } })
                        .catch(function () { if (cb) { cb({ setting: 'allow' }); } });
                },
                set: function (details, cb) {
                    fetch('http://127.0.0.1:33123/cs-set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(details || {}) })
                        .then(function () { if (cb) { cb(); } })
                        .catch(function () { if (cb) { cb(); } });
                },
                clear: function (details, cb) { if (cb) { cb(); } }
            };
        };
        chrome.contentSettings = {
            cookies: contentSettingApi(),
            javascript: contentSettingApi(),
            images: contentSettingApi(),
            notifications: contentSettingApi(),
            geolocation: contentSettingApi(),
            camera: contentSettingApi(),
            microphone: contentSettingApi(),
            popups: contentSettingApi(),
            location: contentSettingApi()
        };
    }
    if (!chrome.proxy) {
        chrome.proxy = {
            settings: {
                get: function (details, cb) {
                    fetch('http://127.0.0.1:33123/proxy-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
                        .then(function (r) { return r.json(); })
                        .then(function (result) { if (cb) { cb(result); } })
                        .catch(function () { if (cb) { cb({ value: { mode: 'system' } }); } });
                },
                set: function (details, cb) {
                    fetch('http://127.0.0.1:33123/proxy-set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(details || {}) })
                        .then(function () { if (cb) { cb(); } })
                        .catch(function () { if (cb) { cb(); } });
                },
                clear: function (details, cb) { if (cb) { cb(); } }
            },
            onProxyError: { addListener: function () {}, removeListener: function () {} }
        };
    }
    if (!chrome.system) {
        chrome.system = {
            display: {
                getInfo: function (cb) {
                    fetch('http://127.0.0.1:33123/sysdisplay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
                        .then(function (r) { return r.json(); })
                        .then(function (displays) { if (cb) { cb(displays); } })
                        .catch(function () { if (cb) { cb([]); } });
                },
                onDisplayChanged: { addListener: function () {}, removeListener: function () {} }
            }
        };
    }
    if (chrome.commands && chrome.commands.onCommand && !chrome.commands.__bunpinokRegistered) {
        chrome.commands.__bunpinokRegistered = true;
        try {
            const manifest = chrome.runtime.getManifest();
            const manifestCommands = manifest && manifest.commands ? manifest.commands : {};
            fetch('http://127.0.0.1:33123/commands-register', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ extId: chrome.runtime.id, commands: manifestCommands })
            }).catch(function () {});
        } catch (err) { }
        const commandListeners = [];
        const origAdd = chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand);
        chrome.commands.onCommand.addListener = function (fn) {
            commandListeners.push(fn);
            try { origAdd(fn); } catch (err) { }
        };
        setInterval(function () {
            fetch('http://127.0.0.1:33123/commands-pending').then(function (r) { return r.json(); }).then(function (commands) {
                if (!commands || commands.length === 0) {
                    return;
                }
                for (const command of commands) {
                    for (const listener of commandListeners) {
                        try { listener(command.name); } catch (err) { }
                    }
                }
            }).catch(function () {});
        }, 150);
    }
    if (!chrome.runtime.getContexts) {        chrome.runtime.getContexts = function (filter) {
            const extId = chrome.runtime.id;
            return fetch('http://127.0.0.1:33123/offscreen-has', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ extId: extId })
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (data && data.has === true) {
                    return [{ contextType: 'OFFSCREEN_DOCUMENT', documentUrl: chrome.runtime.getURL('offscreen.html') }];
                }
                return [];
            }).catch(function () {
                return [];
            });
        };
    }
    if (!chrome.scripting) {
        chrome.scripting = {
            executeScript: function (options, cb) {
                if (chrome.tabs && chrome.tabs.executeScript) {
                    const details = {};
                    if (options.files) { details.file = options.files[0]; }
                    if (typeof options.func === 'function') {
                        details.code = '(' + options.func.toString() + ')(' + JSON.stringify(options.args || []) + ')';
                    }
                    if (options.target && options.target.tabId) {
                        chrome.tabs.executeScript(options.target.tabId, details, cb);
                    }
                    return;
                }
                if (cb) { cb([]); }
            },
            insertCSS: function (options, cb) {
                if (chrome.tabs && chrome.tabs.insertCSS) {
                    if (options.target && options.target.tabId) {
                        chrome.tabs.insertCSS(options.target.tabId, { file: options.files ? options.files[0] : undefined, code: options.css }, cb);
                    }
                    return;
                }
                if (cb) { cb(); }
            }
        };
    }
    } catch (err) {
        try { console.error('[bunpinok-shim] ' + (err && err.message ? err.message : String(err))); } catch (err2) { }
    }
})();`;

function convertLoaderImports(scriptPath) {
    try {
        if (!fs.existsSync(scriptPath)) {
            return false;
        }
        const content = fs.readFileSync(scriptPath, 'utf-8');
        if (content.includes('/* bunpinok-converted */')) {
            return false;
        }
        if (!/^\s*import[\s{'"]/m.test(content)) {
            return false;
        }
        const lines = content.split('\n');
        const out = [];
        for (const line of lines) {
            const importMatch = line.match(/^(\s*)import\s+(.+?)\s*;\s*$/);
            if (importMatch) {
                const indent = importMatch[1];
                const spec = importMatch[2].trim();
                if (spec.startsWith("'") || spec.startsWith('"')) {
                    out.push(indent + 'await import(' + spec + ');');
                } else if (spec.startsWith('* as ')) {
                    const fromIndex = spec.indexOf(' from ');
                    const nsName = spec.slice(5, fromIndex).trim();
                    const fromSpec = spec.slice(fromIndex + 6).trim();
                    out.push(indent + 'const ' + nsName + ' = await import(' + fromSpec + ');');
                } else if (spec.startsWith('{')) {
                    const closeIdx = spec.indexOf('}');
                    const names = spec.slice(1, closeIdx).trim();
                    const fromIndex = spec.indexOf(' from ');
                    const fromSpec = spec.slice(fromIndex + 6).trim();
                    out.push(indent + 'const { ' + names + ' } = await import(' + fromSpec + ');');
                } else {
                    const fromIndex = spec.indexOf(' from ');
                    if (fromIndex > 0) {
                        const defName = spec.slice(0, fromIndex).trim();
                        const fromSpec = spec.slice(fromIndex + 6).trim();
                        out.push(indent + 'const ' + defName + ' = (await import(' + fromSpec + ')).default;');
                    } else {
                        out.push(line);
                    }
                }
            } else {
                out.push(line);
            }
        }
        const converted = '/* bunpinok-converted */\n(async () => {\n' + out.join('\n') + '\n})();\n';
        fs.writeFileSync(scriptPath, converted, 'utf-8');
        return true;
    } catch (err) {
        console.error('Не удалось сконвертировать импорты в ' + scriptPath + ':', err);
        return false;
    }
}

export function prepareExtensionForElectron(extPath, mode) {
    const manifestPath = path.join(extPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    let changed = false;

    const shimPath = path.join(extPath, 'electron-compat.js');
    const existingShim = fs.existsSync(shimPath) ? fs.readFileSync(shimPath, 'utf-8') : '';
    if (existingShim !== COMPAT_SHIM) {
        fs.writeFileSync(shimPath, COMPAT_SHIM, 'utf-8');
    }

    if (manifest.manifest_version === 3 && mode !== 'mv2') {
        // ── НАТИВНЫЙ MV3 (без даунгрейда) ──
        if (manifest.background && typeof manifest.background.service_worker === 'string') {
            const worker = manifest.background.service_worker;
            const wrapperName = 'bunpinok-sw-wrapper.js';
            const wrapperPath = path.join(extPath, wrapperName);
            const wrapperContent = "import './electron-compat.js';\nimport './" + worker + "';\n";
            const existing = fs.existsSync(wrapperPath) ? fs.readFileSync(wrapperPath, 'utf-8') : '';
            if (existing !== wrapperContent) {
                fs.writeFileSync(wrapperPath, wrapperContent, 'utf-8');
            }
            if (manifest.background.service_worker !== wrapperName) {
                manifest.background.service_worker = wrapperName;
                changed = true;
            }
        }

        const htmlFiles = _findHtmlFiles(extPath);
        for (const htmlFile of htmlFiles) {
            if (_injectShimIntoHtml(htmlFile)) {
                changed = true;
            }
        }

        if (changed) {
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
        }
        return;
    }

    // ── MV2 (родной MV2 или принудительный fallback) ──
    if (manifest.manifest_version === 3 && manifest.background && typeof manifest.background.service_worker === 'string') {
        let worker = manifest.background.service_worker;
        if (worker === 'bunpinok-sw-wrapper.js') {
            const wrapperPath = path.join(extPath, worker);
            try {
                const wrapperContent = fs.readFileSync(wrapperPath, 'utf-8');
                const imports = wrapperContent.match(/import '\.\/([^']+)';/g);
                if (imports && imports.length >= 2) {
                    const realWorker = imports[1].replace(/import '\.\//, '').replace(/';$/, '');
                    if (fs.existsSync(path.join(extPath, realWorker))) {
                        worker = realWorker;
                    }
                }
            } catch (err) {
                // wrapper не прочитан — оставляем как есть
            }
        }
        delete manifest.background.service_worker;
        manifest.background.scripts = [worker];
        manifest.background.persistent = true;
        manifest.manifest_version = 2;
        changed = true;

        if (manifest.background && manifest.background.type) {
            delete manifest.background.type;
        }
    }

    if (Array.isArray(manifest.permissions)) {
        const filtered = manifest.permissions.filter((permission) => {
            return !UNKNOWN_PERMISSIONS.includes(permission);
        });
        if (filtered.length !== manifest.permissions.length) {
            manifest.permissions = filtered;
            changed = true;
        }
    }

    if (manifest.manifest_version === 2 && manifest.background && Array.isArray(manifest.background.scripts)) {
        if (manifest.background.type) {
            delete manifest.background.type;
            changed = true;
        }
        if (manifest.background.persistent !== true) {
            manifest.background.persistent = true;
            changed = true;
        }
        for (const scriptName of manifest.background.scripts) {
            if (convertLoaderImports(path.join(extPath, scriptName))) {
                changed = true;
            }
        }
    }

    if (manifest.manifest_version === 2) {
        if (Array.isArray(manifest.host_permissions)) {
            if (!Array.isArray(manifest.permissions)) {
                manifest.permissions = [];
            }
            for (const hostPermission of manifest.host_permissions) {
                if (!manifest.permissions.includes(hostPermission)) {
                    manifest.permissions.push(hostPermission);
                }
            }
            delete manifest.host_permissions;
            changed = true;
        }
        if (Array.isArray(manifest.optional_host_permissions)) {
            if (!Array.isArray(manifest.optional_permissions)) {
                manifest.optional_permissions = [];
            }
            for (const hostPermission of manifest.optional_host_permissions) {
                if (!manifest.optional_permissions.includes(hostPermission)) {
                    manifest.optional_permissions.push(hostPermission);
                }
            }
            delete manifest.optional_host_permissions;
            changed = true;
        }
        if (Array.isArray(manifest.web_accessible_resources)) {
            const flat = [];
            for (const entry of manifest.web_accessible_resources) {
                if (typeof entry === 'string') {
                    flat.push(entry);
                } else if (entry && Array.isArray(entry.resources)) {
                    for (const resource of entry.resources) {
                        flat.push(resource);
                    }
                }
            }
            manifest.web_accessible_resources = flat;
            changed = true;
        }
    }

    if (manifest.manifest_version === 2 && manifest.action && !manifest.browser_action) {
        manifest.browser_action = manifest.action;
        delete manifest.action;
        changed = true;
    }

    if (manifest.background && Array.isArray(manifest.background.scripts)) {
        if (!manifest.background.scripts.includes('electron-compat.js')) {
            manifest.background.scripts.unshift('electron-compat.js');
            changed = true;
        }
    }

    if (Array.isArray(manifest.content_scripts)) {
        for (const contentScript of manifest.content_scripts) {
            if (Array.isArray(contentScript.js)) {
                if (!contentScript.js.includes('electron-compat.js')) {
                    contentScript.js.unshift('electron-compat.js');
                    changed = true;
                }
            }
        }
    }

    const htmlFiles = _findHtmlFiles(extPath);
    for (const htmlFile of htmlFiles) {
        if (_injectShimIntoHtml(htmlFile)) {
            changed = true;
        }
    }

    if (changed) {
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    }
}

function _findHtmlFiles(dir) {
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

function _injectShimIntoHtml(htmlFile) {
    try {
        let html = fs.readFileSync(htmlFile, 'utf-8');
        if (html.includes('electron-compat.js')) {
            return false;
        }
        const tag = '<script src="electron-compat.js"></script>';
        const headIndex = html.search(/<head[^>]*>/i);
        if (headIndex >= 0) {
            const insertAt = headIndex + html.slice(headIndex).indexOf('>') + 1;
            html = html.slice(0, insertAt) + tag + html.slice(insertAt);
        } else {
            html = tag + html;
        }
        fs.writeFileSync(htmlFile, html, 'utf-8');
        return true;
    } catch (err) {
        console.error('Не удалось пропатчить ' + htmlFile + ':', err);
        return false;
    }
}

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
        chrome.identity = {
            getAuthToken: function (details, cb) {
                if (chrome.runtime) {
                    chrome.runtime.lastError = { message: 'chrome.identity не поддерживается в этом браузере' };
                }
                if (cb) { cb(); }
                setTimeout(function () {
                    if (chrome.runtime) {
                        chrome.runtime.lastError = null;
                    }
                }, 0);
            },
            removeCachedAuthToken: function (details, cb) {
                if (cb) { cb(); }
            },
            launchWebAuthFlow: function (details, cb) {
                if (cb) { cb(''); }
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
    if (!chrome.storage) {
        chrome.storage = {
            local: {
                get: function (keys, cb) { if (cb) { cb({}); } },
                set: function (items, cb) { if (cb) { cb(); } },
                remove: function (keys, cb) { if (cb) { cb(); } },
                clear: function (cb) { if (cb) { cb(); } }
            },
            sync: {
                get: function (keys, cb) { if (cb) { cb({}); } },
                set: function (items, cb) { if (cb) { cb(); } },
                remove: function (keys, cb) { if (cb) { cb(); } },
                clear: function (cb) { if (cb) { cb(); } }
            },
            onChanged: { addListener: function () {}, removeListener: function () {} }
        };
    }
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
})();`;

export function prepareExtensionForElectron(extPath) {
    const manifestPath = path.join(extPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    let changed = false;

    if (Array.isArray(manifest.permissions)) {
        const filtered = manifest.permissions.filter((permission) => {
            return !UNKNOWN_PERMISSIONS.includes(permission);
        });
        if (filtered.length !== manifest.permissions.length) {
            manifest.permissions = filtered;
            changed = true;
        }
    }

    if (Array.isArray(manifest.host_permissions)) {
        const filtered = manifest.host_permissions.filter((permission) => {
            return !UNKNOWN_PERMISSIONS.includes(permission);
        });
        if (filtered.length !== manifest.host_permissions.length) {
            manifest.host_permissions = filtered;
            changed = true;
        }
    }

    if (manifest.manifest_version === 3 && manifest.background && typeof manifest.background.service_worker === 'string') {
        const worker = manifest.background.service_worker;
        delete manifest.background.service_worker;
        manifest.background.scripts = [worker];
        manifest.background.persistent = false;
        manifest.manifest_version = 2;
        changed = true;
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

    const shimPath = path.join(extPath, 'electron-compat.js');
    if (!fs.existsSync(shimPath)) {
        fs.writeFileSync(shimPath, COMPAT_SHIM, 'utf-8');
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

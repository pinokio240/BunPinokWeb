import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('browserAPI', {
    settings: {
        get: (key) => ipcRenderer.invoke('settings:get', key),
        set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
        getAll: () => ipcRenderer.invoke('settings:getAll'),
        clearBrowsingData: (types) => ipcRenderer.invoke('settings:clear-browsing-data', types),
        resetAll: () => ipcRenderer.invoke('settings:resetAll'),
        onChanged: (callback) => {
            ipcRenderer.on('settings:changed', (_event, all) => callback(all));
        }
    },

    tabs: {
        navigate: (tabId, url) => ipcRenderer.invoke('tab:navigate', tabId, url),
        create: (url) => ipcRenderer.invoke('tab:create', url),
        close: (tabId) => ipcRenderer.invoke('tab:close', tabId),
        select: (tabId) => ipcRenderer.invoke('tab:select', tabId),
        getAll: () => ipcRenderer.invoke('tab:getAll'),
        getActive: () => ipcRenderer.invoke('tab:getActive'),
        goBack: (tabId) => ipcRenderer.invoke('tab:goBack', tabId),
        goForward: (tabId) => ipcRenderer.invoke('tab:goForward', tabId),
        reload: (tabId) => ipcRenderer.invoke('tab:reload', tabId),
        stop: (tabId) => ipcRenderer.invoke('tab:stop', tabId),
        selectByIndex: (index) => ipcRenderer.invoke('tab:selectByIndex', index),
        onUpdated: (callback) => {
            ipcRenderer.on('tabs:updated', (_event, tabs) => callback(tabs));
        }
    },

    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
        toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen')
    },

    zoom: {
        in: () => ipcRenderer.invoke('zoom:in'),
        out: () => ipcRenderer.invoke('zoom:out'),
        reset: () => ipcRenderer.invoke('zoom:reset')
    },

    downloads: {
        setPath: () => ipcRenderer.invoke('downloads:setPath'),
        getAll: () => ipcRenderer.invoke('downloads:getAll'),
        clearFinished: () => ipcRenderer.invoke('downloads:clearFinished'),
        onUpdated: (callback) => {
            ipcRenderer.on('downloads:updated', (_event, items) => callback(items));
        }
    },

    history: {
        getAll: () => ipcRenderer.invoke('history:getAll'),
        search: (query) => ipcRenderer.invoke('history:search', query),
        clear: () => ipcRenderer.invoke('history:clear'),
        removeByTimestamp: (timestamp) => ipcRenderer.invoke('history:removeByTimestamp', timestamp)
    },

    bookmarks: {
        getAll: () => ipcRenderer.invoke('bookmarks:getAll'),
        add: (url, title) => ipcRenderer.invoke('bookmarks:add', url, title),
        remove: (url) => ipcRenderer.invoke('bookmarks:remove', url),
        toggle: (url, title) => ipcRenderer.invoke('bookmarks:toggle', url, title),
        has: (url) => ipcRenderer.invoke('bookmarks:has', url),
        toggleCurrent: () => ipcRenderer.invoke('bookmarks:toggleCurrent'),
        showContextMenu: (url, title, x, y) => ipcRenderer.invoke('bookmarks:showContextMenu', url, title, x, y),
        onUpdated: (callback) => {
            ipcRenderer.on('bookmarks:updated', (_event, bookmarks) => callback(bookmarks));
        },
        setBarVisible: (visible) => ipcRenderer.invoke('ui:setBookmarksBarVisible', visible)
    },

    appearance: {
        getTheme: () => ipcRenderer.invoke('appearance:getTheme'),
        onThemeChanged: (callback) => {
            ipcRenderer.on('appearance:theme-changed', (_event, theme) => callback(theme));
        }
    },

    ui: {
        onFocusOmnibox: (callback) => {
            ipcRenderer.on('ui:focus-omnibox', () => callback());
        },
        showAppMenu: (x, y) => ipcRenderer.invoke('ui:showAppMenu', x, y)
    },

    pip: {
        open: (tabId) => ipcRenderer.invoke('pip:open', tabId),
        openActive: () => ipcRenderer.invoke('pip:openActive')
    },

    omnibox: {
        parse: (input) => ipcRenderer.invoke('omnibox:parse', input)
    },

    extensions: {
        getAll: () => ipcRenderer.invoke('extensions:getAll'),
        loadUnpacked: () => ipcRenderer.invoke('extensions:loadUnpacked'),
        disable: (extId) => ipcRenderer.invoke('extensions:disable', extId),
        enable: (extId) => ipcRenderer.invoke('extensions:enable', extId),
        remove: (extId) => ipcRenderer.invoke('extensions:remove', extId),
        openPopup: (extId, x, y) => ipcRenderer.invoke('extensions:openPopup', extId, x, y),
        showContextMenu: (extId, x, y) => ipcRenderer.invoke('extensions:showContextMenu', extId, x, y),
        openOptions: (extId) => ipcRenderer.invoke('extensions:openOptions', extId),
        installFromUrl: (url, key) => ipcRenderer.invoke('extensions:installFromUrl', url, key),
        installFromFile: () => ipcRenderer.invoke('extensions:installFromFile'),
        onUpdated: (callback) => {
            ipcRenderer.on('extensions:updated', (_event, extensions) => callback(extensions));
        }
    },

    notifications: {
        show: (title, body, options) => ipcRenderer.invoke('notifications:show', title, body, options)
    },

    storage: {
        getPath: () => ipcRenderer.invoke('storage:getPath')
    },

    passwords: {
        getAll: () => ipcRenderer.invoke('passwords:getAll'),
        removeByIndex: (index) => ipcRenderer.invoke('passwords:removeByIndex', index),
        clear: () => ipcRenderer.invoke('passwords:clear')
    },

    about: {
        getInfo: () => ipcRenderer.invoke('about:getInfo'),
        checkUpdates: () => ipcRenderer.invoke('about:checkUpdates')
    },

    sitePermissions: {
        getAll: () => ipcRenderer.invoke('sitePermissions:getAll'),
        set: (host, permission, value) => ipcRenderer.invoke('sitePermissions:set', host, permission, value),
        remove: (host, permission) => ipcRenderer.invoke('sitePermissions:remove', host, permission)
    },

    reader: {
        open: (tabId) => ipcRenderer.invoke('reader:open', tabId),
        openActive: () => ipcRenderer.invoke('reader:openActive'),
        getContent: () => ipcRenderer.invoke('reader:getContent')
    },

    privacyShield: {
        getStats: () => ipcRenderer.invoke('privacyShield:getStats')
    },

    logs: {
        read: () => ipcRenderer.invoke('logs:read'),
        clear: () => ipcRenderer.invoke('logs:clear'),
        getPath: () => ipcRenderer.invoke('logs:getPath'),
        export: () => ipcRenderer.invoke('logs:export')
    }
});

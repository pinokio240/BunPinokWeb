import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('browserAPI', {
    settings: {
        get: (key) => ipcRenderer.invoke('settings:get', key),
        set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
        getAll: () => ipcRenderer.invoke('settings:getAll'),
        clearBrowsingData: (types) => ipcRenderer.invoke('settings:clear-browsing-data', types)
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
        onUpdated: (callback) => {
            ipcRenderer.on('tabs:updated', (_event, tabs) => callback(tabs));
        }
    },

    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized')
    },

    downloads: {
        setPath: () => ipcRenderer.invoke('downloads:setPath')
    },

    pip: {
        open: (tabId) => ipcRenderer.invoke('pip:open', tabId)
    },

    omnibox: {
        parse: (input) => ipcRenderer.invoke('omnibox:parse', input)
    },

    extensions: {
        getAll: () => ipcRenderer.invoke('extensions:getAll'),
        loadUnpacked: () => ipcRenderer.invoke('extensions:loadUnpacked'),
        unload: (extId) => ipcRenderer.invoke('extensions:unload', extId)
    },

    notifications: {
        show: (title, body, options) => ipcRenderer.invoke('notifications:show', title, body, options)
    },

    storage: {
        getPath: () => ipcRenderer.invoke('storage:getPath')
    }
});

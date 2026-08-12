import { app, BrowserWindow, WebContentsView, ipcMain, session, protocol, dialog, Notification, Menu, nativeTheme } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { OmniboxParser } from './src/omnibox.js';
import { TabManager } from './src/tabs.js';
import { SettingsStore } from './src/settings-store.js';
import { ExtensionManager } from './src/extensions.js';
import { NotificationManager } from './src/notifications.js';
import { PipManager } from './src/pip.js';
import { DownloadManager } from './src/downloads.js';
import { HistoryStore } from './src/history-store.js';

let mainWindow = null;
let chromeView = null;
let tabManager = null;
let settingsStore = null;
let extensionManager = null;
let notificationManager = null;
let pipManager = null;
let downloadManager = null;
let historyStore = null;

app.commandLine.appendSwitch('lang', 'ru-RU');

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: settingsStore.get('window.width', 1280),
        height: settingsStore.get('window.height', 800),
        minWidth: 800,
        minHeight: 600,
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    mainWindow.loadFile('pages/browser-chrome.html');

    mainWindow.on('resize', () => {
        const [width, height] = mainWindow.getSize();
        settingsStore.set('window.width', width);
        settingsStore.set('window.height', height);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function setupProtocolHandler() {
    protocol.handle('browser', (request) => {
        const url = new URL(request.url);
        const pageName = url.hostname;

        const pageMap = {
            'newtab': 'pages/newtab.html',
            'settings': 'pages/settings.html',
            'extensions': 'pages/extensions.html',
            'downloads': 'pages/downloads.html',
            'history': 'pages/history.html'
        };

        const filePath = pageMap[pageName];
        if (filePath) {
            const fullPath = path.join(__dirname, filePath);
            try {
                const mimeTypes = {
                    '.html': 'text/html; charset=utf-8',
                    '.css': 'text/css; charset=utf-8',
                    '.js': 'application/javascript; charset=utf-8',
                    '.png': 'image/png',
                    '.svg': 'image/svg+xml'
                };
                const ext = path.extname(fullPath).toLowerCase();
                let contentType = 'text/plain';
                if (mimeTypes[ext]) {
                    contentType = mimeTypes[ext];
                }
                const body = fs.readFileSync(fullPath);
                return new Response(body, { headers: { 'content-type': contentType } });
            } catch (err) {
                console.error(`Protocol handler error for ${fullPath}:`, err);
                return new Response('<h1>500 Internal Error</h1>', {
                    status: 500,
                    headers: { 'content-type': 'text/html' }
                });
            }
        }

        return new Response('<h1>404 Page not found</h1>', {
            status: 404,
            headers: { 'content-type': 'text/html' }
        });
    });
}

function setupIpcHandlers() {
    ipcMain.handle('settings:get', (_event, key) => {
        return settingsStore.get(key);
    });

    ipcMain.handle('settings:set', (_event, key, value) => {
        settingsStore.set(key, value);
        if (key === 'appearance.theme') {
            applyTheme(value);
        }
        return { success: true };
    });

    ipcMain.handle('settings:getAll', () => {
        return settingsStore.getAll();
    });

    ipcMain.handle('settings:clear-browsing-data', async (_event, types) => {
        try {
            if (types.cache) {
                await Promise.all(
                    tabManager.getAllViews().map(view =>
                        view.webContents.session.clearCache()
                    )
                );
            }
            if (types.cookies || types.localStorage) {
                const clearOptions = {};
                const storages = [];
                if (types.cookies) {
                    storages.push('cookies');
                }
                if (types.localStorage) {
                    storages.push('localstorage');
                }
                clearOptions.storages = storages;
                await session.defaultSession.clearStorageData(clearOptions);
            }
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('tab:navigate', (_event, tabId, url) => {
        const tab = tabManager.getTab(tabId);
        if (tab) {
            const parsed = OmniboxParser.parse(url);
            tabManager.navigateTab(tabId, parsed);
            return { success: true, url: parsed };
        }
        return { success: false, error: 'Tab not found' };
    });

    ipcMain.handle('tab:create', (_event, url) => {
        let parsed = 'browser://newtab';
        if (url) {
            parsed = OmniboxParser.parse(url);
        }
        const tabId = tabManager.createTab(parsed);
        updateChromeViewBounds();
        return { success: true, tabId };
    });

    ipcMain.handle('tab:close', (_event, tabId) => {
        tabManager.closeTab(tabId);
        updateChromeViewBounds();
        if (tabManager.getTabCount() === 0) {
            tabManager.createTab('browser://newtab');
            updateChromeViewBounds();
        }
        return { success: true };
    });

    ipcMain.handle('tab:select', (_event, tabId) => {
        tabManager.selectTab(tabId);
        updateChromeViewBounds();
        const activeTab = tabManager.getActiveTab();
        let result = { success: true, url: '', title: '' };
        if (activeTab) {
            result.url = activeTab.url;
            result.title = activeTab.title;
        }
        return result;
    });

    ipcMain.handle('tab:getAll', () => {
        return tabManager.getAllTabs().map(t => ({
            id: t.id,
            url: t.url,
            title: t.title,
            isLoading: t.isLoading
        }));
    });

    ipcMain.handle('tab:getActive', () => {
        const active = tabManager.getActiveTab();
        if (!active) {
            return null;
        }
        return { id: active.id, url: active.url, title: active.title, isLoading: active.isLoading };
    });

    ipcMain.handle('tab:goBack', (_event, tabId) => {
        const tab = tabManager.getTab(tabId);
        if (tab && tab.view.webContents.navigationHistory.canGoBack()) {
            tab.view.webContents.navigationHistory.goBack();
            return { success: true };
        }
        return { success: false };
    });

    ipcMain.handle('tab:goForward', (_event, tabId) => {
        const tab = tabManager.getTab(tabId);
        if (tab && tab.view.webContents.navigationHistory.canGoForward()) {
            tab.view.webContents.navigationHistory.goForward();
            return { success: true };
        }
        return { success: false };
    });

    ipcMain.handle('tab:reload', (_event, tabId) => {
        const tab = tabManager.getTab(tabId);
        if (tab) {
            tab.view.webContents.reload();
            return { success: true };
        }
        return { success: false };
    });

    ipcMain.handle('tab:stop', (_event, tabId) => {
        const tab = tabManager.getTab(tabId);
        if (tab) {
            tab.view.webContents.stop();
            return { success: true };
        }
        return { success: false };
    });

    ipcMain.handle('window:minimize', () => {
        if (mainWindow) {
            mainWindow.minimize();
        }
    });

    ipcMain.handle('window:maximize', () => {
        if (!mainWindow) {
            return false;
        }
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
        return mainWindow.isMaximized();
    });

    ipcMain.handle('window:close', () => {
        if (mainWindow) {
            mainWindow.close();
        }
    });

    ipcMain.handle('window:isMaximized', () => {
        if (!mainWindow) {
            return false;
        }
        return mainWindow.isMaximized();
    });

    ipcMain.handle('downloads:setPath', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'Выберите папку для загрузок'
        });
        if (!result.canceled && result.filePaths.length > 0) {
            settingsStore.set('downloads.path', result.filePaths[0]);
            return { success: true, path: result.filePaths[0] };
        }
        return { success: false };
    });

    ipcMain.handle('pip:open', (_event, tabId) => {
        pipManager.openPip(tabId, tabManager);
        return { success: true };
    });

    ipcMain.handle('omnibox:parse', (_event, input) => {
        return OmniboxParser.parse(input);
    });

    ipcMain.handle('extensions:getAll', () => {
        return extensionManager.getAllExtensions();
    });

    ipcMain.handle('extensions:loadUnpacked', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'Выберите папку расширения'
        });
        if (!result.canceled && result.filePaths.length > 0) {
            try {
                const extId = await extensionManager.loadExtension(result.filePaths[0]);
                return { success: true, id: extId, extensions: extensionManager.getAllExtensions() };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
        return { success: false, error: 'No folder selected' };
    });

    ipcMain.handle('extensions:unload', async (_event, extId) => {
        const result = await extensionManager.unloadExtension(extId);
        return { success: result, extensions: extensionManager.getAllExtensions() };
    });

    ipcMain.handle('notifications:show', (_event, title, body, options) => {
        notificationManager.show(title, body, options);
        return { success: true };
    });

    ipcMain.handle('storage:getPath', () => {
        return {
            downloads: settingsStore.get('downloads.path', ''),
            userData: app.getPath('userData'),
            home: app.getPath('home')
        };
    });

    ipcMain.handle('downloads:getAll', () => {
        return downloadManager.getAll();
    });

    ipcMain.handle('downloads:clearFinished', () => {
        downloadManager.clearFinished();
        return { success: true };
    });

    ipcMain.handle('appearance:getTheme', () => {
        return settingsStore.get('appearance.theme', 'system');
    });

    ipcMain.handle('window:toggleFullscreen', () => {
        if (!mainWindow) {
            return false;
        }
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
        return mainWindow.isFullScreen();
    });

    ipcMain.handle('zoom:in', () => {
        const tab = tabManager.getActiveTab();
        if (tab) {
            const current = tab.view.webContents.getZoomLevel();
            tab.view.webContents.setZoomLevel(current + 0.5);
        }
    });

    ipcMain.handle('zoom:out', () => {
        const tab = tabManager.getActiveTab();
        if (tab) {
            const current = tab.view.webContents.getZoomLevel();
            tab.view.webContents.setZoomLevel(current - 0.5);
        }
    });

    ipcMain.handle('zoom:reset', () => {
        const tab = tabManager.getActiveTab();
        if (tab) {
            tab.view.webContents.setZoomLevel(0);
        }
    });

    ipcMain.handle('ui:showAppMenu', (_event, x, y) => {
        const template = [
            { label: 'Новая вкладка', accelerator: 'Ctrl+T', click: () => { tabManager.createTab('browser://newtab'); updateChromeViewBounds(); } },
            { label: 'Загрузки', accelerator: 'Ctrl+J', click: () => { tabManager.createTab('browser://downloads'); updateChromeViewBounds(); } },
            { label: 'История', accelerator: 'Ctrl+H', click: () => { tabManager.createTab('browser://history'); updateChromeViewBounds(); } },
            { label: 'Настройки', click: () => { tabManager.createTab('browser://settings'); updateChromeViewBounds(); } },
            { label: 'Расширения', click: () => { tabManager.createTab('browser://extensions'); updateChromeViewBounds(); } },
            { type: 'separator' },
            { label: 'Увеличить масштаб', click: () => { const t = tabManager.getActiveTab(); if (t) { t.view.webContents.setZoomLevel(t.view.webContents.getZoomLevel() + 0.5); } } },
            { label: 'Уменьшить масштаб', click: () => { const t = tabManager.getActiveTab(); if (t) { t.view.webContents.setZoomLevel(t.view.webContents.getZoomLevel() - 0.5); } } },
            { label: 'Сбросить масштаб', click: () => { const t = tabManager.getActiveTab(); if (t) { t.view.webContents.setZoomLevel(0); } } },
            { type: 'separator' },
            { label: 'Во весь экран', click: () => { if (mainWindow) { mainWindow.setFullScreen(!mainWindow.isFullScreen()); } } },
            { type: 'separator' },
            { label: 'Выход', click: () => { app.quit(); } }
        ];
        const menu = Menu.buildFromTemplate(template);
        menu.popup({
            window: mainWindow,
            x: Math.round(x),
            y: Math.round(y)
        });
    });

    ipcMain.handle('history:getAll', () => {
        return historyStore.getAll();
    });

    ipcMain.handle('history:search', (_event, query) => {
        return historyStore.search(query);
    });

    ipcMain.handle('history:clear', () => {
        historyStore.clear();
        return { success: true };
    });

    ipcMain.handle('history:removeByTimestamp', (_event, timestamp) => {
        historyStore.removeByTimestamp(timestamp);
        return { success: true };
    });
}

function applyTheme(theme) {
    if (theme === 'dark') {
        nativeTheme.themeSource = 'dark';
    } else if (theme === 'light') {
        nativeTheme.themeSource = 'light';
    } else {
        nativeTheme.themeSource = 'system';
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('appearance:theme-changed', theme);
    }
}

function updateChromeViewBounds() {
    if (!mainWindow || !chromeView) return;
    const contentBounds = mainWindow.contentView.getBounds();
    const topBarHeight = 82;
    chromeView.setBounds({
        x: 0,
        y: topBarHeight,
        width: contentBounds.width,
        height: Math.max(0, contentBounds.height - topBarHeight)
    });
    tabManager.updateBounds({
        x: 0,
        y: topBarHeight,
        width: contentBounds.width,
        height: Math.max(0, contentBounds.height - topBarHeight)
    });
}

app.whenReady().then(async () => {
    settingsStore = new SettingsStore();
    notificationManager = new NotificationManager(settingsStore);
    pipManager = new PipManager();
    downloadManager = new DownloadManager(settingsStore, () => mainWindow);
    historyStore = new HistoryStore();

    setupProtocolHandler();

    const chromeViewOptions = {
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    };

    createMainWindow();

    chromeView = new WebContentsView(chromeViewOptions);
    chromeView.setBackgroundColor('#1a1a2e');
    mainWindow.contentView.addChildView(chromeView);

    tabManager = new TabManager(mainWindow, chromeViewOptions);
    tabManager.setHistoryStore(historyStore);
    extensionManager = new ExtensionManager(tabManager);

    const menuTemplate = [
        {
            label: 'Файл',
            submenu: [
                { label: 'Новая вкладка', accelerator: 'Ctrl+T', click: () => { tabManager.createTab('browser://newtab'); updateChromeViewBounds(); } },
                { label: 'Новое окно', accelerator: 'Ctrl+N', click: () => createMainWindow() },
                { type: 'separator' },
                { label: 'Загрузки', accelerator: 'Ctrl+J', click: () => { tabManager.createTab('browser://downloads'); updateChromeViewBounds(); } },
                { label: 'История', accelerator: 'Ctrl+H', click: () => { tabManager.createTab('browser://history'); updateChromeViewBounds(); } },
                { label: 'Настройки', click: () => { tabManager.createTab('browser://settings'); updateChromeViewBounds(); } },
                { type: 'separator' },
                { role: 'quit', label: 'Выход' }
            ]
        },
        {
            label: 'Правка',
            submenu: [
                { role: 'undo', label: 'Отменить' },
                { role: 'redo', label: 'Повторить' },
                { type: 'separator' },
                { role: 'cut', label: 'Вырезать' },
                { role: 'copy', label: 'Копировать' },
                { role: 'paste', label: 'Вставить' },
                { role: 'selectAll', label: 'Выделить всё' }
            ]
        },
        {
            label: 'Вид',
            submenu: [
                { label: 'Назад', accelerator: 'Alt+Left', click: () => { const t = tabManager.getActiveTab(); if (t && t.view && t.view.webContents && t.view.webContents.navigationHistory && t.view.webContents.navigationHistory.canGoBack()) { t.view.webContents.navigationHistory.goBack(); } } },
                { label: 'Вперёд', accelerator: 'Alt+Right', click: () => { const t = tabManager.getActiveTab(); if (t && t.view && t.view.webContents && t.view.webContents.navigationHistory && t.view.webContents.navigationHistory.canGoForward()) { t.view.webContents.navigationHistory.goForward(); } } },
                { label: 'Обновить', accelerator: 'Ctrl+R', click: () => { const t = tabManager.getActiveTab(); if (t) t.view.webContents.reload(); } },
                { type: 'separator' },
                { label: 'Закрыть вкладку', accelerator: 'Ctrl+W', click: () => { const t = tabManager.getActiveTab(); if (t) { tabManager.closeTab(t.id); updateChromeViewBounds(); if (tabManager.getTabCount() === 0) { tabManager.createTab('browser://newtab'); updateChromeViewBounds(); } } } },
                { type: 'separator' },
                { role: 'toggleDevTools', label: 'Инструменты разработчика' },
                { type: 'separator' },
                { role: 'resetZoom', label: 'Сбросить масштаб' },
                { role: 'zoomIn', label: 'Увеличить' },
                { role: 'zoomOut', label: 'Уменьшить' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: 'Во весь экран' }
            ]
        },
        {
            label: 'Справка',
            submenu: [
                { label: 'О BunPinokWeb', click: () => { tabManager.createTab('browser://newtab'); updateChromeViewBounds(); } }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

    setupIpcHandlers();

    mainWindow.on('resize', updateChromeViewBounds);
    updateChromeViewBounds();

    applyTheme(settingsStore.get('appearance.theme', 'system'));

    const startupUrl = settingsStore.get('onStartup.url', 'browser://newtab');
    const parsed = OmniboxParser.parse(startupUrl);
    tabManager.createTab(parsed);
    updateChromeViewBounds();

    downloadManager.attach(session.defaultSession);

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('tabs:updated', tabManager.getAllTabs().map(t => ({
            id: t.id,
            url: t.url,
            title: t.title,
            isLoading: t.isLoading
        })));
    });

    mainWindow.webContents.on('context-menu', (_event, params) => {
        const { editFlags } = params;
        const contextMenuTemplate = [
            { label: 'Вырезать', role: 'cut', enabled: editFlags.canCut },
            { label: 'Копировать', role: 'copy', enabled: editFlags.canCopy },
            { label: 'Вставить', role: 'paste', enabled: editFlags.canPaste },
            { type: 'separator' },
            { label: 'Выделить всё', role: 'selectAll', enabled: editFlags.canSelectAll }
        ];
        const menu = Menu.buildFromTemplate(contextMenuTemplate);
        menu.popup({ window: mainWindow });
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['notifications', 'media', 'geolocation'];
        if (allowedPermissions.includes(permission)) {
            callback(true);
        } else {
            callback(false);
        }
    });
});

app.on('before-quit', () => {
    pipManager.closeAll();
    if (tabManager) tabManager.destroy();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

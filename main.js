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
import { BookmarkStore } from './src/bookmark-store.js';
import { PermissionDialogManager } from './src/permission-dialog.js';
import { PasswordStore } from './src/password-store.js';
import { AuthDialogManager } from './src/auth-dialog.js';

let mainWindow = null;
let chromeView = null;
let tabManager = null;
let settingsStore = null;
let extensionManager = null;
let notificationManager = null;
let pipManager = null;
let downloadManager = null;
let historyStore = null;
let bookmarkStore = null;
let permissionDialogManager = null;
let passwordStore = null;
let authDialogManager = null;
let bookmarksBarVisible = false;

app.commandLine.appendSwitch('lang', 'ru-RU');

function readHardwareAccelerationSetting() {
    try {
        const userData = app.getPath('userData');
        const configPath = path.join(userData, 'settings.json');
        if (fs.existsSync(configPath)) {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (data['system.hardwareAcceleration'] === false) {
                app.disableHardwareAcceleration();
            }
        }
    } catch (err) {
        console.error('Не удалось прочитать настройку аппаратного ускорения:', err);
    }
}

readHardwareAccelerationSetting();

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
            'history': 'pages/history.html',
            'bookmarks': 'pages/bookmarks.html',
            'privacy': 'pages/privacy.html',
            'passwords': 'pages/passwords.html',
            'about': 'pages/about.html'
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
        if (key === 'appearance.showBookmarksBar') {
            bookmarksBarVisible = value === true;
            updateChromeViewBounds();
        }
        if (key === 'appearance.pageZoom') {
            tabManager.setPageZoom(value);
        }
        if (key === 'appearance.fontSize') {
            tabManager.setDefaultFontSize(value);
        }
        if (key === 'language.spellcheck') {
            applySpellcheckSettings();
        }
        if (key === 'language.spellcheckLanguages') {
            applySpellcheckSettings();
        }
        if (key === 'system.proxyMode' || key === 'system.proxyServer') {
            applyProxySettings();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('settings:changed', settingsStore.getAll());
        }
        return { success: true };
    });

    ipcMain.handle('settings:getAll', () => {
        return settingsStore.getAll();
    });

    ipcMain.handle('settings:resetAll', () => {
        settingsStore.resetAll();
        applyTheme(settingsStore.get('appearance.theme', 'system'));
        applySpellcheckSettings();
        applyProxySettings();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('settings:changed', settingsStore.getAll());
        }
        return { success: true };
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
            const parsed = parseUserInput(url);
            tabManager.navigateTab(tabId, parsed);
            return { success: true, url: parsed };
        }
        return { success: false, error: 'Tab not found' };
    });

    ipcMain.handle('tab:create', (_event, url) => {
        let parsed = 'browser://newtab';
        if (url) {
            parsed = parseUserInput(url);
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

    ipcMain.handle('pip:open', async (_event, tabId) => {
        return await pipManager.openPip(tabId, tabManager);
    });

    ipcMain.handle('pip:openActive', async () => {
        const tab = tabManager.getActiveTab();
        if (!tab) {
            return { success: false, error: 'Нет активной вкладки' };
        }
        return await pipManager.openPip(tab.id, tabManager);
    });

    ipcMain.handle('omnibox:parse', (_event, input) => {
        return OmniboxParser.parse(input, settingsStore.get('search.engine', 'google'));
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
                mainWindow.webContents.send('extensions:updated', extensionManager.getAllExtensions());
                return { success: true, id: extId, extensions: extensionManager.getAllExtensions() };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
        return { success: false, error: 'Папка не выбрана' };
    });

    ipcMain.handle('extensions:disable', async (_event, extId) => {
        await extensionManager.disableExtension(extId);
        mainWindow.webContents.send('extensions:updated', extensionManager.getAllExtensions());
        return { success: true, extensions: extensionManager.getAllExtensions() };
    });

    ipcMain.handle('extensions:enable', async (_event, extId) => {
        const result = await extensionManager.enableExtension(extId);
        mainWindow.webContents.send('extensions:updated', extensionManager.getAllExtensions());
        return { success: result, extensions: extensionManager.getAllExtensions() };
    });

    ipcMain.handle('extensions:remove', async (_event, extId) => {
        await extensionManager.removeExtension(extId);
        mainWindow.webContents.send('extensions:updated', extensionManager.getAllExtensions());
        return { success: true, extensions: extensionManager.getAllExtensions() };
    });

    ipcMain.handle('extensions:openPopup', (_event, extId, x, y) => {
        const popupPath = extensionManager.getPopupPath(extId);
        if (!popupPath) {
            return { success: false };
        }
        openExtensionPopup(extId, popupPath, x, y);
        return { success: true };
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
            { label: 'Закладки', accelerator: 'Ctrl+Shift+O', click: () => { tabManager.createTab('browser://bookmarks'); updateChromeViewBounds(); } },
            { label: 'Добавить в закладки', accelerator: 'Ctrl+D', click: () => { const t = tabManager.getActiveTab(); if (t) { bookmarkStore.add(t.url, t.title); mainWindow.webContents.send('bookmarks:updated', bookmarkStore.getAll()); } } },
            { label: 'Перевести страницу', click: () => { translateActiveTab(); } },
            { label: 'Картинка в картинке (PiP)', click: () => { const t = tabManager.getActiveTab(); if (t) { pipManager.openPip(t.id, tabManager); } } },
            { label: 'Пароли', click: () => { tabManager.createTab('browser://passwords'); updateChromeViewBounds(); } },
            { label: 'Настройки', click: () => { tabManager.createTab('browser://settings'); updateChromeViewBounds(); } },
            { label: 'Приватность', click: () => { tabManager.createTab('browser://privacy'); updateChromeViewBounds(); } },
            { label: 'Расширения', click: () => { tabManager.createTab('browser://extensions'); updateChromeViewBounds(); } },
            { type: 'separator' },
            { label: 'Увеличить масштаб', click: () => { const t = tabManager.getActiveTab(); if (t) { t.view.webContents.setZoomLevel(t.view.webContents.getZoomLevel() + 0.5); } } },
            { label: 'Уменьшить масштаб', click: () => { const t = tabManager.getActiveTab(); if (t) { t.view.webContents.setZoomLevel(t.view.webContents.getZoomLevel() - 0.5); } } },
            { label: 'Сбросить масштаб', click: () => { const t = tabManager.getActiveTab(); if (t) { t.view.webContents.setZoomLevel(0); } } },
            { type: 'separator' },
            { label: 'О браузере', click: () => { tabManager.createTab('browser://about'); updateChromeViewBounds(); } },
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

    ipcMain.handle('bookmarks:getAll', () => {
        return bookmarkStore.getAll();
    });

    ipcMain.handle('bookmarks:add', (_event, url, title) => {
        bookmarkStore.add(url, title);
        mainWindow.webContents.send('bookmarks:updated', bookmarkStore.getAll());
        return { success: true };
    });

    ipcMain.handle('bookmarks:remove', (_event, url) => {
        bookmarkStore.removeByUrl(url);
        mainWindow.webContents.send('bookmarks:updated', bookmarkStore.getAll());
        return { success: true };
    });

    ipcMain.handle('bookmarks:has', (_event, url) => {
        return bookmarkStore.has(url);
    });

    ipcMain.handle('bookmarks:toggle', (_event, url, title) => {
        if (bookmarkStore.has(url)) {
            bookmarkStore.removeByUrl(url);
            mainWindow.webContents.send('bookmarks:updated', bookmarkStore.getAll());
            return { added: false };
        }
        bookmarkStore.add(url, title);
        mainWindow.webContents.send('bookmarks:updated', bookmarkStore.getAll());
        return { added: true };
    });

    ipcMain.handle('bookmarks:showContextMenu', (_event, url, title, x, y) => {
        const template = [
            { label: 'Открыть закладку', click: () => { tabManager.createTab(url); updateChromeViewBounds(); } },
            { label: 'Удалить закладку', click: () => { bookmarkStore.removeByUrl(url); mainWindow.webContents.send('bookmarks:updated', bookmarkStore.getAll()); } }
        ];
        const menu = Menu.buildFromTemplate(template);
        menu.popup({
            window: mainWindow,
            x: Math.round(x),
            y: Math.round(y)
        });
    });

    ipcMain.handle('bookmarks:toggleCurrent', () => {
        const tab = tabManager.getActiveTab();
        if (!tab) {
            return { added: false };
        }
        if (bookmarkStore.has(tab.url)) {
            bookmarkStore.removeByUrl(tab.url);
            mainWindow.webContents.send('bookmarks:updated', bookmarkStore.getAll());
            return { added: false };
        }
        bookmarkStore.add(tab.url, tab.title);
        mainWindow.webContents.send('bookmarks:updated', bookmarkStore.getAll());
        return { added: true };
    });

    ipcMain.handle('ui:setBookmarksBarVisible', (_event, visible) => {
        bookmarksBarVisible = visible;
        updateChromeViewBounds();
        return { success: true };
    });

    ipcMain.handle('page:translate', () => {
        translateActiveTab();
        return { success: true };
    });

    ipcMain.handle('passwords:getAll', () => {
        return passwordStore.getAll();
    });

    ipcMain.handle('passwords:removeByIndex', (_event, index) => {
        passwordStore.removeByIndex(index);
        return { success: true };
    });

    ipcMain.handle('passwords:clear', () => {
        passwordStore.clear();
        return { success: true };
    });

    ipcMain.handle('about:getInfo', () => {
        let osName = process.platform;
        if (process.platform === 'win32') {
            osName = 'Windows';
        } else if (process.platform === 'darwin') {
            osName = 'macOS';
        } else if (process.platform === 'linux') {
            osName = 'Linux';
        }
        return {
            appVersion: app.getVersion(),
            electron: process.versions.electron,
            chromium: process.versions.chrome,
            node: process.versions.node,
            os: osName,
            arch: process.arch,
            userAgent: tabManager._getUserAgent()
        };
    });

    ipcMain.handle('about:checkUpdates', async () => {
        try {
            const response = await fetch('https://api.github.com/repos/pinokio240/BunPinokWeb/releases/latest');
            if (!response.ok) {
                return { error: 'HTTP ' + response.status };
            }
            const data = await response.json();
            const latestVersion = data.tag_name || '';
            const currentVersion = app.getVersion();
            let updateAvailable = false;
            if (latestVersion && latestVersion !== currentVersion) {
                updateAvailable = true;
            }
            return { updateAvailable: updateAvailable, latestVersion: latestVersion };
        } catch (err) {
            return { error: err.message };
        }
    });
}

function parseUserInput(input) {
    return OmniboxParser.parse(input, settingsStore.get('search.engine', 'google'));
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

function applySpellcheckSettings() {
    const enabled = settingsStore.get('language.spellcheck', true);
    if (!enabled) {
        session.defaultSession.setSpellCheckerLanguages([]);
        return;
    }
    const langsSetting = settingsStore.get('language.spellcheckLanguages', 'ru,en');
    const langs = String(langsSetting).split(',').map((item) => {
        return item.trim();
    }).filter((item) => {
        return item.length > 0;
    });
    session.defaultSession.setSpellCheckerLanguages(langs);
}

function translateActiveTab() {
    const tab = tabManager.getActiveTab();
    if (!tab) {
        return;
    }
    if (tab.url.startsWith('browser://')) {
        return;
    }
    const translateUrl = 'https://translate.google.com/translate?sl=auto&tl=ru&u=' + encodeURIComponent(tab.url);
    tabManager.navigateTab(tab.id, translateUrl);
}

function applyProxySettings() {
    const mode = settingsStore.get('system.proxyMode', 'system');
    if (mode === 'none') {
        session.defaultSession.setProxy({ mode: 'direct' });
    } else if (mode === 'manual') {
        const server = settingsStore.get('system.proxyServer', '');
        session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: server });
    } else {
        session.defaultSession.setProxy({ mode: 'system' });
    }
}

let extensionPopupWindows = [];

function openExtensionPopup(extId, popupPath, x, y) {
    const win = new BrowserWindow({
        width: 400,
        height: 500,
        frame: false,
        resizable: false,
        show: false,
        x: Math.round(x),
        y: Math.round(y),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    win.on('closed', () => {
        extensionPopupWindows = extensionPopupWindows.filter((item) => {
            return item !== win;
        });
    });

    win.on('blur', () => {
        if (!win.isDestroyed()) {
            win.close();
        }
    });

    win.loadFile(popupPath);
    win.once('ready-to-show', () => {
        win.show();
        win.focus();
    });

    extensionPopupWindows.push(win);
}

function updateChromeViewBounds() {
    if (!mainWindow || !chromeView) return;
    const contentBounds = mainWindow.contentView.getBounds();
    let topBarHeight = 82;
    if (bookmarksBarVisible) {
        topBarHeight = topBarHeight + 30;
    }
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
    bookmarkStore = new BookmarkStore();
    permissionDialogManager = new PermissionDialogManager();
    passwordStore = new PasswordStore();
    authDialogManager = new AuthDialogManager();
    bookmarksBarVisible = settingsStore.get('appearance.showBookmarksBar', false);

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
    tabManager.setSettingsStore(settingsStore);
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
                { label: 'Закладки', accelerator: 'Ctrl+Shift+O', click: () => { tabManager.createTab('browser://bookmarks'); updateChromeViewBounds(); } },
                { label: 'Добавить страницу в закладки', accelerator: 'Ctrl+D', click: () => { const t = tabManager.getActiveTab(); if (t) { bookmarkStore.add(t.url, t.title); mainWindow.webContents.send('bookmarks:updated', bookmarkStore.getAll()); } } },
                { type: 'separator' },
                { label: 'Настройки', click: () => { tabManager.createTab('browser://settings'); updateChromeViewBounds(); } },
                { label: 'Приватность', click: () => { tabManager.createTab('browser://privacy'); updateChromeViewBounds(); } },
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
                { label: 'О BunPinokWeb', click: () => { tabManager.createTab('browser://about'); updateChromeViewBounds(); } }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

    setupIpcHandlers();

    mainWindow.on('resize', updateChromeViewBounds);
    updateChromeViewBounds();

    applyTheme(settingsStore.get('appearance.theme', 'system'));
    applySpellcheckSettings();
    applyProxySettings();

    app.on('login', (event, _webContents, _details, authInfo, callback) => {
        event.preventDefault();
        const host = authInfo.host;
        const realm = authInfo.realm;
        const saved = passwordStore.find(host, realm);
        if (saved) {
            callback(saved.username, saved.password);
            return;
        }
        authDialogManager.requestCredentials(host, realm).then((credentials) => {
            if (!credentials) {
                callback();
                return;
            }
            callback(credentials.username, credentials.password);
            if (credentials.remember) {
                passwordStore.save(host, realm, credentials.username, credentials.password);
            }
        });
    });

    const startupUrl = settingsStore.get('onStartup.url', 'browser://newtab');
    const parsed = parseUserInput(startupUrl);
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
        handlePermissionRequest(webContents, permission, callback);
    });

    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const dntEnabled = settingsStore.get('privacy.dnt', false);
        if (dntEnabled) {
            const requestHeaders = details.requestHeaders;
            const headers = {};
            for (const key of Object.keys(requestHeaders)) {
                headers[key] = requestHeaders[key];
            }
            headers['DNT'] = '1';
            callback({ requestHeaders: headers });
        } else {
            callback({ requestHeaders: details.requestHeaders });
        }
    });
});

function handlePermissionRequest(webContents, permission, callback) {
    let origin = 'неизвестный сайт';
    if (webContents) {
        try {
            const url = new URL(webContents.getURL());
            origin = url.hostname;
        } catch (err) {
            origin = 'неизвестный сайт';
        }
    }

    if (permission === 'notifications') {
        resolvePermission('privacy.notifications', permission, origin, callback);
        return;
    }
    if (permission === 'geolocation') {
        resolvePermission('privacy.geolocation', permission, origin, callback);
        return;
    }
    if (permission === 'media') {
        const cameraMode = settingsStore.get('privacy.camera', 'allow');
        const microphoneMode = settingsStore.get('privacy.microphone', 'allow');
        if (cameraMode === 'ask' || microphoneMode === 'ask') {
            permissionDialogManager.request('media', origin).then((allowed) => {
                callback(allowed);
            });
            return;
        }
        if (cameraMode === 'allow' || microphoneMode === 'allow') {
            callback(true);
        } else {
            callback(false);
        }
        return;
    }
    callback(false);
}

function resolvePermission(settingKey, permission, origin, callback) {
    const mode = settingsStore.get(settingKey, 'allow');
    if (mode === 'ask') {
        permissionDialogManager.request(permission, origin).then((allowed) => {
            callback(allowed);
        });
    } else if (mode === 'allow') {
        callback(true);
    } else {
        callback(false);
    }
}

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

import { app, BrowserWindow, WebContentsView, ipcMain, session, protocol, dialog, Notification, Menu, nativeTheme, webContents } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

process.on('warning', (warning) => {
    const message = warning && warning.message ? String(warning.message) : '';
    if (message.includes('Manifest version 2 is deprecated')) {
        return;
    }
    if (message.includes('Warnings loading extension')) {
        return;
    }
    console.warn(warning);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
}

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
import { CrxInstaller } from './src/crx-installer.js';
import { XpiConverter } from './src/xpi-converter.js';
import { SessionStore } from './src/session-store.js';
import { DnrBridge } from './src/dnr-bridge.js';
import { PrivacyShield } from './src/privacy-shield.js';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import { Logger } from './src/logger.js';

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
let crxInstaller = null;
let xpiConverter = null;
let sessionStore = null;
let dnrBridge = null;
let privacyShield = null;
let chromeExtensions = null;
let logger = null;
let bookmarksBarVisible = false;
const readerContent = new Map();
const offlineFailedUrls = new Map();

function openReader(tabId) {
    const tab = tabManager.getTab(tabId);
    if (!tab) {
        return;
    }
    if (tab.url.startsWith('browser://')) {
        return;
    }
    const extractScript = `(() => {
        const title = document.title;
        const candidates = document.querySelectorAll('article, main, [role="main"], .content, .article, .post, #content');
        let container = document.body;
        if (candidates.length > 0) {
            container = candidates[0];
        }
        const clone = container.cloneNode(true);
        clone.querySelectorAll('script, style, link, iframe, nav, header, footer, aside, form, button, .ad, .ads, .advert, [class*="advert"], [class*="banner"], [class*="cookie"]').forEach((el) => { el.remove(); });
        return { title: title, html: clone.innerHTML, url: location.href };
    })()`;
    tab.view.webContents.executeJavaScript(extractScript).then((content) => {
        if (!content || !content.html) {
            return;
        }
        readerContent.set(tabId, content);
        tabManager.navigateTab(tabId, 'browser://reader');
    }).catch(() => {});
}

app.commandLine.appendSwitch('lang', 'ru-RU');

function readHardwareAccelerationSetting() {
    try {
        const userData = app.getPath('userData');
        const configPath = path.join(userData, 'settings.json');
        let data = {};
        if (fs.existsSync(configPath)) {
            data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
        if (data['system.hardwareAcceleration'] === false) {
            app.disableHardwareAcceleration();
        }
        if (data['network.http2'] !== true) {
            app.commandLine.appendSwitch('disable-http2');
        }
        if (data['network.quic'] !== true) {
            app.commandLine.appendSwitch('disable-quic');
        }
    } catch (err) {
        console.error('Не удалось прочитать настройку аппаратного ускорения:', err);
    }

    try {
        const logFile = path.join(app.getPath('userData'), 'logs', 'chromium.log');
        app.commandLine.appendSwitch('enable-logging', 'file');
        app.commandLine.appendSwitch('log-file', logFile);
    } catch (err) {
        console.error('Не удалось включить логи Chromium:', err);
    }
}

readHardwareAccelerationSetting();

function createMainWindow() {
    const windowOptions = {
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
    };
    const savedX = settingsStore.get('window.x');
    const savedY = settingsStore.get('window.y');
    if (typeof savedX === 'number' && typeof savedY === 'number') {
        windowOptions.x = savedX;
        windowOptions.y = savedY;
    }
    mainWindow = new BrowserWindow(windowOptions);

    if (settingsStore.get('window.isMaximized', false) === true) {
        mainWindow.maximize();
    }

    mainWindow.loadFile('pages/browser-chrome.html');

    mainWindow.on('resize', () => {
        const [width, height] = mainWindow.getSize();
        settingsStore.set('window.width', width);
        settingsStore.set('window.height', height);
    });

    let moveSaveTimer = null;
    mainWindow.on('move', () => {
        if (moveSaveTimer) {
            clearTimeout(moveSaveTimer);
        }
        moveSaveTimer = setTimeout(() => {
            const [x, y] = mainWindow.getPosition();
            settingsStore.set('window.x', x);
            settingsStore.set('window.y', y);
        }, 500);
    });

    mainWindow.on('maximize', () => {
        settingsStore.set('window.isMaximized', true);
    });

    mainWindow.on('unmaximize', () => {
        settingsStore.set('window.isMaximized', false);
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
            'about': 'pages/about.html',
            'reader': 'pages/reader.html',
            'logs': 'pages/logs.html',
            'offline': 'pages/offline.html',
            'tasks': 'pages/tasks.html'
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
                return new Response(body, {
                    headers: {
                        'content-type': contentType,
                        'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; font-src * data:; connect-src *"
                    }
                });
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

    ipcMain.handle('tab:selectByIndex', (_event, index) => {
        tabManager.selectTabByIndex(index);
        return { success: true };
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
            properties: ['openDirectory', 'multiSelections'],
            title: 'Выберите папки расширений'
        });
        if (!result.canceled && result.filePaths.length > 0) {
            const loaded = [];
            const errors = [];
            for (const extPath of result.filePaths) {
                try {
                    const extId = await extensionManager.loadExtension(extPath);
                    loaded.push(extId);
                    logger.info('extensions', 'Загружено расширение из папки: ' + extPath + ' (id=' + extId + ')');
                } catch (err) {
                    errors.push(extPath + ': ' + err.message);
                    logger.error('extensions', 'Ошибка загрузки ' + extPath + ': ' + err.message);
                }
            }
            mainWindow.webContents.send('extensions:updated', extensionManager.getAllExtensions());
            return {
                success: loaded.length > 0,
                loadedCount: loaded.length,
                errors: errors,
                extensions: extensionManager.getAllExtensions()
            };
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

    ipcMain.handle('extensions:openOptions', (_event, extId) => {
        const optionsPage = extensionManager.getOptionsPage(extId);
        if (!optionsPage) {
            return { success: false, error: 'У расширения нет страницы настроек' };
        }
        const url = 'chrome-extension://' + extId + '/' + optionsPage;
        tabManager.createTab(url);
        updateChromeViewBounds();
        logger.info('extensions', 'Открыты настройки расширения: ' + url);
        return { success: true, url: url };
    });

    ipcMain.handle('extensions:showContextMenu', (_event, extId, x, y) => {
        const optionsPage = extensionManager.getOptionsPage(extId);
        const popupPath = extensionManager.getPopupPath(extId);
        const template = [];
        if (popupPath) {
            template.push({
                label: 'Открыть попап',
                click: () => {
                    openExtensionPopup(extId, popupPath, Math.round(x), Math.round(y));
                }
            });
        }
        if (optionsPage) {
            template.push({
                label: 'Настройки',
                click: () => {
                    const url = 'chrome-extension://' + extId + '/' + optionsPage;
                    tabManager.createTab(url);
                    updateChromeViewBounds();
                    logger.info('extensions', 'Открыты настройки расширения (ПКМ): ' + url);
                }
            });
        }
        template.push({
            label: 'Управление расширениями',
            click: () => {
                tabManager.createTab('browser://extensions');
                updateChromeViewBounds();
            }
        });
        const menu = Menu.buildFromTemplate(template);
        menu.popup({
            window: mainWindow,
            x: Math.round(x),
            y: Math.round(y)
        });
        return { success: true };
    });

    ipcMain.handle('extensions:installFromUrl', async (_event, url, overrideKey) => {
        try {
            logger.info('extensions', 'Установка из магазина: ' + url);
            const result = await crxInstaller.installFromUrl(url, overrideKey || '');
            logger.info('extensions', 'Установлено: ' + result.id);
            mainWindow.webContents.send('extensions:updated', extensionManager.getAllExtensions());
            return { success: true, id: result.id };
        } catch (err) {
            logger.error('extensions', 'Ошибка установки из магазина: ' + err.message);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('extensions:installFromFile', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            title: 'Выберите файл расширения',
            filters: [
                { name: 'Расширения (Chrome/Edge/Opera/Firefox)', extensions: ['crx', 'nex', 'zip', 'xpi'] }
            ]
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'Файл не выбран' };
        }
        try {
            const filePath = result.filePaths[0];
            const lowerPath = filePath.toLowerCase();
            let installed = null;
            if (lowerPath.endsWith('.xpi')) {
                const targetDir = path.join(app.getPath('userData'), 'extensions', 'installed', 'xpi-' + Date.now());
                xpiConverter.convert(filePath, targetDir);
                const extId = await extensionManager.loadExtension(targetDir);
                installed = { id: extId };
            } else {
                installed = await crxInstaller.installFromFile(filePath);
            }
            mainWindow.webContents.send('extensions:updated', extensionManager.getAllExtensions());
            return { success: true, id: installed.id };
        } catch (err) {
            return { success: false, error: err.message };
        }
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
            { label: 'Режим чтения', click: () => { const t = tabManager.getActiveTab(); if (t) { openReader(t.id); } } },
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
                { label: 'Журнал браузера', click: () => { tabManager.createTab('browser://logs'); updateChromeViewBounds(); } },
                { label: 'Диспетчер задач', click: () => { tabManager.createTab('browser://tasks'); updateChromeViewBounds(); } },
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

    ipcMain.handle('sitePermissions:getAll', () => {
        return settingsStore.get('privacy.sitePermissions', {});
    });

    ipcMain.handle('sitePermissions:set', (_event, host, permission, value) => {
        const safeHost = String(host || '').trim().toLowerCase();
        if (!safeHost || safeHost.includes('/') || safeHost.includes(' ')) {
            return { success: false, error: 'Некорректное имя сайта' };
        }
        const allowedPermissions = ['notifications', 'geolocation', 'camera', 'microphone'];
        if (!allowedPermissions.includes(permission)) {
            return { success: false, error: 'Некорректное разрешение' };
        }
        const allowedValues = ['allow', 'block', 'ask'];
        if (!allowedValues.includes(value)) {
            return { success: false, error: 'Некорректное значение' };
        }
        const sitePermissions = settingsStore.get('privacy.sitePermissions', {});
        const copy = {};
        for (const key of Object.keys(sitePermissions)) {
            copy[key] = sitePermissions[key];
        }
        if (!copy[safeHost]) {
            copy[safeHost] = {};
        }
        copy[safeHost][permission] = value;
        settingsStore.set('privacy.sitePermissions', copy);
        return { success: true, all: copy };
    });

    ipcMain.handle('sitePermissions:remove', (_event, host, permission) => {
        const sitePermissions = settingsStore.get('privacy.sitePermissions', {});
        const copy = {};
        for (const key of Object.keys(sitePermissions)) {
            if (key === host && !permission) {
                continue;
            }
            copy[key] = {};
            for (const permKey of Object.keys(sitePermissions[key])) {
                if (key === host && permKey === permission) {
                    continue;
                }
                copy[key][permKey] = sitePermissions[key][permKey];
            }
            if (Object.keys(copy[key]).length === 0) {
                delete copy[key];
            }
        }
        settingsStore.set('privacy.sitePermissions', copy);
        return { success: true, all: copy };
    });

    ipcMain.handle('reader:open', (_event, tabId) => {
        openReader(tabId);
        return { success: true };
    });

    ipcMain.handle('reader:openActive', () => {
        const tab = tabManager.getActiveTab();
        if (tab) {
            openReader(tab.id);
        }
        return { success: true };
    });

    ipcMain.handle('reader:getContent', (event) => {
        const tab = tabManager.findTabByWebContents(event.sender);
        if (!tab) {
            return null;
        }
        const content = readerContent.get(tab.id);
        if (content) {
            readerContent.delete(tab.id);
        }
        return content || null;
    });

    ipcMain.handle('net:getFailedUrl', (event) => {
        const tab = tabManager.findTabByWebContents(event.sender);
        if (!tab) {
            return { url: '' };
        }
        return { url: offlineFailedUrls.get(tab.id) || '' };
    });

    ipcMain.handle('net:retry', (event) => {
        const tab = tabManager.findTabByWebContents(event.sender);
        if (!tab) {
            return { success: false };
        }
        const url = offlineFailedUrls.get(tab.id);
        if (url) {
            offlineFailedUrls.delete(tab.id);
            tabManager.navigateTab(tab.id, url);
            return { success: true };
        }
        return { success: false };
    });

    ipcMain.handle('privacyShield:getStats', () => {
        return {
            stats: privacyShield.getStats(),
            recent: privacyShield.getRecentBlocked()
        };
    });

    ipcMain.handle('logs:read', () => {
        return logger.readTail(1000);
    });

    ipcMain.handle('logs:clear', () => {
        logger.clear();
        return { success: true };
    });

    ipcMain.handle('logs:getPath', () => {
        return {
            main: logger.getPath(),
            chromium: path.join(app.getPath('userData'), 'logs', 'chromium.log')
        };
    });

    ipcMain.handle('logs:export', () => {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const result = dialog.showSaveDialogSync(mainWindow, {
            title: 'Экспортировать журнал',
            defaultPath: path.join(app.getPath('downloads'), 'bunpinokweb-log-' + stamp + '.txt'),
            buttonLabel: 'Сохранить',
            filters: [
                { name: 'Текстовый файл', extensions: ['txt'] }
            ]
        });
        if (!result) {
            return { success: false, error: 'Отменено' };
        }
        try {
            const content = logger.readTail(100000);
            fs.writeFileSync(result, content, 'utf-8');
            logger.info('logs', 'Журнал экспортирован: ' + result);
            return { success: true, path: result };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('tasks:getList', () => {
        const metrics = app.getAppMetrics();
        const allWc = webContents.getAllWebContents();
        const wcByPid = new Map();
        for (const wc of allWc) {
            try {
                if (!wc.isDestroyed()) {
                    wcByPid.set(wc.getOSProcessId(), wc);
                }
            } catch (err) {
                // webContents недоступен
            }
        }
        const items = [];
        let totalMemoryKB = 0;
        for (const m of metrics) {
            const pid = m.pid;
            let name = 'Процесс';
            let title = '';
            let url = '';
            let killable = false;
            const wc = wcByPid.get(pid);
            if (wc) {
                title = wc.getTitle() || '';
                url = wc.getURL() || '';
                killable = true;
            }
            if (m.type === 'Browser') {
                name = 'Браузер';
            } else if (m.type === 'GPU') {
                name = 'GPU-процесс';
            } else if (m.type === 'Utility') {
                name = 'Служебный процесс';
            } else if (url && url.startsWith('chrome-extension://')) {
                name = 'Расширение';
            } else if (wc) {
                name = 'Вкладка';
            } else if (m.type === 'Tab') {
                name = 'Вкладка';
            }
            if (title && name === 'Вкладка') {
                name = 'Вкладка: ' + title;
            }
            const memoryKB = m.memory && m.memory.workingSetSize ? m.memory.workingSetSize : 0;
            totalMemoryKB += memoryKB;
            items.push({
                pid: pid,
                type: m.type,
                name: name,
                title: title,
                url: url,
                cpu: Math.round((m.cpu && m.cpu.percentCPUUsage ? m.cpu.percentCPUUsage : 0) * 10) / 10,
                memoryKB: memoryKB,
                killable: killable
            });
        }
        items.sort((a, b) => b.memoryKB - a.memoryKB);
        return { items: items, totalMemoryKB: totalMemoryKB };
    });

    ipcMain.handle('tasks:kill', (_event, pid) => {
        const allWc = webContents.getAllWebContents();
        for (const wc of allWc) {
            try {
                if (!wc.isDestroyed() && wc.getOSProcessId() === pid) {
                    wc.forcefullyCrashRenderer();
                    logger.info('tasks', 'Процесс завершён: ' + pid + ' (' + wc.getURL() + ')');
                    return { success: true };
                }
            } catch (err) {
                // пропускаем
            }
        }
        return { success: false, error: 'Процесс не найден' };
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
        height: 300,
        frame: false,
        parent: mainWindow,
        movable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        resizable: false,
        skipTaskbar: true,
        backgroundColor: '#ffffff',
        roundedCorners: false,
        show: false,
        x: Math.round(x),
        y: Math.round(y),
        webPreferences: {
            session: session.defaultSession,
            preload: path.join(__dirname, 'node_modules', 'electron-chrome-extensions', 'dist', 'chrome-extension-api.preload.js'),
            sandbox: true,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            contextIsolation: true,
            enablePreferredSizeMode: true,
            autoplayPolicy: 'no-user-gesture-required'
        }
    });

    win.on('closed', () => {
        extensionPopupWindows = extensionPopupWindows.filter((item) => {
            return item !== win;
        });
    });

    win.setAlwaysOnTop(true, 'pop-up-menu');

    win.on('blur', () => {
        if (!win.isDestroyed()) {
            win.close();
        }
    });

    win.webContents.on('preferred-size-changed', (_event, size) => {
        if (win.isDestroyed()) {
            return;
        }
        const safeWidth = Math.min(Math.max(Math.round(size.width), 25), 800);
        const safeHeight = Math.min(Math.max(Math.round(size.height), 25), 600);
        const bounds = win.getBounds();
        win.setBounds({
            x: bounds.x,
            y: bounds.y,
            width: safeWidth,
            height: safeHeight
        });
        if (!win.isVisible()) {
            win.show();
        }
    });

    const popupUrl = new URL(popupPath, 'chrome-extension://' + extId + '/').href;
    win.loadURL(popupUrl).catch((err) => {
        console.error('Не удалось открыть попап расширения:', err);
        if (!win.isDestroyed()) {
            win.close();
        }
    });
    win.webContents.on('did-finish-load', () => {
        const dragInjection = `(() => {
            if (document.getElementById('bunpinok-drag')) return;
            const style = document.createElement('style');
            style.textContent = '#bunpinok-drag{position:fixed;top:0;left:0;right:0;height:14px;-webkit-app-region:drag;z-index:2147483647;cursor:move;}';
            document.head.appendChild(style);
            const handle = document.createElement('div');
            handle.id = 'bunpinok-drag';
            document.body.appendChild(handle);
        })()`;
        win.webContents.executeJavaScript(dragInjection).catch(() => {});
    });
    win.once('ready-to-show', () => {
        win.show();
        win.moveTop();
        win.focus();
    });

    extensionPopupWindows.push(win);
}

function restoreStartupTabs() {
    const startupPage = settingsStore.get('onStartup.page', 'newtab');

    if (startupPage === 'continue') {
        const savedTabs = sessionStore.load();
        if (savedTabs.length > 0) {
            for (const savedTab of savedTabs) {
                let url = savedTab.url;
                if (!url || url === '') {
                    url = 'browser://newtab';
                }
                if (url.startsWith('chrome-extension://')) {
                    continue;
                }
                tabManager.createTab(url);
            }
            return;
        }
    }

    if (startupPage === 'vk') {
        tabManager.createTab('https://vk.com');
        return;
    }

    tabManager.createTab('browser://newtab');
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
    downloadManager.setLogger(logger);
    historyStore = new HistoryStore();
    bookmarkStore = new BookmarkStore();
    sessionStore = new SessionStore();
    dnrBridge = new DnrBridge(settingsStore);
    privacyShield = new PrivacyShield(settingsStore);
    privacyShield.setup(dnrBridge);
    logger = new Logger();
    dnrBridge.setLogger(logger);
    logger.info('main', '=== BunPinokWeb запущен v' + app.getVersion() + ' ===');
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
    tabManager.setLogger(logger);
    tabManager.setReaderHandler((tabId) => {
        openReader(tabId);
    });
    tabManager.setOfflineHandler((tabId, failedUrl) => {
        offlineFailedUrls.set(tabId, failedUrl);
        tabManager.navigateTab(tabId, 'browser://offline');
    });
    extensionManager = new ExtensionManager(tabManager);
    extensionManager.setLogger(logger);
    xpiConverter = new XpiConverter();
    xpiConverter.setLogger(logger);
    crxInstaller = new CrxInstaller(extensionManager, xpiConverter);

    chromeExtensions = new ElectronChromeExtensions({
        license: 'GPL-3.0',
        session: session.defaultSession,
        createTab: async (details) => {
            const url = details.url || 'about:blank';
            const tabId = tabManager.createTab(url);
            updateChromeViewBounds();
            const tab = tabManager.getTab(tabId);
            if (tab) {
                return [tab.view.webContents, mainWindow];
            }
            return [mainWindow.webContents, mainWindow];
        },
        selectTab: (tab, _browserWindow) => {
            const found = tabManager.findTabByWebContents(tab);
            if (found) {
                tabManager.selectTab(found.id);
                updateChromeViewBounds();
            }
        },
        removeTab: (tab, _browserWindow) => {
            const found = tabManager.findTabByWebContents(tab);
            if (found) {
                tabManager.closeTab(found.id);
                updateChromeViewBounds();
                if (tabManager.getTabCount() === 0) {
                    tabManager.createTab('browser://newtab');
                    updateChromeViewBounds();
                }
            }
        },
        createWindow: async (details) => {
            const url = details.url || 'about:blank';
            tabManager.createTab(url);
            updateChromeViewBounds();
            return mainWindow;
        }
    });
    tabManager.setChromeExtensions(chromeExtensions);
    dnrBridge.setContext({
        bookmarkStore: bookmarkStore,
        historyStore: historyStore,
        tabManager: tabManager,
        mainWindow: mainWindow,
        broadcastBookmarks: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('bookmarks:updated', bookmarkStore.getAll());
            }
        },
        updateBounds: () => {
            updateChromeViewBounds();
        },
        applyProxy: () => {
            applyProxySettings();
        }
    });
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);
    console.log('[ElectronChromeExtensions] инициализированы');

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
                { label: 'Диспетчер задач', accelerator: 'Shift+Esc', click: () => { tabManager.createTab('browser://tasks'); updateChromeViewBounds(); } },
                { type: 'separator' },
                { label: 'Инструменты разработчика', accelerator: 'F12', click: () => { const t = tabManager.getActiveTab(); if (t) { tabManager.toggleDevTools(t.id); } } },
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

    restoreStartupTabs();
    updateChromeViewBounds();

    setInterval(() => {
        if (tabManager && tabManager.getTabCount() > 0) {
            sessionStore.save(tabManager.getAllTabs());
        }
    }, 30000);

    downloadManager.attach(session.defaultSession);

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('tabs:updated', tabManager.getAllTabs().map(t => ({
            id: t.id,
            url: t.url,
            title: t.title,
            isLoading: t.isLoading
        })));
    });

    mainWindow.webContents.on('console-message', (_event, level, message, _line, sourceId) => {
        if (!logger) {
            return;
        }
        const text = String(message || '');
        if (text.includes('Electron Security Warning') || text.includes('Insecure Content-Security-Policy')) {
            return;
        }
        logger.log(level >= 2 ? 'error' : 'info', 'chrome-ui:' + sourceId, text);
    });

    function hookExtensionConsole() {
        const allContents = webContents.getAllWebContents();
        for (const wc of allContents) {
            if (wc.__bunpinokHooked) {
                continue;
            }
            let url = '';
            try {
                url = wc.getURL();
            } catch (err) {
                continue;
            }
            if (!url.startsWith('chrome-extension://')) {
                continue;
            }
            hookSingleExtensionContents(wc, url);
        }
    }

    function hookSingleExtensionContents(wc, url) {
        wc.__bunpinokHooked = true;
        try {
            wc.setBackgroundThrottling(false);
        } catch (err) {
            // не поддерживается — пропускаем
        }
        wc.on('console-message', (event, level, message, line, sourceId) => {
            if (!logger) {
                return;
            }
            let logLevel = level;
            let logMessage = message;
            let logSource = sourceId;
            if (event && typeof event === 'object' && event.message) {
                logLevel = event.level === 'error' || event.level === 'warning' ? 2 : 0;
                logMessage = event.message;
                logSource = event.sourceId || '';
            }
            const text = String(logMessage || '');
            logger.log(typeof logLevel === 'number' && logLevel >= 2 ? 'error' : 'info', 'ext-bg:' + logSource, text);
        });
        wc.on('render-process-gone', (_event, details) => {
            if (logger) {
                logger.error('ext-bg', 'Фон расширения упал: ' + details.reason + ' (' + url + ')');
            }
        });
        wc.on('did-fail-load', (_event, code, desc, failedUrl) => {
            if (logger) {
                logger.error('ext-bg', 'Не удалось загрузить ' + failedUrl + ': ' + desc);
            }
        });
        if (logger) {
            logger.info('ext-bg', 'Консоль подключена: ' + url);
        }
    }

    app.on('web-contents-created', (_event, contents) => {
        const tryHook = () => {
            try {
                const url = contents.getURL();
                if (url.startsWith('chrome-extension://') && !contents.__bunpinokHooked) {
                    hookSingleExtensionContents(contents, url);
                } else if (url && !contents.__bunpinokHookedAny) {
                    contents.__bunpinokHookedAny = true;
                    if (logger) {
                        logger.info('wc', 'Создан webContents: ' + url);
                    }
                }
            } catch (err) {
                // URL ещё не готов — попробуем позже
            }
        };
        tryHook();
        setTimeout(tryHook, 500);
        contents.once('destroyed', () => {
            try {
                if (logger) {
                    logger.info('wc', 'Уничтожен webContents: ' + contents.getURL());
                }
            } catch (err) {
                if (logger) {
                    logger.info('wc', 'Уничтожен webContents');
                }
            }
        });
    });

    hookExtensionConsole();
    setInterval(hookExtensionConsole, 3000);

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

    dnrBridge.addOnBeforeSendHeadersHandler((details, headers) => {
        const dntEnabled = settingsStore.get('privacy.dnt', false);
        if (dntEnabled) {
            headers['DNT'] = '1';
        }
        return null;
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
        resolvePermission('privacy.notifications', 'notifications', permission, origin, callback);
        return;
    }
    if (permission === 'geolocation') {
        resolvePermission('privacy.geolocation', 'geolocation', permission, origin, callback);
        return;
    }
    if (permission === 'media') {
        const cameraMode = getEffectiveSitePermission(origin, 'camera', 'privacy.camera');
        const microphoneMode = getEffectiveSitePermission(origin, 'microphone', 'privacy.microphone');
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

function getEffectiveSitePermission(origin, permission, settingKey) {
    const sitePermissions = settingsStore.get('privacy.sitePermissions', {});
    if (typeof sitePermissions === 'object' && sitePermissions !== null) {
        const siteEntry = sitePermissions[origin];
        if (siteEntry && typeof siteEntry[permission] === 'string') {
            return siteEntry[permission];
        }
    }
    return settingsStore.get(settingKey, 'allow');
}

function resolvePermission(settingKey, permissionName, permission, origin, callback) {
    const mode = getEffectiveSitePermission(origin, permissionName, settingKey);
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
    if (tabManager && tabManager.getTabCount() > 0 && sessionStore) {
        sessionStore.save(tabManager.getAllTabs());
    }
    if (dnrBridge && dnrBridge.flushStorage) {
        dnrBridge.flushStorage();
    }
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

import { WebContentsView, Menu, clipboard } from 'electron';

let nextTabId = 1;

class Tab {
    constructor(id, view, url = 'browser://newtab') {
        this.id = id;
        this.view = view;
        this.url = url;
        this.title = 'Новая вкладка';
        this.isLoading = false;
        this.isSelected = false;
    }
}

export class TabManager {
    constructor(mainWindow, chromeViewOptions) {
        this.mainWindow = mainWindow;
        this.chromeViewOptions = chromeViewOptions;
        this.tabs = new Map();
        this.activeTabId = null;
        this.historyStore = null;
        this.settingsStore = null;
        this.readerHandler = null;
        this.pageZoomFactor = 1.0;
        this.defaultFontSize = 16;
        this._setupAutoUpdate();
    }

    setReaderHandler(handler) {
        this.readerHandler = handler;
    }

    setHistoryStore(historyStore) {
        this.historyStore = historyStore;
    }

    setSettingsStore(settingsStore) {
        this.settingsStore = settingsStore;
        this.pageZoomFactor = settingsStore.get('appearance.pageZoom', 100) / 100;
        this.defaultFontSize = settingsStore.get('appearance.fontSize', 16);
    }

    setPageZoom(percent) {
        this.pageZoomFactor = Number(percent) / 100;
        for (const tab of this.tabs.values()) {
            tab.view.webContents.setZoomFactor(this.pageZoomFactor);
        }
    }

    setDefaultFontSize(size) {
        this.defaultFontSize = size;
    }

    _buildViewOptions() {
        const options = {};
        for (const key of Object.keys(this.chromeViewOptions)) {
            options[key] = this.chromeViewOptions[key];
        }
        options.webPreferences = {};
        for (const key of Object.keys(this.chromeViewOptions.webPreferences)) {
            options.webPreferences[key] = this.chromeViewOptions.webPreferences[key];
        }
        options.webPreferences.defaultFontSize = this.defaultFontSize;
        return options;
    }

    createTab(url = 'browser://newtab') {
        const id = nextTabId++;
        const view = new WebContentsView(this._buildViewOptions());
        view.setBackgroundColor('#ffffff');
        view.webContents.setZoomFactor(this.pageZoomFactor);

        const tab = new Tab(id, view, url);
        this.tabs.set(id, tab);

        view.webContents.on('did-start-loading', () => {
            tab.isLoading = true;
            this._notifyUpdate();
        });

        view.webContents.on('did-stop-loading', () => {
            tab.isLoading = false;
            this._notifyUpdate();
            this._maybeAutoTranslate(tab);
            this._maybeInjectStoreBanner(tab);
        });

        view.webContents.on('did-navigate', (_event, navUrl) => {
            tab.url = navUrl;
            tab.http2Retried = false;
            tab.httpsRetried = false;
            if (this.historyStore) {
                this.historyStore.add(navUrl, tab.title);
            }
            this._notifyUpdate();
        });

        view.webContents.on('did-navigate-in-page', (_event, navUrl) => {
            tab.url = navUrl;
            this._notifyUpdate();
        });

        view.webContents.on('did-fail-load', (_event, _errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (!isMainFrame || !validatedURL || !errorDescription) {
                return;
            }
            if (errorDescription.includes('ERR_HTTP2_SERVER_REFUSED_STREAM')) {
                if (!tab.http2Retried) {
                    tab.http2Retried = true;
                    view.webContents.loadURL(validatedURL, { userAgent: this._getUserAgent() });
                }
                return;
            }
            const isSslError = errorDescription.includes('ERR_SSL_') || errorDescription.includes('ERR_CERT_');
            if (isSslError && validatedURL.startsWith('https://')) {
                if (!tab.httpsRetried) {
                    tab.httpsRetried = true;
                    const httpUrl = validatedURL.replace('https://', 'http://');
                    view.webContents.loadURL(httpUrl, { userAgent: this._getUserAgent() });
                }
            }
        });

        view.webContents.on('page-title-updated', (_event, title) => {
            tab.title = title;
            this._notifyUpdate();
        });

        view.webContents.on('page-favicon-updated', (_event, favicons) => {
            tab.favicon = favicons[0];
            this._notifyUpdate();
        });

        view.webContents.on('before-input-event', (event, input) => {
            this._handleBeforeInput(event, input, tab);
        });

        view.webContents.on('context-menu', (_event, params) => {
            this._showPageContextMenu(tab, params);
        });

        view.webContents.setWindowOpenHandler((details) => {
            this._handleWindowOpen(details);
            return { action: 'deny' };
        });

        this.mainWindow.contentView.addChildView(view);
        this.selectTab(id);

        if (url && url !== 'browser://newtab') {
            view.webContents.loadURL(url, { userAgent: this._getUserAgent() });
        } else {
            view.webContents.loadURL('browser://newtab');
        }

        return id;
    }

    _maybeAutoTranslate(tab) {
        if (!this.settingsStore) {
            return;
        }
        const autoTranslate = this.settingsStore.get('language.autoTranslate', false);
        if (!autoTranslate) {
            return;
        }
        if (tab.url.startsWith('browser://')) {
            return;
        }
        if (tab.url.includes('translate.google.com')) {
            return;
        }
        tab.view.webContents.executeJavaScript("(document.documentElement.getAttribute('lang') || '')")
            .then((lang) => {
                if (!lang) {
                    return;
                }
                if (lang.toLowerCase().startsWith('ru')) {
                    return;
                }
                if (!tab.isSelected) {
                    return;
                }
                const translateUrl = 'https://translate.google.com/translate?sl=auto&tl=ru&u=' + encodeURIComponent(tab.url);
                tab.view.webContents.loadURL(translateUrl, { userAgent: this._getUserAgent() });
            })
            .catch(() => {});
    }

    _maybeInjectStoreBanner(tab) {
        if (!tab.url.startsWith('https://chromewebstore.google.com/')) {
            return;
        }
        const bannerScript = `(() => {
            if (document.getElementById('bunpinok-install-banner')) return;
            if (!window.browserAPI || !window.browserAPI.extensions) return;
            const match = location.pathname.match(/\\/detail\\/[^/]+\\/([a-p]{32})/);
            if (!match) return;
            const banner = document.createElement('div');
            banner.id = 'bunpinok-install-banner';
            banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1a73e8;color:#fff;padding:10px 16px;font:14px system-ui;display:flex;justify-content:center;align-items:center;gap:14px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
            const text = document.createElement('span');
            text.textContent = 'Это расширение можно установить прямо в BunPinokWeb';
            const btn = document.createElement('button');
            btn.textContent = 'Установить';
            btn.style.cssText = 'background:#fff;color:#1a73e8;border:none;border-radius:4px;padding:7px 18px;font:600 13px system-ui;cursor:pointer;';
            const close = document.createElement('button');
            close.textContent = '✕';
            close.style.cssText = 'background:transparent;color:#fff;border:none;font:14px system-ui;cursor:pointer;';
            close.addEventListener('click', () => { banner.remove(); });
            btn.addEventListener('click', async () => {
                btn.textContent = 'Установка...';
                btn.disabled = true;
                const result = await window.browserAPI.extensions.installFromUrl(location.href);
                if (result.success) {
                    btn.textContent = 'Установлено ✓';
                    banner.style.background = '#188038';
                } else {
                    btn.textContent = 'Ошибка';
                    banner.style.background = '#d93025';
                    setTimeout(() => { banner.remove(); }, 4000);
                }
            });
            banner.appendChild(text);
            banner.appendChild(btn);
            banner.appendChild(close);
            document.documentElement.appendChild(banner);
        })()`;
        tab.view.webContents.executeJavaScript(bannerScript).catch(() => {});
    }

    _handleWindowOpen(details) {
        const popupsBlocked = this.settingsStore && this.settingsStore.get('privacy.popups', 'block') === 'block';
        if (popupsBlocked && details.disposition === 'new-window') {
            return;
        }
        if (details.url) {
            this.createTab(details.url);
        }
    }

    _handleBeforeInput(event, input, tab) {
        const isCtrl = input.control;
        const key = input.key.toLowerCase();
        if (!isCtrl) {
            return;
        }
        if (key === 't') {
            event.preventDefault();
            this.createTab('browser://newtab');
        } else if (key === 'w') {
            event.preventDefault();
            this.closeTab(tab.id);
            if (this.getTabCount() === 0) {
                this.createTab('browser://newtab');
            }
        } else if (key === 'l') {
            event.preventDefault();
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('ui:focus-omnibox');
            }
        }
    }

    _showPageContextMenu(tab, params) {
        const template = [];

        if (tab.view.webContents.navigationHistory.canGoBack()) {
            template.push({ label: 'Назад', click: () => tab.view.webContents.navigationHistory.goBack() });
        }
        if (tab.view.webContents.navigationHistory.canGoForward()) {
            template.push({ label: 'Вперёд', click: () => tab.view.webContents.navigationHistory.goForward() });
        }
        template.push({ label: 'Обновить', click: () => tab.view.webContents.reload() });
        template.push({ label: 'Режим чтения', click: () => { if (this.readerHandler) { this.readerHandler(tab.id); } } });

        if (params.isEditable) {
            template.push({ type: 'separator' });
            template.push({ label: 'Вырезать', role: 'cut', enabled: params.editFlags.canCut });
            template.push({ label: 'Копировать', role: 'copy', enabled: params.editFlags.canCopy });
            template.push({ label: 'Вставить', role: 'paste', enabled: params.editFlags.canPaste });
            template.push({ label: 'Выделить всё', role: 'selectAll', enabled: params.editFlags.canSelectAll });
            template.push({ type: 'separator' });
            template.push({ label: 'Автозаполнить форму', click: () => { this._autofillForm(tab); } });
        }

        if (params.selectionText) {
            template.push({ type: 'separator' });
            template.push({ label: 'Копировать', role: 'copy', enabled: params.editFlags.canCopy });
        }

        if (params.mediaType === 'image') {
            template.push({ type: 'separator' });
            template.push({
                label: 'Сохранить изображение как...',
                click: () => {
                    if (params.srcURL) {
                        tab.view.webContents.downloadURL(params.srcURL);
                    }
                }
            });
            template.push({
                label: 'Копировать изображение',
                click: () => {
                    if (params.srcURL) {
                        tab.view.webContents.copyImageAt(params.x, params.y);
                    }
                }
            });
        }

        if (params.linkURL) {
            template.push({ type: 'separator' });
            template.push({ label: 'Копировать адрес ссылки', click: () => this._copyToClipboard(params.linkURL) });
        }

        template.push({ type: 'separator' });
        template.push({ label: 'Исследовать элемент', click: () => tab.view.webContents.inspectElement(params.x, params.y) });

        const menu = Menu.buildFromTemplate(template);
        menu.popup({ window: this.mainWindow });
    }

    _copyToClipboard(text) {
        clipboard.writeText(text);
    }

    _autofillForm(tab) {
        if (!this.settingsStore) {
            return;
        }
        const data = {
            name: this.settingsStore.get('autofill.name', ''),
            email: this.settingsStore.get('autofill.email', ''),
            phone: this.settingsStore.get('autofill.phone', ''),
            address: this.settingsStore.get('autofill.address', '')
        };
        const hasData = data.name || data.email || data.phone || data.address;
        if (!hasData) {
            return;
        }
        const script = `(() => {
            const data = ${JSON.stringify(data)};
            const fields = document.querySelectorAll('input, textarea');
            let filled = 0;
            const setValue = (field, value) => {
                field.focus();
                field.value = value;
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.dispatchEvent(new Event('change', { bubbles: true }));
                filled += 1;
            };
            for (const field of fields) {
                if (field.value && field.value.trim()) {
                    continue;
                }
                const attr = ((field.name || '') + ' ' + (field.id || '') + ' ' + (field.getAttribute('autocomplete') || '') + ' ' + (field.placeholder || '')).toLowerCase();
                if (!field.value && data.name && /name|fullname|fio|имя|фио|ваше имя/.test(attr)) {
                    setValue(field, data.name);
                    continue;
                }
                if (data.email && /email|mail|почта|e-mail/.test(attr)) {
                    setValue(field, data.email);
                    continue;
                }
                if (data.phone && /phone|tel|телефон|mobile/.test(attr)) {
                    setValue(field, data.phone);
                    continue;
                }
                if (data.address && /address|street|addr|адрес|улица/.test(attr)) {
                    setValue(field, data.address);
                    continue;
                }
            }
            return filled;
        })()`;
        tab.view.webContents.executeJavaScript(script).then((filled) => {
            this._notifyUpdate();
        }).catch(() => {});
    }

    closeTab(tabId) {
        const tab = this.tabs.get(tabId);
        if (!tab) return;

        this.mainWindow.contentView.removeChildView(tab.view);
        tab.view.webContents.close();
        this.tabs.delete(tabId);

        if (this.activeTabId === tabId) {
            const remaining = [...this.tabs.keys()];
            if (remaining.length > 0) {
                const prevIndex = remaining.indexOf(tabId);
                let newActiveId = remaining[Math.max(0, prevIndex - 1)];
                if (newActiveId === undefined) {
                    newActiveId = remaining[0];
                }
                this.selectTab(newActiveId);
            }
        }
        this._notifyUpdate();
    }

    selectTab(tabId) {
        const tab = this.tabs.get(tabId);
        if (!tab) return;

        for (const [id, t] of this.tabs) {
            if (id !== tabId) {
                t.view.setVisible(false);
                t.isSelected = false;
            }
        }

        tab.view.setVisible(true);
        tab.isSelected = true;
        this.activeTabId = tabId;
        this._notifyUpdate();
    }

    navigateTab(tabId, url) {
        const tab = this.tabs.get(tabId);
        if (!tab) return;

        tab.url = url;
        tab.view.webContents.loadURL(url, { userAgent: this._getUserAgent() });
        this._notifyUpdate();
    }

    getTab(tabId) {
        return this.tabs.get(tabId);
    }

    findTabByWebContents(webContents) {
        for (const tab of this.tabs.values()) {
            if (tab.view.webContents === webContents) {
                return tab;
            }
        }
        return null;
    }

    getActiveTab() {
        return this.tabs.get(this.activeTabId);
    }

    getAllTabs() {
        return [...this.tabs.values()];
    }

    getAllViews() {
        return [...this.tabs.values()].map(t => t.view);
    }

    getTabCount() {
        return this.tabs.size;
    }

    updateBounds(bounds) {
        for (const tab of this.tabs.values()) {
            tab.view.setBounds(bounds);
        }
    }

    _getUserAgent() {
        return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
    }

    _notifyUpdate() {
        const tabsData = this.getAllTabs().map(t => ({
            id: t.id,
            url: t.url,
            title: t.title,
            isLoading: t.isLoading,
            favicon: t.favicon
        }));
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('tabs:updated', tabsData);
        }
    }

    _setupAutoUpdate() {
        this._updateTimer = setInterval(() => {
            if (this.tabs.size > 0) {
                this._notifyUpdate();
            }
        }, 5000);
    }

    destroy() {
        if (this._updateTimer) {
            clearInterval(this._updateTimer);
            this._updateTimer = null;
        }
        for (const tab of this.tabs.values()) {
            tab.view.webContents.close();
        }
        this.tabs.clear();
    }
}

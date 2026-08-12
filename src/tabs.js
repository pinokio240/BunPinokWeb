import { WebContentsView } from 'electron';

let nextTabId = 1;

class Tab {
    constructor(id, view, url = 'browser://newtab') {
        this.id = id;
        this.view = view;
        this.url = url;
        this.title = 'New Tab';
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
        this._setupAutoUpdate();
    }

    createTab(url = 'browser://newtab') {
        const id = nextTabId++;
        const view = new WebContentsView(this.chromeViewOptions);
        view.setBackgroundColor('#ffffff');

        const tab = new Tab(id, view, url);
        this.tabs.set(id, tab);

        view.webContents.on('did-start-loading', () => {
            tab.isLoading = true;
            this._notifyUpdate();
        });

        view.webContents.on('did-stop-loading', () => {
            tab.isLoading = false;
            this._notifyUpdate();
        });

        view.webContents.on('did-navigate', (_event, navUrl) => {
            tab.url = navUrl;
            this._notifyUpdate();
        });

        view.webContents.on('did-navigate-in-page', (_event, navUrl) => {
            tab.url = navUrl;
            this._notifyUpdate();
        });

        view.webContents.on('page-title-updated', (_event, title) => {
            tab.title = title;
            this._notifyUpdate();
        });

        view.webContents.on('page-favicon-updated', (_event, favicons) => {
            tab.favicon = favicons[0];
            this._notifyUpdate();
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
                const newActiveId = remaining[Math.max(0, prevIndex - 1)] || remaining[0];
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

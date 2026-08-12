import { dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export class DownloadManager {
    constructor(settingsStore) {
        this.settingsStore = settingsStore;
        this.activeDownloads = new Map();
    }

    async promptSavePath(suggestedFilename) {
        const askBeforeSave = this.settingsStore.get('downloads.askBeforeSave', true);
        const defaultPath = this.settingsStore.get('downloads.path', '');

        if (!askBeforeSave && defaultPath) {
            return path.join(defaultPath, suggestedFilename);
        }

        const result = await dialog.showSaveDialog({
            title: 'Save file as',
            defaultPath: defaultPath
                ? path.join(defaultPath, suggestedFilename)
                : suggestedFilename,
            filters: [
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (result.canceled) return null;
        return result.filePath;
    }

    getDownloadPath() {
        return this.settingsStore.get('downloads.path', '');
    }

    setDownloadPath() {
        return this.settingsStore.get('downloads.path', '');
    }
}

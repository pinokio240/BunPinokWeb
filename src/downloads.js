import { dialog, app } from 'electron';
import path from 'node:path';

export class DownloadManager {
    constructor(settingsStore, mainWindowGetter) {
        this.settingsStore = settingsStore;
        this.mainWindowGetter = mainWindowGetter;
        this.items = [];
        this.nextId = 1;
    }

    attach(session) {
        session.on('will-download', (event, item) => {
            this.handleWillDownload(event, item);
        });
    }

    handleWillDownload(event, item) {
        const record = {
            id: this.nextId,
            filename: item.getFilename(),
            url: item.getURL(),
            receivedBytes: 0,
            totalBytes: item.getTotalBytes(),
            state: 'progressing',
            startTime: Date.now(),
            savePath: ''
        };
        this.nextId += 1;
        this.items.unshift(record);
        if (this.logger) {
            this.logger.info('downloads', 'Начало загрузки: ' + record.filename + ' (' + record.url.slice(0, 120) + ')');
        }

        const askBeforeSave = this.settingsStore.get('downloads.askBeforeSave', true);
        const defaultPath = this.settingsStore.get('downloads.path', '');
        let targetPath = '';
        if (defaultPath) {
            targetPath = path.join(defaultPath, record.filename);
        }

        item.on('updated', (_event, state) => {
            if (state === 'interrupted') {
                record.state = 'interrupted';
            } else if (state === 'progressing') {
                record.state = 'progressing';
                record.receivedBytes = item.getReceivedBytes();
                record.totalBytes = item.getTotalBytes();
            }
            this._notify();
        });

        item.once('done', (_event, state) => {
            if (state === 'completed') {
                record.state = 'completed';
                record.savePath = item.getSavePath();
            } else if (state === 'cancelled') {
                record.state = 'cancelled';
            } else {
                record.state = 'failed';
            }
            record.receivedBytes = item.getReceivedBytes();
            if (this.logger) {
                this.logger.info('downloads', 'Загрузка завершена (' + state + '): ' + record.filename);
            }
            this._notify();
        });

        if (askBeforeSave) {
            const mainWindow = this.mainWindowGetter();
            const options = {
                title: 'Сохранить файл',
                defaultPath: targetPath || record.filename,
                buttonLabel: 'Сохранить'
            };
            const result = dialog.showSaveDialogSync(mainWindow, options);
            if (result.canceled) {
                item.cancel();
                if (this.logger) {
                    this.logger.info('downloads', 'Пользователь отменил сохранение: ' + record.filename);
                }
            } else {
                item.setSavePath(result.filePath);
                record.savePath = result.filePath;
                this._notify();
            }
        } else {
            if (targetPath) {
                item.setSavePath(targetPath);
                record.savePath = targetPath;
            }
        }

        this._notify();
    }

    setLogger(logger) {
        this.logger = logger;
    }

    getAll() {
        return this.items.map((item) => {
            const copy = {};
            for (const key of Object.keys(item)) {
                copy[key] = item[key];
            }
            return copy;
        });
    }

    clearFinished() {
        this.items = this.items.filter((item) => {
            return item.state === 'progressing';
        });
        this._notify();
    }

    _notify() {
        const mainWindow = this.mainWindowGetter();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('downloads:updated', this.getAll());
        }
    }
}

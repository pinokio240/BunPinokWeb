import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export class BookmarkStore {
    constructor() {
        this.filePath = path.join(app.getPath('userData'), 'bookmarks.json');
        this.bookmarks = this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            }
        } catch (err) {
            console.error('Не удалось загрузить закладки:', err);
        }
        return [];
    }

    _save() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(this.bookmarks), 'utf-8');
        } catch (err) {
            console.error('Не удалось сохранить закладки:', err);
        }
    }

    add(url, title) {
        if (!url) {
            return false;
        }
        if (url.startsWith('browser://')) {
            return false;
        }

        for (const bookmark of this.bookmarks) {
            if (bookmark.url === url) {
                bookmark.title = title || bookmark.title || url;
                bookmark.timestamp = Date.now();
                this._save();
                return false;
            }
        }

        this.bookmarks.unshift({
            url: url,
            title: title || url,
            timestamp: Date.now()
        });
        this._save();
        return true;
    }

    removeByUrl(url) {
        this.bookmarks = this.bookmarks.filter((bookmark) => {
            return bookmark.url !== url;
        });
        this._save();
    }

    has(url) {
        for (const bookmark of this.bookmarks) {
            if (bookmark.url === url) {
                return true;
            }
        }
        return false;
    }

    getAll() {
        return this.bookmarks.map((bookmark) => {
            const copy = {};
            for (const key of Object.keys(bookmark)) {
                copy[key] = bookmark[key];
            }
            return copy;
        });
    }

    clear() {
        this.bookmarks = [];
        this._save();
    }
}

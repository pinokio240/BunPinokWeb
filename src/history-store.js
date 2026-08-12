import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const MAX_ENTRIES = 5000;

export class HistoryStore {
    constructor() {
        this.filePath = path.join(app.getPath('userData'), 'history.json');
        this.entries = this._load();
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
            console.error('Не удалось загрузить историю:', err);
        }
        return [];
    }

    _save() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(this.entries), 'utf-8');
        } catch (err) {
            console.error('Не удалось сохранить историю:', err);
        }
    }

    add(url, title) {
        if (!url) {
            return;
        }
        if (url.startsWith('browser://')) {
            return;
        }

        const now = Date.now();
        const last = this.entries[0];
        if (last && last.url === url && now - last.timestamp < 1000) {
            return;
        }

        this.entries.unshift({
            url: url,
            title: title || url,
            timestamp: now
        });

        if (this.entries.length > MAX_ENTRIES) {
            this.entries = this.entries.slice(0, MAX_ENTRIES);
        }

        this._save();
    }

    getAll() {
        return this.entries.map((entry) => {
            const copy = {};
            for (const key of Object.keys(entry)) {
                copy[key] = entry[key];
            }
            return copy;
        });
    }

    search(query) {
        const q = query.toLowerCase();
        return this.getAll().filter((entry) => {
            if (entry.url.toLowerCase().includes(q)) {
                return true;
            }
            if (entry.title.toLowerCase().includes(q)) {
                return true;
            }
            return false;
        });
    }

    removeByUrl(url) {
        this.entries = this.entries.filter((entry) => {
            return entry.url !== url;
        });
        this._save();
    }

    removeByTimestamp(timestamp) {
        this.entries = this.entries.filter((entry) => {
            return entry.timestamp !== timestamp;
        });
        this._save();
    }

    clear() {
        this.entries = [];
        this._save();
    }

    getCount() {
        return this.entries.length;
    }
}

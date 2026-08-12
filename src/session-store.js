import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export class SessionStore {
    constructor() {
        this.filePath = path.join(app.getPath('userData'), 'session.json');
    }

    save(tabs) {
        try {
            const payload = {
                savedAt: Date.now(),
                tabs: tabs.map((tab) => {
                    return {
                        url: tab.url,
                        title: tab.title
                    };
                })
            };
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(payload), 'utf-8');
        } catch (err) {
            console.error('Не удалось сохранить сессию:', err);
        }
    }

    load() {
        try {
            if (!fs.existsSync(this.filePath)) {
                return [];
            }
            const raw = fs.readFileSync(this.filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.tabs)) {
                return parsed.tabs;
            }
        } catch (err) {
            console.error('Не удалось загрузить сессию:', err);
        }
        return [];
    }

    clear() {
        try {
            if (fs.existsSync(this.filePath)) {
                fs.unlinkSync(this.filePath);
            }
        } catch (err) {
            console.error('Не удалось очистить сессию:', err);
        }
    }
}

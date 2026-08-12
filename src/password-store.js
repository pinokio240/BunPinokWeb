import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export class PasswordStore {
    constructor() {
        this.filePath = path.join(app.getPath('userData'), 'passwords.json');
        this.entries = this._load();
    }

    _load() {
        try {
            if (!fs.existsSync(this.filePath)) {
                return [];
            }
            const raw = fs.readFileSync(this.filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.entries)) {
                return [];
            }
            if (parsed.encrypted && safeStorage.isEncryptionAvailable()) {
                const decrypted = safeStorage.decryptString(Buffer.from(parsed.data, 'base64'));
                return JSON.parse(decrypted);
            }
            return parsed.entries;
        } catch (err) {
            console.error('Не удалось загрузить пароли:', err);
            return [];
        }
    }

    _save() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            if (safeStorage.isEncryptionAvailable()) {
                const json = JSON.stringify(this.entries);
                const encrypted = safeStorage.encryptString(json).toString('base64');
                const payload = { encrypted: true, data: encrypted, entries: [] };
                fs.writeFileSync(this.filePath, JSON.stringify(payload), 'utf-8');
            } else {
                const payload = { encrypted: false, entries: this.entries };
                fs.writeFileSync(this.filePath, JSON.stringify(payload), 'utf-8');
            }
        } catch (err) {
            console.error('Не удалось сохранить пароли:', err);
        }
    }

    find(host, realm) {
        for (const entry of this.entries) {
            if (entry.host === host && entry.realm === realm) {
                return entry;
            }
        }
        return null;
    }

    save(host, realm, username, password) {
        const existing = this.find(host, realm);
        if (existing) {
            existing.username = username;
            existing.password = password;
        } else {
            this.entries.push({
                host: host,
                realm: realm,
                username: username,
                password: password
            });
        }
        this._save();
    }

    remove(host, realm) {
        this.entries = this.entries.filter((entry) => {
            return !(entry.host === host && entry.realm === realm);
        });
        this._save();
    }

    removeByIndex(index) {
        if (index >= 0 && index < this.entries.length) {
            this.entries.splice(index, 1);
            this._save();
        }
    }

    getAll() {
        return this.entries.map((entry, index) => {
            return {
                index: index,
                host: entry.host,
                realm: entry.realm,
                username: entry.username
            };
        });
    }

    clear() {
        this.entries = [];
        this._save();
    }
}

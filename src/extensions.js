import { app, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

function resolveLocalizedString(value, manifest, extPath) {
    let result = value;
    if (!result) {
        return '';
    }
    if (typeof result !== 'string') {
        return '';
    }
    if (result.startsWith('__MSG_') && result.endsWith('__')) {
        const key = result.slice(6, -2);
        let locale = 'en';
        if (manifest.default_locale) {
            locale = manifest.default_locale;
        }
        const localePath = path.join(extPath, '_locales', locale, 'messages.json');
        if (fs.existsSync(localePath)) {
            try {
                const messages = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
                if (messages[key] && messages[key].message) {
                    result = messages[key].message;
                }
            } catch (err) {
                console.error('Не удалось разобрать messages.json:', err);
            }
        }
    }
    return result;
}

function getIconDataUrl(manifest, extPath) {
    let iconPath = '';
    let icons = null;
    if (manifest.action && manifest.action.default_icon) {
        icons = manifest.action.default_icon;
    } else if (manifest.icons) {
        icons = manifest.icons;
    }
    if (icons) {
        let selected = '';
        if (typeof icons === 'string') {
            selected = icons;
        } else {
            const sizes = Object.keys(icons).map((size) => {
                return parseInt(size, 10);
            }).sort((a, b) => {
                return a - b;
            });
            for (const size of sizes) {
                if (size >= 16) {
                    selected = icons[String(size)];
                    break;
                }
            }
            if (!selected && sizes.length > 0) {
                selected = icons[String(sizes[0])];
            }
        }
        if (selected) {
            iconPath = path.join(extPath, selected);
        }
    }
    if (!iconPath || !fs.existsSync(iconPath)) {
        return '';
    }
    try {
        const data = fs.readFileSync(iconPath);
        const ext = path.extname(iconPath).toLowerCase();
        let mime = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') {
            mime = 'image/jpeg';
        } else if (ext === '.svg') {
            mime = 'image/svg+xml';
        } else if (ext === '.gif') {
            mime = 'image/gif';
        }
        return 'data:' + mime + ';base64,' + data.toString('base64');
    } catch (err) {
        return '';
    }
}

export class ExtensionManager {
    constructor(tabManager) {
        this.tabManager = tabManager;
        this.extensions = new Map();
        this._loadRegistry();
        this._restoreEnabled();
    }

    _registryPath() {
        const userDataPath = app.getPath('userData');
        const extDir = path.join(userDataPath, 'extensions');
        if (!fs.existsSync(extDir)) {
            fs.mkdirSync(extDir, { recursive: true });
        }
        return path.join(extDir, 'registry.json');
    }

    _loadRegistry() {
        this.registry = [];
        try {
            const registryPath = this._registryPath();
            if (fs.existsSync(registryPath)) {
                const raw = fs.readFileSync(registryPath, 'utf-8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    this.registry = parsed;
                }
            }
        } catch (err) {
            console.error('Не удалось загрузить реестр расширений:', err);
            this.registry = [];
        }
    }

    _saveRegistry() {
        try {
            fs.writeFileSync(this._registryPath(), JSON.stringify(this.registry), 'utf-8');
        } catch (err) {
            console.error('Не удалось сохранить реестр расширений:', err);
        }
    }

    _restoreEnabled() {
        for (const entry of this.registry) {
            if (entry.enabled && entry.path && fs.existsSync(entry.path)) {
                this._loadFromPath(entry.path, entry).catch((err) => {
                    console.error('Не удалось восстановить расширение:', entry.path, err);
                });
            }
        }
    }

    async _loadFromPath(extPath, registryEntry) {
        const manifestPath = path.join(extPath, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error('Нет manifest.json в ' + extPath);
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const ext = await session.defaultSession.loadExtension(extPath, {
            allowFileAccess: true
        });

        const name = resolveLocalizedString(manifest.name, manifest, extPath);
        const description = resolveLocalizedString(manifest.description, manifest, extPath);
        const icon = getIconDataUrl(manifest, extPath);
        let popup = '';
        if (manifest.action && manifest.action.default_popup) {
            popup = path.join(extPath, manifest.action.default_popup);
        }

        const entry = {
            id: ext.id,
            name: name,
            version: manifest.version || '',
            description: description,
            path: extPath,
            enabled: true,
            popup: popup,
            icon: icon,
            manifest: manifest,
            extension: ext
        };

        if (registryEntry) {
            entry.name = registryEntry.name || name;
            entry.version = registryEntry.version || entry.version;
            entry.description = registryEntry.description || description;
            entry.popup = registryEntry.popup || popup;
            entry.icon = registryEntry.icon || icon;
        }

        this.extensions.set(ext.id, entry);

        const existing = this.registry.find((item) => {
            return item.id === ext.id;
        });
        if (existing) {
            existing.enabled = true;
            existing.name = entry.name;
            existing.version = entry.version;
            existing.description = entry.description;
            existing.popup = entry.popup;
            existing.icon = entry.icon;
        } else {
            this.registry.push({
                id: ext.id,
                path: extPath,
                enabled: true,
                name: entry.name,
                version: entry.version,
                description: entry.description,
                popup: entry.popup,
                icon: entry.icon
            });
        }
        this._saveRegistry();
        return ext.id;
    }

    async loadExtension(extPath) {
        const manifestPath = path.join(extPath, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error('Нет manifest.json в выбранной папке');
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        const ext = await session.defaultSession.loadExtension(extPath, {
            allowFileAccess: true
        });

        const name = resolveLocalizedString(manifest.name, manifest, extPath);
        const description = resolveLocalizedString(manifest.description, manifest, extPath);
        const icon = getIconDataUrl(manifest, extPath);
        let popup = '';
        if (manifest.action && manifest.action.default_popup) {
            popup = path.join(extPath, manifest.action.default_popup);
        }

        const entry = {
            id: ext.id,
            name: name,
            version: manifest.version || '',
            description: description,
            path: extPath,
            enabled: true,
            popup: popup,
            icon: icon,
            manifest: manifest,
            extension: ext
        };
        this.extensions.set(ext.id, entry);

        this.registry.push({
            id: ext.id,
            path: extPath,
            enabled: true,
            name: name,
            version: entry.version,
            description: description,
            popup: popup,
            icon: icon
        });
        this._saveRegistry();
        console.log('Расширение загружено: ' + name + ' (' + ext.id + ')');
        return ext.id;
    }

    async disableExtension(extId) {
        const entry = this.extensions.get(extId);
        if (!entry) {
            return false;
        }
        if (entry.extension && entry.extension.unload) {
            try {
                entry.extension.unload();
            } catch (err) {
                console.error('Не удалось выгрузить расширение:', err);
            }
        }
        entry.enabled = false;
        this.extensions.delete(extId);
        const registryEntry = this.registry.find((item) => {
            return item.id === extId;
        });
        if (registryEntry) {
            registryEntry.enabled = false;
        }
        this._saveRegistry();
        return true;
    }

    async enableExtension(extId) {
        const registryEntry = this.registry.find((item) => {
            return item.id === extId;
        });
        if (!registryEntry) {
            return false;
        }
        if (!fs.existsSync(registryEntry.path)) {
            return false;
        }
        await this._loadFromPath(registryEntry.path, registryEntry);
        return true;
    }

    async removeExtension(extId) {
        const registryEntry = this.registry.find((item) => {
            return item.id === extId;
        });
        const entry = this.extensions.get(extId);
        if (entry && entry.extension && entry.extension.unload) {
            try {
                entry.extension.unload();
            } catch (err) {
                console.error('Не удалось выгрузить расширение:', err);
            }
        }
        this.extensions.delete(extId);
        this.registry = this.registry.filter((item) => {
            return item.id !== extId;
        });
        this._saveRegistry();
        if (registryEntry && registryEntry.path && registryEntry.path.includes('installed')) {
            try {
                fs.rmSync(registryEntry.path, { recursive: true, force: true });
            } catch (err) {
                console.error('Не удалось удалить папку расширения:', err);
            }
        }
        return true;
    }

    getExtension(extId) {
        return this.extensions.get(extId);
    }

    getAllExtensions() {
        const result = [];
        for (const registryEntry of this.registry) {
            let hasPopup = false;
            if (registryEntry.popup) {
                hasPopup = true;
            }
            result.push({
                id: registryEntry.id,
                name: registryEntry.name || registryEntry.id,
                version: registryEntry.version || '',
                description: registryEntry.description || '',
                enabled: registryEntry.enabled === true,
                icon: registryEntry.icon || '',
                hasPopup: hasPopup
            });
        }
        return result;
    }

    getPopupPath(extId) {
        const entry = this.extensions.get(extId);
        if (!entry) {
            return '';
        }
        return entry.popup || '';
    }
}

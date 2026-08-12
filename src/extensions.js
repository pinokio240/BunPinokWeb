import { app, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export class ExtensionManager {
    constructor(tabManager) {
        this.tabManager = tabManager;
        this.extensions = new Map();
        this._loadExtensionsFromDisk();
    }

    _loadExtensionsFromDisk() {
        const extDir = path.join(this._getExtensionsPath(), 'loaded');
        if (!fs.existsSync(extDir)) return;

        const dirs = fs.readdirSync(extDir, { withFileTypes: true })
            .filter(d => d.isDirectory());

        for (const dir of dirs) {
            const extPath = path.join(extDir, dir.name);
            try {
                this.loadExtension(extPath);
            } catch (err) {
                console.error(`Failed to load extension ${dir.name}:`, err);
            }
        }
    }

    async loadExtension(extPath) {
        const manifestPath = path.join(extPath, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error(`No manifest.json found in ${extPath}`);
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        try {
            const ext = await session.defaultSession.loadExtension(extPath, {
                allowFileAccess: true
            });
            this.extensions.set(ext.id, {
                id: ext.id,
                name: manifest.name,
                version: manifest.version,
                description: manifest.description || '',
                path: extPath,
                enabled: true,
                extension: ext,
                manifest
            });
            console.log(`Extension loaded: ${manifest.name} (${ext.id})`);
            return ext.id;
        } catch (err) {
            console.error(`Failed to load extension from ${extPath}:`, err);
            throw err;
        }
    }

    async unloadExtension(extId) {
        const entry = this.extensions.get(extId);
        if (!entry) return false;

        if (entry.extension) {
            try {
                await entry.extension.unload();
            } catch (err) {
                console.error('Failed to unload extension:', err);
            }
        }
        this.extensions.delete(extId);
        return true;
    }

    getExtension(extId) {
        return this.extensions.get(extId);
    }

    getAllExtensions() {
        return [...this.extensions.values()].map(e => ({
            id: e.id,
            name: e.name,
            version: e.version,
            description: e.description,
            enabled: e.enabled
        }));
    }

    _getExtensionsPath() {
        const userDataPath = app.getPath('userData');
        const extPath = path.join(userDataPath, 'extensions');
        if (!fs.existsSync(extPath)) {
            fs.mkdirSync(extPath, { recursive: true });
            fs.mkdirSync(path.join(extPath, 'loaded'), { recursive: true });
        }
        return extPath;
    }
}

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const DEFAULT_SETTINGS = {
    'onStartup.page': 'newtab',
    'onStartup.url': 'browser://newtab',
    'appearance.theme': 'system',
    'appearance.showBookmarksBar': false,
    'appearance.pageZoom': 100,
    'appearance.fontSize': 16,
    'appearance.showHomeButton': false,
    'appearance.homePage': 'browser://newtab',
    'downloads.path': app.getPath('downloads'),
    'downloads.askBeforeSave': true,
    'notifications.enabled': true,
    'notifications.soundEnabled': true,
    'notifications.soundPath': '',
    'window.width': 1280,
    'window.height': 800,
    'privacy.notifications': 'allow',
    'privacy.geolocation': 'allow',
    'privacy.camera': 'allow',
    'privacy.microphone': 'allow',
    'privacy.popups': 'block',
    'privacy.dnt': false,
    'language.spellcheck': true,
    'language.spellcheckLanguages': 'ru,en',
    'language.autoTranslate': false
};

export class SettingsStore {
    constructor() {
        this.configPath = path.join(app.getPath('userData'), 'settings.json');
        this.settings = this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, 'utf-8');
                const loaded = JSON.parse(raw);
                return { ...DEFAULT_SETTINGS, ...loaded };
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
        return { ...DEFAULT_SETTINGS };
    }

    _save() {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.settings, null, 2), 'utf-8');
        } catch (err) {
            console.error('Failed to save settings:', err);
        }
    }

    get(key, defaultValue = undefined) {
        if (Object.prototype.hasOwnProperty.call(this.settings, key)) {
            return this.settings[key];
        }
        return defaultValue;
    }

    set(key, value) {
        this.settings[key] = value;
        this._save();
    }

    getAll() {
        return { ...this.settings };
    }

    reset(key) {
        if (key in DEFAULT_SETTINGS) {
            this.settings[key] = DEFAULT_SETTINGS[key];
            this._save();
        }
    }

    resetAll() {
        this.settings = { ...DEFAULT_SETTINGS };
        this._save();
    }
}

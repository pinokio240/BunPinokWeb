import { Notification } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class NotificationManager {
    constructor(settingsStore) {
        this.settingsStore = settingsStore;
        this.soundProcess = null;
    }

    show(title, body, options = {}) {
        if (!this.settingsStore.get('notifications.enabled', true)) return;

        let safeTitle = 'BunPinokWeb';
        if (title) {
            safeTitle = title;
        }
        let safeBody = '';
        if (body) {
            safeBody = body;
        }
        let silent = false;
        if (options.silent) {
            silent = options.silent;
        }
        let urgency = 'normal';
        if (options.urgency) {
            urgency = options.urgency;
        }

        const notification = new Notification({
            title: safeTitle,
            body: safeBody,
            icon: options.icon,
            silent: silent,
            urgency: urgency
        });

        notification.on('click', () => {
            if (options.onClick) options.onClick();
        });

        notification.show();

        if (this.settingsStore.get('notifications.soundEnabled', true) && !options.silent) {
            this._playSound();
        }

        return notification;
    }

    _playSound() {
        const soundPath = this.settingsStore.get('notifications.soundPath', '');
        let audioFile = soundPath;

        if (!audioFile || !fs.existsSync(audioFile)) {
            audioFile = path.join(__dirname, '..', 'assets', 'sounds', 'notification.mp3');
        }

        try {
            if (process.platform === 'win32') {
                spawn('powershell', [
                    '-c',
                    `(New-Object Media.SoundPlayer '${audioFile}').PlaySync()`
                ]);
            } else if (process.platform === 'darwin') {
                spawn('afplay', [audioFile]);
            } else {
                spawn('paplay', [audioFile]);
            }
        } catch (err) {
            console.error('Failed to play notification sound:', err);
        }
    }
}

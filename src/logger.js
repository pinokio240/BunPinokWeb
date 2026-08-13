import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const MAX_SIZE = 5 * 1024 * 1024;

export class Logger {
    constructor() {
        this.logPath = path.join(app.getPath('userData'), 'logs', 'bunpinokweb.log');
        this._ensureDir();
    }

    _ensureDir() {
        try {
            const dir = path.dirname(this.logPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        } catch (err) {
            console.error('Не удалось создать папку логов:', err);
        }
    }

    log(level, source, message) {
        const now = new Date();
        const pad = function (num, len) {
            return String(num).padStart(len, '0');
        };
        const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1, 2) + '-' + pad(now.getDate(), 2) +
            'T' + pad(now.getHours(), 2) + ':' + pad(now.getMinutes(), 2) + ':' + pad(now.getSeconds(), 2) +
            '.' + pad(now.getMilliseconds(), 3);
        const line = '[' + stamp + '] [' + level.toUpperCase() + '] [' + source + '] ' + message;
        console.log(line);
        try {
            fs.appendFileSync(this.logPath, line + '\n', 'utf-8');
            this._rotateIfNeeded();
        } catch (err) {
            console.error('Не удалось записать лог:', err);
        }
    }

    info(source, message) {
        this.log('info', source, message);
    }

    warn(source, message) {
        this.log('warn', source, message);
    }

    error(source, message) {
        this.log('error', source, message);
    }

    _rotateIfNeeded() {
        try {
            if (!fs.existsSync(this.logPath)) {
                return;
            }
            const stat = fs.statSync(this.logPath);
            if (stat.size > MAX_SIZE) {
                fs.renameSync(this.logPath, this.logPath + '.old');
            }
        } catch (err) {
            // ротация не критична
        }
    }

    getPath() {
        return this.logPath;
    }

    readTail(maxLines) {
        try {
            if (!fs.existsSync(this.logPath)) {
                return '';
            }
            const content = fs.readFileSync(this.logPath, 'utf-8');
            const lines = content.split('\n').filter((line) => {
                return line.length > 0;
            });
            const tail = lines.slice(-maxLines);
            return tail.join('\n');
        } catch (err) {
            return '';
        }
    }

    clear() {
        try {
            fs.writeFileSync(this.logPath, '', 'utf-8');
        } catch (err) {
            console.error('Не удалось очистить лог:', err);
        }
    }
}

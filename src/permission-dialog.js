import { BrowserWindow, ipcMain } from 'electron';

const PERMISSION_LABELS = {
    'notifications': 'Уведомления',
    'geolocation': 'Геолокация',
    'camera': 'Камера',
    'microphone': 'Микрофон',
    'media': 'Камера и микрофон'
};

export class PermissionDialogManager {
    constructor() {
        this.queue = Promise.resolve();
        this.currentHandler = null;
    }

    request(permission, origin) {
        const label = PERMISSION_LABELS[permission];
        let safeLabel = permission;
        if (label) {
            safeLabel = label;
        }
        let safeOrigin = 'неизвестный сайт';
        if (origin) {
            safeOrigin = origin;
        }

        const task = () => {
            return this._showDialog(safeLabel, safeOrigin);
        };

        this.queue = this.queue.then(task, task);
        return this.queue;
    }

    _showDialog(label, origin) {
        return new Promise((resolve) => {
            let answered = false;

            const win = new BrowserWindow({
                width: 420,
                height: 190,
                frame: false,
                resizable: false,
                alwaysOnTop: true,
                show: false,
                webPreferences: {
                    contextIsolation: false,
                    nodeIntegration: true,
                    sandbox: false
                }
            });

            const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:system-ui,'Segoe UI',sans-serif;background:#ffffff;color:#202124;display:flex;flex-direction:column;height:100vh;overflow:hidden;}
.header{display:flex;align-items:center;gap:8px;padding:14px 16px 8px;font-size:12px;color:#5f6368;}
.header .dot{width:10px;height:10px;border-radius:50%;background:#1a73e8;flex-shrink:0;}
.title{padding:0 16px 12px;font-size:15px;font-weight:500;flex:1;}
.actions{display:flex;justify-content:flex-end;gap:8px;padding:0 16px 16px;}
button{border:none;border-radius:4px;padding:8px 16px;font-size:13px;cursor:pointer;}
.btn-block{background:#e8eaed;color:#202124;}
.btn-block:hover{background:#d5d8dc;}
.btn-allow{background:#1a73e8;color:#ffffff;}
.btn-allow:hover{background:#1765cc;}
</style></head><body>
<div class="header"><span class="dot"></span><span>Запрос разрешения</span></div>
<div class="title"><b>${this._escapeHtml(origin)}</b> запрашивает разрешение: <b>${this._escapeHtml(label)}</b></div>
<div class="actions">
  <button class="btn-block" id="btnBlock">Заблокировать</button>
  <button class="btn-allow" id="btnAllow">Разрешить</button>
</div>
<script>
const {ipcRenderer} = require('electron');
document.getElementById('btnAllow').onclick = () => ipcRenderer.send('permission-answer', true);
document.getElementById('btnBlock').onclick = () => ipcRenderer.send('permission-answer', false);
</script>
</body></html>`;

            const answerHandler = (_event, allow) => {
                if (!answered) {
                    answered = true;
                    resolve(allow === true);
                    if (!win.isDestroyed()) {
                        win.close();
                    }
                }
            };

            win.webContents.on('did-finish-load', () => {
                win.show();
                win.focus();
            });

            win.on('closed', () => {
                if (this.currentHandler) {
                    ipcMain.removeListener('permission-answer', this.currentHandler);
                    this.currentHandler = null;
                }
                if (!answered) {
                    answered = true;
                    resolve(false);
                }
            });

            this.currentHandler = answerHandler;
            ipcMain.on('permission-answer', answerHandler);

            win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        });
    }

    _escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

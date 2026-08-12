import { BrowserWindow, ipcMain } from 'electron';

export class AuthDialogManager {
    constructor() {
        this.currentHandler = null;
    }

    requestCredentials(host, realm) {
        return new Promise((resolve) => {
            let answered = false;
            let label = host;
            if (realm) {
                label = host + ' — ' + realm;
            }

            const win = new BrowserWindow({
                width: 460,
                height: 330,
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
body{font-family:system-ui,'Segoe UI',sans-serif;background:#ffffff;color:#202124;display:flex;flex-direction:column;height:100vh;overflow:hidden;padding:16px;}
.header{font-size:12px;color:#5f6368;margin-bottom:6px;}
.title{font-size:15px;font-weight:500;margin-bottom:14px;word-break:break-all;}
.field{margin-bottom:10px;}
.field label{display:block;font-size:12px;color:#5f6368;margin-bottom:4px;}
.field input{width:100%;padding:8px 10px;border:1px solid #dadce0;border-radius:4px;font-size:13px;outline:none;}
.field input:focus{border-color:#1a73e8;}
.remember{display:flex;align-items:center;gap:6px;font-size:12px;color:#5f6368;margin-bottom:14px;}
.actions{display:flex;justify-content:flex-end;gap:8px;}
button{border:none;border-radius:4px;padding:8px 16px;font-size:13px;cursor:pointer;}
.btn-cancel{background:#e8eaed;color:#202124;}
.btn-cancel:hover{background:#d5d8dc;}
.btn-login{background:#1a73e8;color:#ffffff;}
.btn-login:hover{background:#1765cc;}
</style></head><body>
<div class="header">Требуется вход</div>
<div class="title">${this._escapeHtml(label)}</div>
<div class="field"><label>Имя пользователя</label><input id="username" type="text" autocomplete="off"></div>
<div class="field"><label>Пароль</label><input id="password" type="password"></div>
<div class="remember"><input id="remember" type="checkbox" checked><label for="remember">Запомнить пароль в браузере</label></div>
<div class="actions">
  <button class="btn-cancel" id="btnCancel">Отмена</button>
  <button class="btn-login" id="btnLogin">Войти</button>
</div>
<script>
const {ipcRenderer} = require('electron');
document.getElementById('btnLogin').onclick = () => {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const remember = document.getElementById('remember').checked;
  ipcRenderer.send('auth-answer', { username, password, remember });
};
document.getElementById('btnCancel').onclick = () => ipcRenderer.send('auth-answer', null);
document.getElementById('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { document.getElementById('btnLogin').click(); }
});
</script>
</body></html>`;

            const answerHandler = (_event, payload) => {
                if (!answered) {
                    answered = true;
                    if (payload && payload.username) {
                        resolve({
                            username: payload.username,
                            password: payload.password,
                            remember: payload.remember === true
                        });
                    } else {
                        resolve(null);
                    }
                    if (!win.isDestroyed()) {
                        win.close();
                    }
                }
            };

            win.webContents.on('did-finish-load', () => {
                win.show();
                win.focus();
                win.webContents.executeJavaScript("document.getElementById('username').focus()").catch(() => {});
            });

            win.on('closed', () => {
                if (this.currentHandler) {
                    ipcMain.removeListener('auth-answer', this.currentHandler);
                    this.currentHandler = null;
                }
                if (!answered) {
                    answered = true;
                    resolve(null);
                }
            });

            this.currentHandler = answerHandler;
            ipcMain.on('auth-answer', answerHandler);

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

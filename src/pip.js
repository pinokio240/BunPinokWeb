import { BrowserWindow, ipcMain } from 'electron';

export class PipManager {
    constructor() {
        this.pipWindows = new Map();
        this.pipHandlers = new Map();
        this._setupIpc();
    }

    _setupIpc() {
        ipcMain.on('pip:close', (event) => {
            this._closeBySender(event.sender);
        });
        ipcMain.on('pip:togglePlay', (event) => {
            const win = this._findBySender(event.sender);
            if (win) {
                win.webContents.send('pip:togglePlay');
            }
        });
    }

    _closeBySender(sender) {
        for (const [tabId, win] of this.pipWindows) {
            if (win.webContents === sender) {
                this.closePip(tabId);
                return;
            }
        }
    }

    _findBySender(sender) {
        for (const [tabId, win] of this.pipWindows) {
            if (win.webContents === sender) {
                return win;
            }
        }
        return null;
    }

    async openPip(tabId, tabManager) {
        const tab = tabManager.getTab(tabId);
        if (!tab) {
            return { success: false, error: 'Вкладка не найдена' };
        }

        if (this.pipWindows.has(tabId)) {
            const existing = this.pipWindows.get(tabId);
            existing.focus();
            return { success: true };
        }

        let videoInfo = null;
        try {
            videoInfo = await tab.view.webContents.executeJavaScript(`(() => {
                const v = document.querySelector('video');
                if (!v) return null;
                return {
                    src: v.currentSrc || v.src || '',
                    time: v.currentTime,
                    paused: v.paused,
                    title: document.title
                };
            })()`);
        } catch (err) {
            return { success: false, error: 'Не удалось получить доступ к странице' };
        }

        if (!videoInfo || !videoInfo.src) {
            return { success: false, error: 'Видео на странице не найдено' };
        }

        let pipTitle = 'Видео';
        if (videoInfo.title) {
            pipTitle = videoInfo.title;
        }

        const pipWin = new BrowserWindow({
            width: 480,
            height: 320,
            minWidth: 320,
            minHeight: 240,
            maxWidth: 800,
            maxHeight: 600,
            frame: false,
            alwaysOnTop: true,
            resizable: true,
            transparent: true,
            backgroundColor: '#00000000',
            title: `PiP — ${pipTitle}`,
            webPreferences: {
                contextIsolation: false,
                nodeIntegration: true,
                sandbox: false
            }
        });

        const pipHTML = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{height:100vh;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;}
video{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;background:#000;}
.controls{position:fixed;top:4px;right:4px;display:flex;gap:4px;opacity:0;transition:opacity .2s;z-index:10;}
body:hover .controls,.controls:hover{opacity:1;}
.ctrl-btn{width:28px;height:28px;border:none;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;font-family:system-ui;}
.ctrl-btn:hover{background:rgba(0,0,0,.85);}
.drag{position:fixed;top:0;left:0;right:80px;height:28px;-webkit-app-region:drag;cursor:move;z-index:5;}
.info{position:fixed;bottom:8px;left:12px;color:rgba(255,255,255,.7);font-size:11px;font-family:system-ui;pointer-events:none;}
.error{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#fff;font-size:13px;font-family:system-ui;text-align:center;padding:0 20px;}
</style></head><body>
<div class="drag"></div>
<div class="controls">
  <button class="ctrl-btn" id="btnPlay" title="Воспроизвести/Пауза">⏯</button>
  <button class="ctrl-btn" id="btnClose" title="Закрыть PiP">✕</button>
</div>
<video id="vid"></video>
<div class="info" id="info">PiP-плеер</div>
<div class="error" id="error" style="display:none"></div>
<script>
const {ipcRenderer} = require('electron');
const video = document.getElementById('vid');
const info = document.getElementById('info');
const errorEl = document.getElementById('error');

ipcRenderer.on('pip:config', (_event, config) => {
    const src = config.src || '';
    if (src.startsWith('blob:')) {
        errorEl.style.display = 'block';
        errorEl.textContent = 'Потоковое видео (blob:) нельзя извлечь из страницы. Используйте встроенное окно сайта.';
        return;
    }
    video.src = src;
    let applied = false;
    video.addEventListener('loadedmetadata', () => {
        if (applied) return;
        applied = true;
        if (config.time > 0) {
            video.currentTime = config.time;
        }
        if (config.paused) {
            video.pause();
        } else {
            video.play().catch(() => {});
        }
    });
    video.play().catch(() => {});
});

ipcRenderer.on('pip:togglePlay', () => {
    if (video.paused) {
        video.play().catch(() => {});
    } else {
        video.pause();
    }
});

video.addEventListener('play', () => { info.textContent = '▶ Воспроизведение'; });
video.addEventListener('pause', () => { info.textContent = '⏸ Пауза'; });

document.getElementById('btnClose').onclick = () => ipcRenderer.send('pip:close');
document.getElementById('btnPlay').onclick = () => ipcRenderer.send('pip:togglePlay');
</script></body></html>`;

        pipWin.webContents.on('did-finish-load', () => {
            pipWin.webContents.send('pip:config', {
                src: videoInfo.src,
                time: videoInfo.time,
                paused: videoInfo.paused
            });
        });

        pipWin.on('closed', () => {
            this.pipWindows.delete(tabId);
        });

        this.pipWindows.set(tabId, pipWin);
        pipWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pipHTML)}`);
        pipWin.show();
        pipWin.focus();
        return { success: true };
    }

    closePip(tabId) {
        const win = this.pipWindows.get(tabId);
        if (win && !win.isDestroyed()) {
            win.close();
        }
        this.pipWindows.delete(tabId);
    }

    closeAll() {
        for (const [tabId, win] of this.pipWindows) {
            if (!win.isDestroyed()) {
                win.close();
            }
        }
        this.pipWindows.clear();
    }
}

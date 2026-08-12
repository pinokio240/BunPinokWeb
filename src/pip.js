import { BrowserWindow, ipcMain } from 'electron';

export class PipManager {
    constructor() {
        this.pipWindows = new Map();
        this._setupIpc();
    }

    _setupIpc() {
        ipcMain.on('pip:close', (event) => {
            for (const [tabId, win] of this.pipWindows) {
                if (win.webContents === event.sender) {
                    this.closePip(tabId);
                    break;
                }
            }
        });
    }

    openPip(tabId, tabManager) {
        const tab = tabManager.getTab(tabId);
        if (!tab) return null;

        if (this.pipWindows.has(tabId)) {
            const existing = this.pipWindows.get(tabId);
            existing.focus();
            return tabId;
        }

        let pipTitle = 'Video';
        if (tab.title) {
            pipTitle = tab.title;
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
                contextIsolation: true,
                nodeIntegration: true,
                preload: null
            }
        });

        const pipHTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{height:100vh;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;}
video{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;}
.controls{position:fixed;top:4px;right:4px;display:flex;gap:4px;opacity:0;transition:opacity .2s;z-index:10;}
body:hover .controls,.controls:hover{opacity:1;}
.ctrl-btn{width:28px;height:28px;border:none;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;font-family:system-ui;}
.ctrl-btn:hover{background:rgba(0,0,0,.85);}
.drag{position:fixed;top:0;left:0;right:60px;height:28px;-webkit-app-region:drag;cursor:move;z-index:5;}
.info{position:fixed;bottom:8px;left:12px;color:rgba(255,255,255,.7);font-size:11px;font-family:system-ui;pointer-events:none;}
</style></head><body>
<div class="drag"></div>
<div class="controls">
  <button class="ctrl-btn" id="btnClose" title="Close PiP">✕</button>
</div>
<video id="vid" autoplay controls loop></video>
<div class="info" id="info">PiP Player</div>
<script>
const {ipcRenderer} = require('electron');
document.getElementById('btnClose').onclick = () => ipcRenderer.send('pip:close');
document.getElementById('vid').onplay = () => document.getElementById('info').textContent = '▶ Playing';
document.getElementById('vid').onpause = () => document.getElementById('info').textContent = '⏸ Paused';
</script></body></html>`;

        pipWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pipHTML)}`);

        pipWin.on('closed', () => {
            this.pipWindows.delete(tabId);
        });

        this.pipWindows.set(tabId, pipWin);
        pipWin.show();
        pipWin.focus();
        return tabId;
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
            if (!win.isDestroyed()) win.close();
        }
        this.pipWindows.clear();
    }
}

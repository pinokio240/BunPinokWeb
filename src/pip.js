import { BrowserWindow } from 'electron';

export class PipManager {
    constructor() {
        this.pipWindows = new Map();
    }

    openPip(tabId, tabManager) {
        const tab = tabManager.getTab(tabId);
        if (!tab) return;

        if (this.pipWindows.has(tabId)) {
            const existing = this.pipWindows.get(tabId);
            existing.focus();
            return;
        }

        const pipWin = new BrowserWindow({
            width: 480,
            height: 320,
            minWidth: 320,
            minHeight: 240,
            frame: false,
            alwaysOnTop: true,
            resizable: true,
            transparent: false,
            title: `PiP - ${tab.title}`,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false
            }
        });

        const pipHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { background: #000; overflow: hidden; height: 100vh; }
                    video { width: 100%; height: 100%; object-fit: contain; }
                    .controls {
                        position: fixed; top: 4px; right: 4px; display: flex; gap: 4px;
                        opacity: 0; transition: opacity 0.2s;
                    }
                    .controls:hover, body:hover .controls { opacity: 1; }
                    .btn {
                        width: 28px; height: 28px; border: none; border-radius: 50%;
                        background: rgba(0,0,0,0.6); color: white; cursor: pointer;
                        font-size: 16px; display: flex; align-items: center; justify-content: center;
                    }
                    .btn:hover { background: rgba(0,0,0,0.8); }
                    .drag-handle {
                        position: fixed; top: 0; left: 0; right: 40px; height: 30px;
                        -webkit-app-region: drag; cursor: move;
                    }
                </style>
            </head>
            <body>
                <div class="drag-handle"></div>
                <div class="controls">
                    <button class="btn" id="closeBtn" title="Close PiP">✕</button>
                </div>
                <video id="pipVideo" autoplay controls></video>
                <script>
                    const { ipcRenderer } = require('electron');
                    document.getElementById('closeBtn').addEventListener('click', () => {
                        ipcRenderer.send('pip:close');
                    });
                </script>
            </body>
            </html>
        `;

        pipWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pipHTML)}`);

        pipWin.webContents.on('did-finish-load', () => {
            pipWin.webContents.executeJavaScript(`
                document.getElementById('pipVideo').addEventListener('click', () => {
                    window.electronAPI?.focusSource?.();
                });
            `).catch(() => {});
        });

        pipWin.on('closed', () => {
            this.pipWindows.delete(tabId);
        });

        this.pipWindows.set(tabId, pipWin);

        pipWin.show();
        pipWin.focus();
    }

    closePip(tabId) {
        const win = this.pipWindows.get(tabId);
        if (win) {
            win.close();
            this.pipWindows.delete(tabId);
        }
    }
}

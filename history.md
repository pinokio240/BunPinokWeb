# BunPinokWeb — Project History

## 2026-08-12 — v0.1.0 — Project Initialization & Architecture

### Decision Log
- **Stack**: Electron + Bun. Electron for desktop shell (windows, tabs, IPC, extensions), Bun for package management and scripting. Rejected pure Bun + WebView2 path due to Bun.WebView being headless-only.
- **License**: MIT for application code. LGPL-2.1 for repository (reflecting Bun's JSC dependency awareness).
- **Architecture**: Multi-process Electron app with WebContentsView-based tabs.
- **Electron version**: Updated from 33 → 43.4.0 (latest stable, Aug 2026) with Chromium 150.
- **User-Agent**: Updated to Chrome/150.0.0.0 matching Electron 43's Chromium engine.

### Architecture Overview
```
main.js          — Main process: window management, protocol handler, IPC
├── src/
│   ├── omnibox.js       — URL parsing (Omnibox logic)
│   ├── tabs.js          — Tab management (WebContentsView pool)
│   ├── settings-store.js — JSON-based settings persistence
│   ├── extensions.js    — Chrome extension loader (loadExtension API)
│   ├── notifications.js — System notifications + sound
│   ├── pip.js           — Picture-in-Picture floating window
│   └── downloads.js     — Download path management
├── preload.js           — Context bridge for IPC
└── pages/
    ├── browser-chrome.html — Main browser UI (tab strip, toolbar, omnibox)
    ├── newtab.html      — New tab page with quick links
    ├── settings.html    — Settings page (chrome-like)
    └── extensions.html  — Extensions management page
```

### Completed
- [x] `package.json` with Electron 33, electron-store
- [x] `main.js` — main process with protocol handler, all IPC handlers
- [x] `preload.js` — contextIsolation-safe API bridge
- [x] `src/omnibox.js` — URL parsing with search fallback, browser:// support
- [x] `src/tabs.js` — WebContentsView-based tab manager with event listeners
- [x] `src/settings-store.js` — JSON file persistence in userData
- [x] `src/extensions.js` — loadExtension wrapper with directory scanning
- [x] `src/notifications.js` — Native Notifications API + sound playback
- [x] `src/pip.js` — Floating always-on-top window for video
- [x] `src/downloads.js` — Download path management with save dialog
- [x] `pages/browser-chrome.html` — Chrome-like UI: tab strip, toolbar, omnibox, window controls
- [x] `pages/newtab.html` — New tab page with search + quick links
- [x] `pages/settings.html` — Full settings page with all sections
- [x] `pages/extensions.html` — Extension management page
- [x] IPC contract: settings:get, settings:set, settings:getAll, settings:clear-browsing-data
- [x] IPC contract: tab:navigate, tab:create, tab:close, tab:select, tab:getAll, tab:getActive
- [x] IPC contract: tab:goBack, tab:goForward, tab:reload, tab:stop
- [x] IPC contract: window:minimize, window:maximize, window:close, window:isMaximized
- [x] IPC contract: downloads:setPath, pip:open, omnibox:parse
- [x] Chrome User-Agent spoofing (v131)
- [x] Keyboard shortcuts: Ctrl+T (new tab), Ctrl+W (close tab), Ctrl+L (focus omnibox)
- [x] Custom browser:// protocol handler
- [x] Window state persistence (size)

### Pending
- [ ] `npm install` (or `bun install`) to fetch Electron
- [ ] User testing on Windows 10
- [ ] Extension loading from unpacked directory dialog
- [ ] Dark theme implementation
- [ ] PiP video extraction logic
- [ ] Download intercept with session.webRequest
- [ ] Bookmarks support

## 2026-08-12 — v0.1.1 — Chrome Settings Map & Version Bump

### Completed
- [x] Electron bumped 33→43.4.0 (latest stable, Chromium 150)
- [x] User-Agent updated to Chrome/150.0.0.0
- [x] Full Chrome settings map compiled (96 settings across 15 sections)
- [x] Gap analysis: ~6% implemented, 94% remaining
- [x] `docs/chrome-settings-map.md` — complete settings reference with status

### Chrome Settings Coverage
| Section | Total | Done |
|---|---|---|
| Autofill & Passwords | 5 | 0 |
| Privacy & Security | 45+ | 1 |
| Performance | 7 | 0 |
| Appearance | 9 | 0 |
| Search Engine | 2 | 1 |
| Default Browser | 1 | 0 |
| On Startup | 3 | 1 |
| Languages | 5 | 0 |
| Downloads | 2 | 2 |
| Accessibility | 5 | 0 |
| System | 3 | 0 |
| Reset | 2 | 0 |
| Extensions | 5 | 1 |
| About | 2 | 0 |
| **Total** | **96** | **6 (6%)** |

### Known Issues
- PiP currently creates empty window (video extraction TBD)
- Sound playback on Windows uses PowerShell Media.SoundPlayer (may not work on all systems)
- Extensions page needs `showOpenDialog` for directory selection

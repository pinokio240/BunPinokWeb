# BunPinokWeb — Project History

## 2026-08-12 — v0.2.4 — Bookmarks UX + Permission "Ask" Dialogs

### Bookmarks UX
- [x] Кнопка-звезда в тулбаре (★ активная, ☆ нет) — toggle закладки
- [x] Пункт «Добавить в закладки» в ⋮ меню (Ctrl+D)
- [x] Контекстное меню закладки на панели (правый клик): Открыть / Удалить закладку
- [x] Видимый скроллбар панели закладок (тонкий, появляется при переполнении)
- [x] IPC: bookmarks:has, bookmarks:toggle, bookmarks:showContextMenu

### Permission "Ask" (Спрашивать)
- [x] src/permission-dialog.js: всплывающее окно «Запрос разрешения» (frameless, always-on-top)
- [x] Кнопки Заблокировать/Разрешить; закрытие окна без ответа = отказ
- [x] Очередь запросов: диалоги показываются по одному (promise chain)
- [x] privacy.html: у всех разрешений добавлен вариант «Спрашивать»
- [x] main.js: handlePermissionRequest → allow/block/ask; media объединяет камеру и микрофон

## 2026-08-12 — v0.2.3 — Appearance (Внешний вид)

### Completed
- [x] Масштаб страницы: select 75–200% в настройках, применяется ко всем вкладкам сразу
- [x] Размер шрифта: 12–20px, применяется к новым вкладкам (defaultFontSize)
- [x] Кнопка «Домой»: включение в настройках + настраиваемая домашняя страница
- [x] TabManager: setPageZoom/setDefaultFontSize, per-view webPreferences
- [x] settings:changed broadcast — кнопка «Домой» появляется без перезапуска
- [x] Default settings: appearance.pageZoom/fontSize/showHomeButton/homePage

## 2026-08-12 — v0.2.2 — Privacy & Security (Приватность)

### Completed
- [x] `pages/privacy.html`: разрешения сайтов (уведомления, гео, камера, микрофон, всплывающие окна), Do Not Track, очистка cookie/кэша/истории
- [x] `browser://privacy` в protocol map, пункт в ⋮ меню и меню Файл
- [x] Permission handler консультируется с настройками (не blanket-allow)
- [x] Do Not Track header через webRequest.onBeforeSendHeaders
- [x] Блокировка всплывающих окон: setWindowOpenHandler (new-window disposition denied; target=_blank открывает вкладку)
- [x] Default settings: privacy.notifications/geolocation/camera/microphone/popups/dnt

## 2026-08-12 — v0.2.1 — Bookmarks (Закладки)

### Completed
- [x] `src/bookmark-store.js`: BookmarkStore — JSON persistence, dedup, update title
- [x] `pages/bookmarks.html`: список с поиском, добавлением текущей страницы, удалением
- [x] `browser://bookmarks` в protocol map, Ctrl+Shift+O в меню
- [x] Ctrl+D — добавить текущую вкладку в закладки (повторное нажатие удаляет)
- [x] Панель закладок в chrome-UI (показывается/скрывается из настроек)
- [x] `ui:setBookmarksBarVisible` IPC — контент-область сдвигается при показе панели
- [x] `settings:changed` broadcast — панель перерисовывается без перезапуска
- [x] IPC: bookmarks:getAll/add/remove/toggleCurrent
- [x] preload: browserAPI.bookmarks

## 2026-08-12 — v0.2.0 — History (История)

### Completed
- [x] `src/history-store.js`: HistoryStore — JSON persistence in userData, dedup, MAX 5000 entries
- [x] `pages/history.html`: история с группировкой по дням, поиском, удалением, очисткой
- [x] `browser://history` в protocol map
- [x] Ctrl+H акселератор (меню Файл + ⋮ меню)
- [x] Запись посещений в did-navigate каждой вкладки (внутренние browser:// страницы не пишутся)
- [x] IPC: history:getAll, history:search, history:clear, history:removeByTimestamp
- [x] preload: browserAPI.history

## 2026-08-12 — v0.1.6 — Native App Menu (fix: dropdown hidden under page)

### Bug
HTML ⋮ dropdown rendered under the WebContentsView (native layer composites above the chrome UI HTML).

### Fix
- Replaced HTML dropdown with native `Menu.popup()` (OS-level menu always renders on top)
- IPC: `ui:showAppMenu(x, y)` — main builds menu, pops at button coordinates
- Removed dropdown HTML/CSS/JS from browser-chrome.html

## 2026-08-12 — v0.1.5 — Full Russian Localization

### Completed
- [x] main.js: application menu (Файл/Правка/Вид/Справка) translated
- [x] main.js: dialog titles (download folder, extension folder) translated
- [x] main.js: `app.commandLine.appendSwitch('lang', 'ru-RU')` for Chromium locale
- [x] tabs.js: page context menu fully Russian (Сохранить изображение как, Исследовать элемент...)
- [x] tabs.js: default tab title «Новая вкладка»
- [x] browser-chrome.html: tab strip, omnibox placeholder, window controls, ⋮ menu translated
- [x] newtab.html: subtitle, search placeholder, quick links (ВКонтакте, Переводчик...)
- [x] settings.html: all 6 sections + toasts translated
- [x] extensions.html: developer mode, load/remove buttons, toasts translated
- [x] downloads.html: statuses, progress, clear button translated
- [x] pip.js: PiP player UI translated
- [x] downloads.js: save dialog title translated

## 2026-08-12 — v0.1.4 — UX Fixes: Downloads, Menu, Theme, Hotkeys, Context Menus

### User Bug Report (fixed)
1. Theme setting did not apply → `nativeTheme.themeSource` + `data-theme` CSS variables in chrome UI
2. Downloads had no UI → new `browser://downloads` page with progress tracking
3. File/Edit/View/Help menu invisible (frameless window) → custom ⋮ dropdown menu in UI
4. ⋮ button opened settings directly → now opens proper dropdown (Downloads, Settings, Extensions, Zoom, Fullscreen, Exit)
5. Ctrl+W did not work → `before-input-event` on tab webContents + menu accelerator
6. No context menu on pages → page context menu with Save Image As, Copy Link, Inspect
7. No copy/save image on pages → implemented via `webContents.downloadURL` + clipboard

### Changes
- [x] `src/downloads.js` rewritten: tracks items (progressing/completed/cancelled/failed), emits updates
- [x] `pages/downloads.html` new: list with progress bars, clear finished button
- [x] `browser://downloads` added to protocol map, Ctrl+J accelerator
- [x] ⋮ dropdown menu in browser-chrome.html (9 items)
- [x] Dark theme: `[data-theme="dark"]` CSS vars, `appearance:theme-changed` IPC
- [x] `applyTheme()` in main: sets `nativeTheme.themeSource`
- [x] Ctrl+T/W/L via `before-input-event` on every tab webContents
- [x] Page context menu: Back/Forward/Reload, Cut/Copy/Paste (editable), Copy (selection), Save Image As, Copy Image, Copy Link, Inspect Element
- [x] Zoom in/out/reset IPC + menu items
- [x] Fullscreen IPC + menu item
- [x] preload: downloads.getAll/clearFinished/onUpdated, appearance.getTheme/onThemeChanged, ui.onFocusOmnibox, zoom.*, window.toggleFullscreen

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

## 2026-08-12 — v0.1.3 — Code Style Audit & Omnibox Editing Fix

### Completed
- [x] Full audit for `!!`, `?.`, `??`, `?:` — 0 occurrences left (except regex syntax)
- [x] Refactored all ternaries to if/else blocks: main.js (3), browser-chrome.html (5), extensions.html (7), settings.html (3)
- [x] Refactored all optional chaining `?.` to explicit null checks: main.js (9), browser-chrome.html (1), newtab.html (1)
- [x] Refactored `??` to hasOwnProperty check: settings-store.js (1)
- [x] Refactored `||` fallbacks to explicit if blocks: main.js (2), tabs.js (1), notifications.js (4), pip.js (1), extensions.js (1), settings.html (6)
- [x] Refactored `&&` statement shortcuts to if blocks: browser-chrome.html (4)
- [x] Fixed omnibox editing: refreshTabs no longer overwrites user input while typing (checks document.activeElement)
- [x] All JS files pass syntax check

### Code Style Rules (user-mandated)
- NO ternary operators (`?:`)
- NO optional chaining (`?.`)
- NO nullish coalescing (`??`)
- NO double negation (`!!`)
- NO `||`/`&&` shortcuts as value fallbacks or statement guards
- Use explicit `if`/`else` blocks everywhere

## 2026-08-12 — v0.1.2 — Extensions, PiP, Notifications, Downloads

### Completed
- [x] Extensions: loadUnpacked via system dialog, unload, IPC getAll
- [x] Extensions page: developer mode toggle, load/remove UI
- [x] PiP: IPC-based close, transparent always-on-top window, lifecycle cleanup
- [x] Notifications: IPC `notifications:show`, web notification permission auto-grant
- [x] Downloads: `will-download` interception, save dialog, path from settings
- [x] TabManager: `destroy()` method, polling reduced to 5s
- [x] `app.on('before-quit')` cleanup: PiP close + tabManager destroy
- [x] `session.setPermissionRequestHandler`: auto-grant notifications/media/geolocation
- [x] preload: exposed extensions, notifications, storage IPC

### Known Issues
- PiP video element not linked to source tab's video (needs media stream extraction)
- Sound playback on Windows uses PowerShell Media.SoundPlayer (may not work on all systems)
- No Chrome Web Store integration for extensions (unpacked-only)

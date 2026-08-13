# BunPinokWeb — API Документация

> Всё взаимодействие renderer ↔ main идёт через IPC. В renderer доступен объект `window.browserAPI` (contextBridge из `preload.js`). Напрямую файловую систему и Node API renderer не видит.

---

## Общие соглашения

- Все вызовы — `Promise` (обёртки над `ipcRenderer.invoke`)
- Подписки на события — `onX(callback)` (обёртки над `ipcRenderer.on`)
- Ошибки возвращаются в виде `{ success: false, error: 'текст' }`, успех — `{ success: true, ...данные }`
- ID вкладки — целое число, выдаётся main-процессом

---

## browserAPI.settings

| Метод | Описание | Возврат |
|---|---|---|
| `get(key)` | Прочитать настройку | значение |
| `set(key, value)` | Записать настройку (с валидацией в main) | `{success:true}` |
| `getAll()` | Все настройки | объект |
| `clearBrowsingData({cache, cookies, localStorage})` | Очистить данные | `{success}` |
| `resetAll()` | Сброс к значениям по умолчанию | `{success}` |
| `onChanged(cb)` | Событие: настройки изменились | `cb(allSettings)` |

### Ключи настроек

| Ключ | Значение | По умолчанию |
|---|---|---|
| `onStartup.page` | `newtab` \| `vk` \| `continue` | `newtab` |
| `appearance.theme` | `system` \| `light` \| `dark` | `system` |
| `appearance.showBookmarksBar` | bool | `false` |
| `appearance.pageZoom` | 75–200 | `100` |
| `appearance.fontSize` | 12–20 | `16` |
| `appearance.showHomeButton` | bool | `false` |
| `appearance.homePage` | URL | `browser://newtab` |
| `search.engine` | `google` \| `yandex` \| `bing` \| `duckduckgo` | `google` |
| `language.spellcheck` | bool | `true` |
| `language.spellcheckLanguages` | `ru`, `ru,en`, `en` | `ru,en` |
| `language.autoTranslate` | bool | `false` |
| `downloads.path` | путь | папка загрузок ОС |
| `downloads.askBeforeSave` | bool | `true` |
| `notifications.enabled` | bool | `true` |
| `notifications.soundEnabled` | bool | `true` |
| `privacy.notifications` | `allow` \| `block` \| `ask` | `allow` |
| `privacy.geolocation` | `allow` \| `block` \| `ask` | `allow` |
| `privacy.camera` | `allow` \| `block` \| `ask` | `allow` |
| `privacy.microphone` | `allow` \| `block` \| `ask` | `allow` |
| `privacy.popups` | `block` \| `allow` | `block` |
| `privacy.dnt` | bool | `false` |
| `system.hardwareAcceleration` | bool (нужен перезапуск) | `true` |
| `system.proxyMode` | `system` \| `none` \| `manual` | `system` |
| `system.proxyServer` | `http://host:port` | `''` |

---

## browserAPI.tabs

| Метод | Описание |
|---|---|
| `create(url?)` | Новая вкладка (без url — `browser://newtab`) → `{tabId}` |
| `close(tabId)` | Закрыть вкладку |
| `select(tabId)` | Сделать активной → `{url, title}` |
| `navigate(tabId, url)` | Переход (url проходит OmniboxParser) |
| `getAll()` | Массив `{id, url, title, isLoading, favicon}` |
| `getActive()` | Активная вкладка или `null` |
| `goBack/goForward/reload/stop(tabId)` | Навигация |
| `onUpdated(cb)` | Событие `tabs:updated` → `cb(tabsArray)` |

---

## browserAPI.window

| Метод | Описание |
|---|---|
| `minimize()` | Свернуть |
| `maximize()` | Развернуть/восстановить → `bool isMaximized` |
| `close()` | Закрыть окно |
| `isMaximized()` | Состояние |
| `toggleFullscreen()` | Во весь экран → `bool` |

---

## browserAPI.zoom

| Метод | Описание |
|---|---|
| `in()` / `out()` / `reset()` | Масштаб активной вкладки (±0.5 / сброс) |

---

## browserAPI.omnibox

| Метод | Описание |
|---|---|
| `parse(input)` | Парсинг строки → URL (поиск через выбранный движок) |

---

## browserAPI.downloads

| Метод | Описание |
|---|---|
| `setPath()` | Диалог выбора папки → `{success, path}` |
| `getAll()` | Список загрузок `{id, filename, url, receivedBytes, totalBytes, state, savePath}` |
| `clearFinished()` | Убрать завершённые из списка |
| `onUpdated(cb)` | Событие `downloads:updated` → `cb(items)` |

---

## browserAPI.history

| Метод | Описание |
|---|---|
| `getAll()` | Массив `{url, title, timestamp}` |
| `search(query)` | Поиск по URL/заголовку |
| `clear()` | Очистить всё |
| `removeByTimestamp(timestamp)` | Удалить одну запись |

---

## browserAPI.bookmarks

| Метод | Описание |
|---|---|
| `getAll()` | Массив `{url, title, timestamp}` |
| `add(url, title)` | Добавить (дубликаты обновляют заголовок) |
| `remove(url)` | Удалить |
| `toggle(url, title)` | Добавить/убрать → `{added:bool}` |
| `has(url)` | Проверка |
| `toggleCurrent()` | Для активной вкладки → `{added:bool}` |
| `showContextMenu(url, title, x, y)` | Нативное меню закладки |
| `setBarVisible(visible)` | Показать/скрыть панель (сдвиг контента) |
| `onUpdated(cb)` | Событие `bookmarks:updated` → `cb(bookmarks)` |

---

## browserAPI.extensions

| Метод | Описание |
|---|---|
| `getAll()` | Массив `{id, name, version, description, enabled, icon, hasPopup, optionsPage}` |
| `loadUnpacked()` | Диалог выбора папок (мультивыбор) → `{loadedCount, errors}` |
| `installFromUrl(url)` | Ссылка Chrome Web Store / Edge / Opera / AMO или ID |
| `installFromFile()` | Диалог .crx / .nex / .xpi (XPI конвертируется) |
| `disable(extId)` | Выключить (остаётся в реестре) |
| `enable(extId)` | Включить заново |
| `remove(extId)` | Удалить (+ папку с диска) |
| `openPopup(extId, x, y)` | Открыть попап у координат (alwaysOnTop) |
| `openOptions(extId)` | Открыть страницу настроек расширения (`options_ui.page`/`options_page` из манифеста) во вкладке |
| `showContextMenu(extId, x, y)` | ПКМ по иконке в тулбаре: попап / настройки / управление |
| `onUpdated(cb)` | Событие `extensions:updated` → `cb(extensions)` |

### Мост расширений (HTTP, 127.0.0.1:33123)

Шим `electron-compat.js` (инжектится в фон/попап/offscreen/content-scripts каждого расширения) заменяет отсутствующие в Electron `chrome.*` API на fetch-вызовы к локальному HTTP-серверу в main:

| Эндпоинт | API расширения |
|---|---|
| `/storage-get` `/storage-set` `/storage-remove` `/storage-clear` | `chrome.storage.local/sync/session` (единый writer в main, JSON в `userData/extension-storage/`) |
| `/rules` | `chrome.declarativeNetRequest.updateDynamicRules/updateSessionRules` |
| `/webrq-register` `/webrq-pending` `/webrq-answer` | `chrome.webRequest.*` (blocking-мост) |
| `/offscreen` `/offscreen-close` `/offscreen-has` | `chrome.offscreen.*` (скрытое окно-эмуляция) |
| `/identity-token` `/identity-launch` `/identity-result` | `chrome.identity.getAuthToken/launchWebAuthFlow` |
| `/commands-register` `/commands-pending` | `chrome.commands` (глобальные хоткеи) |
| `/bm-*` `/hist-*` `/browsingdata` `/topsites` `/search` `/cs-*` `/proxy-*` `/sysdisplay` | `chrome.bookmarks/history/browsingData/topSites/search/contentSettings/proxy/system.display` |

---

## browserAPI.notifications

| Метод | Описание |
|---|---|
| `show(title, body, options?)` | Показать системное уведомление |

---

## browserAPI.passwords

| Метод | Описание |
|---|---|
| `getAll()` | Массив `{index, host, realm, username}` (пароли НЕ отдаются) |
| `removeByIndex(index)` | Удалить запись |
| `clear()` | Удалить всё |

---

## browserAPI.pip

| Метод | Описание |
|---|---|
| `open(tabId)` | PiP для вкладки → `{success, error?}` |
| `openActive()` | PiP для активной вкладки |

---

## browserAPI.net

| Метод | Описание |
|---|---|
| `getFailedUrl()` | URL неудавшейся загрузки для текущей вкладки (страница `browser://offline`) |
| `retry()` | Повторить загрузку упавшего URL из офлайн-страницы |

---

## browserAPI.about

| Метод | Описание |
|---|---|
| `getInfo()` | `{appVersion, electron, chromium, node, os, arch, userAgent}` |
| `checkUpdates()` | GitHub releases API → `{updateAvailable, latestVersion}` |

---

## browserAPI.appearance

| Метод | Описание |
|---|---|
| `getTheme()` | Текущая тема |
| `onThemeChanged(cb)` | Событие `appearance:theme-changed` → `cb(theme)` |

---

## browserAPI.ui

| Метод | Описание |
|---|---|
| `onFocusOmnibox(cb)` | Событие: сфокусировать адресную строку (Ctrl+L из вкладки) |
| `showAppMenu(x, y)` | Открыть нативное ⋮-меню |

---

## browserAPI.storage

| Метод | Описание |
|---|---|
| `getPath()` | `{downloads, userData, home}` |

---

## Внутренние страницы (протокол browser://)

| Адрес | Назначение |
|---|---|
| `browser://newtab` | Стартовая страница |
| `browser://settings` | Настройки (сайдбар с разделами) |
| `browser://privacy` | Приватность (разрешено и внутри настроек) |
| `browser://extensions` | Расширения |
| `browser://downloads` | Загрузки (Ctrl+J) |
| `browser://history` | История (Ctrl+H) |
| `browser://bookmarks` | Закладки (Ctrl+Shift+O) |
| `browser://passwords` | Пароли |
| `browser://about` | О браузере |
| `browser://offline` | «Нет соединения» (после исчерпания сетевых ретраев, кнопка «Повторить») |

## Горячие клавиши

| Клавиши | Действие |
|---|---|
| Ctrl+T | Новая вкладка |
| Ctrl+W | Закрыть вкладку (средний клик по вкладке тоже) |
| Ctrl+L | Фокус в адресную строку |
| Ctrl+D | Добавить/убрать закладку |
| Ctrl+H / Ctrl+J / Ctrl+Shift+O | История / Загрузки / Закладки |
| Ctrl+R / Alt+← / Alt+→ | Обновить / Назад / Вперёд |
| Ctrl+N | Новое окно |
| F12 | Инструменты разработчика (док внизу окна) |
| F11 | Во весь экран |

## События main → renderer

| Канал | Данные | Получатель |
|---|---|---|
| `tabs:updated` | массив вкладок | chrome-UI |
| `settings:changed` | все настройки | chrome-UI |
| `bookmarks:updated` | массив закладок | chrome-UI |
| `downloads:updated` | массив загрузок | chrome-UI, browser://downloads |
| `extensions:updated` | массив расширений | chrome-UI, browser://extensions |
| `appearance:theme-changed` | тема | chrome-UI |
| `ui:focus-omnibox` | — | chrome-UI |

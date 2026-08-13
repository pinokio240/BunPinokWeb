# Полный список Chrome Extensions API

> Источник: developer.chrome.com/docs/extensions/reference/api (актуально на 2026-07).
> Статус для BunPinokWeb: ✅ работает | 🟡 частично/стаб | ⬜ нет | 🚫 ChromeOS/неприменимо

## Уровень поддержки BunPinokWeb

### Базовые (используются почти всеми расширениями)

| API | Назначение | Статус | Чем обеспечено |
|---|---|---|---|
| `chrome.runtime` | Сообщения, манифест, URL | ✅ | Electron + electron-chrome-extensions + шим (getContexts, ContextType) |
| `chrome.storage` | Хранилище (local/sync) | ✅ | electron-chrome-extensions + шим sync→local |
| `chrome.tabs` | Вкладки | ✅ | electron-chrome-extensions |
| `chrome.windows` | Окна | ✅ | electron-chrome-extensions |
| `chrome.action` | Кнопка в тулбаре | ✅ | electron-chrome-extensions |
| `chrome.i18n` | Локализация | ✅ | шим (синхронный словарь) |
| `chrome.events` | События | ✅ | встроено |
| `chrome.extension` | Утилиты | ✅ | Electron |
| `chrome.extensionTypes` | Типы | ✅ | встроено |
| `chrome.types` | Типы (ChromeSetting) | 🟡 | частично |
| `chrome.permissions` | Права в рантайме | 🟡 | частично (библиотека) |

### Сеть и приватность

| API | Назначение | Статус | Чем обеспечено |
|---|---|---|---|
| `chrome.webRequest` | Перехват/блокировка запросов | ✅ | **webRequest-мост** (blocking через опрос) |
| `chrome.declarativeNetRequest` | Правила сети | ✅ | DNR-мост (modifyHeaders) |
| `chrome.cookies` | Cookie | ✅ | electron-chrome-extensions |
| `chrome.webNavigation` | События навигации | ✅ | electron-chrome-extensions |
| `chrome.privacy` | Приватность-настройки | 🟡 | стаб (get/set/clear) |
| `chrome.contentSettings` | Настройки сайтов | 🟡 | мост (cs-get/cs-set → sitePermissions) |
| `chrome.proxy` | Прокси | ✅ | мост (proxy-get/proxy-set → system.proxyMode) |
| `chrome.dns` | DNS | ⬜ | нет |

### Контент и скрипты

| API | Назначение | Статус | Чем обеспечено |
|---|---|---|---|
| `chrome.scripting` | Инжект скриптов | ✅ | Electron (полная поддержка) |
| `chrome.userScripts` | User scripts | ⬜ | нет |
| `chrome.offscreen` | Скрытые документы | ✅ | шим (скрытое окно + autoplay) |
| `chrome.omnibox` | Адресная строка | ⬜ | нет |
| `chrome.search` | Поиск | ✅ | мост (/search → открытие вкладки) |
| `chrome.dom` | DOM API | ⬜ | нет |
| `chrome.tabCapture` | Захват вкладки | ⬜ | нет |
| `chrome.desktopCapture` | Захват экрана | 🟡 | частично (Electron desktopCapturer) |

### Данные браузера

| API | Назначение | Статус | Чем обеспечено |
|---|---|---|---|
| `chrome.bookmarks` | Закладки | ✅ | мост (bm-gettree/create/remove/search) |
| `chrome.history` | История | ✅ | мост (hist-search/add/del/delall) |
| `chrome.downloads` | Загрузки | ✅ | мост (fetch → save в main) |
| `chrome.browsingData` | Очистка данных | ✅ | мост (/browsingdata) |
| `chrome.topSites` | Топ-сайты | ✅ | мост (/topsites из истории) |
| `chrome.readingList` | Список чтения | ⬜ | нет |
| `chrome.sessions` | Сессии | 🟡 | стаб (getRecentlyClosed/restore) |
| `chrome.tabGroups` | Группы вкладок | ⬜ | нет |
| `chrome.pageCapture` | MHTML | ⬜ | нет |

### Уведомления и медиа

| API | Назначение | Статус | Чем обеспечено |
|---|---|---|---|
| `chrome.notifications` | Уведомления | ✅ | electron-chrome-extensions |
| `chrome.alarms` | Таймеры | ✅ | реальные таймеры (delay/period + onAlarm) |
| `chrome.commands` | Горячие клавиши | ✅ | глобальные хоткеи (globalShortcut + onCommand) |
| `chrome.tts` | Синтез речи | ⬜ | нет |
| `chrome.ttsEngine` | Движок TTS | ⬜ | нет |
| `chrome.audio` | Аудиоустройства | 🚫 | ChromeOS |
| `chrome.power` | Энергосбережение | ⬜ | нет |
| `chrome.idle` | Простой системы | ⬜ | нет |

### UI расширений

| API | Назначение | Статус | Чем обеспечено |
|---|---|---|---|
| `chrome.contextMenus` | Контекстное меню | ✅ | electron-chrome-extensions |
| `chrome.sidePanel` | Боковая панель | 🟡 | стаб |
| `chrome.declarativeContent` | Условная активация | ⬜ | нет |

### Auth и безопасность

| API | Назначение | Статус | Чем обеспечено |
|---|---|---|---|
| `chrome.identity` | OAuth2 токены | 🟡 | стаб (ошибка — нет реализации) |
| `chrome.webAuthenticationProxy` | WebAuthn | ⬜ | нет |
| `chrome.platformKeys` | Сертификаты | 🚫 | ChromeOS |
| `chrome.enterprise.*` | Корпоративные | 🚫 | требует политик |

### Разработка и отладка

| API | Назначение | Статус | Чем обеспечено |
|---|---|---|---|
| `chrome.debugger` | CDP | ⬜ | нет |
| `chrome.devtools.*` | DevTools-панели | ✅ | Electron (полностью) |
| `chrome.management` | Управление расширениями | ✅ | Electron (частично) |
| `chrome.processes` | Процессы | ⬜ | нет |
| `chrome.system.cpu` | CPU | ⬜ | нет |
| `chrome.system.display` | Дисплеи | ✅ | мост (/sysdisplay → Electron screen) |
| `chrome.system.memory` | Память | ⬜ | нет |
| `chrome.system.storage` | Накопители | ⬜ | нет |
| `chrome.systemLog` | Системные логи | 🚫 | ChromeOS |
| `chrome.gcm` | FCM | 🚫 | требует Firebase |
| `chrome.instanceID` | Instance ID | ⬜ | нет |
| `chrome.loginState` | Состояние входа | 🚫 | ChromeOS |
| `chrome.fontSettings` | Шрифты | ⬜ | нет |
| `chrome.accessibilityFeatures` | Доступность | ⬜ | нет |

### ChromeOS-only (неприменимо к Windows)

`fileBrowserHandler`, `fileSystemProvider`, `documentScan`, `printing`, `printingMetrics`, `printerProvider`, `vpnProvider`, `wallpaper`, `certificateProvider`, `input.ime`, `mimeHandler`

## Итог

| Категория | Всего | Работает |
|---|---|---|
| Базовые | 11 | 11 (100%) |
| Сеть/приватность | 8 | 5 (62%) |
| Контент/скрипты | 8 | 4 (50%) |
| Данные браузера | 9 | 5 (56%) |
| Уведомления/медиа | 8 | 3 (38%) |
| UI | 3 | 2 (67%) |
| Auth/безопасность | 4 | 0 |
| Разработка | 12 | 4 (33%) |
| ChromeOS | 13 | 0 (не нужно) |

**Наиболее востребованные недостающие:** `identity` (getAuthToken/launchWebAuthFlow — VK web_token/OAuth), `omnibox`, `declarativeContent`, `tabGroups`, `userScripts`, `idle`, `tts`, `desktopCapture`.

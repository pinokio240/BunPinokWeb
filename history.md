# BunPinokWeb — Project History

## 2026-08-13 — v0.6.1 — electron-chrome-extensions (GPL-3.0)

### Решение
- Переход на библиотеку electron-chrome-extensions v4.9.0 (полные chrome.tabs/windows/runtime/action/storage API)
- Лицензия проекта: LGPL-2.1 → **GPL-3.0** (требование библиотеки), LICENSE обновлён

### Integration
- [x] ElectronChromeExtensions: createTab/selectTab/removeTab/createWindow завязаны на TabManager
- [x] tabs.js: addTab при создании, removeTab при закрытии, selectTab при переключении
- [x] handleCRXProtocol(session.defaultSession) — иконки расширений
- [x] Попапы: preload chrome-extension-api.preload.js (полный chrome.* API в попапе)
- [x] Наши стабы (compat-shim) не конфликтуют — заполняют только отсутствующие API (identity, DNR-мост остаётся)

## 2026-08-13 — v0.6.0 — PinokWeb Borrows: Privacy Shield + Shortcuts + WindowState

### Позаимствовано из C:\Users\Pinokio240\Desktop\PinokWeb
- [x] src/privacy-shield.js: адблок (домены VK/Yandex/Google Ads + паттерны, 3 уровня) + трекеры (balanced/strict, списки из PinokWeb) + HTTPS-only (VK-домены)
- [x] Настройки: секция «Защита» в Конфиденциальности (адблок, уровень, трекеры, HTTPS-Only)
- [x] Хоткеи: Ctrl+1..9 переключение вкладок, F11 полноэкранный, Ctrl+Shift+I DevTools (из ShortcutManager)
- [x] WindowState: сохранение позиции окна (debounce 500ms) + isMaximized (из WindowStateManager)
- [x] tab:selectByIndex IPC, toggleDevTools

### План: electron-chrome-extensions (GPL-3) — следующий шаг

## 2026-08-13 — v0.5.8 — Firewall Resolution

### Итог расследования
ERR_NETWORK_ACCESS_DENIED и SSL-сбросы — **фаервол на ПК пользователя блокировал Electron**. Пользователь настроил фаервол — сеть заработала.

### Побочно найден и исправлен реальный баг (v0.5.7)
Предстартовое чтение настроек не применяло дефолты network.* (ключи отсутствовали в сыром settings.json) → QUIC/HTTP2 оставались включены. Исправлено.

### Решение на будущее
- При сетевых ошибках: 1) фаервол/антивирус 2) QUIC/HTTP2 выключены по умолчанию

## 2026-08-13 — v0.5.7 — Network Defaults Fix

### Bug
Предстартовое чтение настроек читало сырой settings.json: новых ключей network.* там не было → дефолты не применялись → QUIC/HTTP2 оставались включены.

### Fixes
- [x] Предстартовый ридер: network.http2 !== true → --disable-http2; network.quic !== true → --disable-quic (отсутствие ключа = выключено)
- [x] Дефолты: network.http2 = false, network.quic = false
- [x] UI отражает новые дефолты

### Совет
ERR_NETWORK_ACCESS_DENIED может быть и от битого системного прокси → Настройки → Система → Прокси → «Без прокси»

## 2026-08-13 — v0.5.6 — Network Fixes (QUIC off)

### Problems
- ERR_QUIC_PROTOCOL_ERROR (chromewebstore.google.com)
- ERR_NETWORK_ACCESS_DENIED (vk.ru/feed)
- Медленная загрузка — время простоя на повторных попытках QUIC/HTTP2

### Diagnosis
DPI/фильтрация в РФ-сетях ломает QUIC (HTTP/3) и HTTP/2 — Chromium не всегда откатывается на TCP.

### Fixes
- [x] Настройка network.quic (по умолчанию ВЫКЛ) → --disable-quic до app ready
- [x] Тумблер «QUIC (HTTP/3)» в Системе
- [x] HTTP/2 тумблер уже был — рекомендуется тоже выключить при проблемах

## 2026-08-13 — v0.5.5 — DNR Bridge (declarativeNetRequest)

### Research (код VK Next)
- Web Token: POST login.vk.com/?act=web_token, но РАБОТАЕТ за счёт DNR-правил modifyHeaders
- Правила подменяют Origin: https://vk.com и удаляют Referer для login/oauth/api.vk.com
- Без DNR Origin уходит chrome-extension:// → VK отклоняет запрос
- Плюс правила для api.telegram.org, api.genius.com, yandex, wikipedia (Referer/Origin)

### Implementation
- [x] src/dnr-bridge.js: локальный HTTP-сервер 127.0.0.1:33123 + webRequest перехват
- [x] updateDynamicRules/updateSessionRules в шиме POST-ят правила в мост
- [x] onBeforeSendHeaders: urlFilter (glob), regexFilter, initiatorDomains/excluded, resourceTypes, set/remove/append
- [x] onHeadersReceived: responseHeaders set/remove
- [x] Инициатор: из referrer / webContents URL (chrome-extension://id → id)

## 2026-08-13 — v0.5.4 — VK Next Fix Attempt

### Diagnosis (исследование кода расширения + доков Electron)
1. Web Token = fetch POST login.vk.com/?act=web_token (credentials:include, 3 попытки × 2 домена)
2. Ошибки DOMException + SSL net_error -100/-101 = обрывы соединения (как ERR_HTTP2_SERVER_REFUSED_STREAM для github.com ранее) → похоже на проблему HTTP/2 в сети пользователя
3. chrome.scripting ПОЛНОСТЬЮ поддерживается Electron (официальные доки) — наш фильтр ошибочно вырезал это разрешение
4. chrome.alarms, chrome.declarativeNetRequest — НЕ поддерживаются → нужны стабы

### Fixes
- [x] 'scripting' убран из фильтра неизвестных разрешений
- [x] Стабы chrome.alarms и chrome.declarativeNetRequest в compat-шиме
- [x] Fallback chrome.scripting через chrome.tabs.executeScript (на случай отсутствия)
- [x] Настройка «HTTP/2» в Системе: выкл. → --disable-http2 (до app ready)

### Совет пользователю
Если Web Token всё ещё падает — выключи HTTP/2 в настройках или проверь антивирус (перехват TLS ломает соединения с login.vk.com).

## 2026-08-13 — v0.5.3 — Reader Mode (Режим чтения)

### Completed
- [x] Извлечение статьи: article/main/[role=main] с вычисткой скриптов/рекламы/навигации
- [x] browser://reader: чистый вид, шрифт А+/А−, тёмная тема, кнопка «Назад»
- [x] Запуск: ⋮ меню «Режим чтения» + контекстное меню страницы
- [x] IPC: reader:open/openActive/getContent (+ findTabByWebContents)

## 2026-08-13 — v0.5.2 — Autofill (Автозаполнение форм)

### Completed
- [x] Настройки: раздел «Автозаполнение» (имя/email/телефон/адрес)
- [x] Контекстное меню в полях форм: «Автозаполнить форму»
- [x] Заполнение по атрибутам: name/id/autocomplete/placeholder (рус. + англ. паттерны)
- [x] События input/change dispatch (совместимость с JS-фреймворками)
- [x] Default settings: autofill.name/email/phone/address

## 2026-08-13 — v0.5.1 — Site Permissions (индивидуальные разрешения)

### Completed
- [x] Исключения по доменам: vk.com → уведомления «заблокировать» и т.п.
- [x] getEffectiveSitePermission: сначала исключение сайта, потом глобальная настройка
- [x] UI в privacy.html: добавление сайта + разрешение + значение, список с удалением
- [x] IPC: sitePermissions:getAll/set/remove (валидация host/permission/value в main)
- [x] Хранение: privacy.sitePermissions (JSON в settings.json)

## 2026-08-12 — v0.5.0 — ИТОГИ ДНЯ (сессия завершена)

### Полная хронология коммитов (43 коммита)
1. `bbf1a8c` Initial commit (LICENSE)
2. `8b93b17` feat: initial project setup — Electron-based Chrome-like browser
3. `311344c` fix: bump Electron 33→43.4.0, User-Agent Chrome 150
4. `8422552` docs: Chrome settings map (96 настроек, gap analysis)
5. `4a2866b` feat: extensions loader, PiP IPC, download/path APIs
6. `c79d940` feat: download interception, notification permissions, lifecycle cleanup
7. `a203dc7` fix: protocol handler через fs.readFileSync
8. `f726054` fix: меню приложения + вставка в omnibox
9. `7f68124` fix: контекстное меню (вырезать/копировать/вставить)
10. `ecc6b70` refactor: запрет тернарников/?. /??/!! — везде if/else
11. `1385b91` feat: загрузки, ⋮-меню, темы, контекстные меню страниц, Ctrl+W
12. `da5c034` feat: полная русификация UI
13. `b1086ba` fix: ⋮-меню нативное (HTML-меню пряталось под WebContentsView)
14. `93ca43a` feat: история (browser://history, Ctrl+H)
15. `aca6ae2` feat: закладки (Ctrl+D, панель, Ctrl+Shift+O)
16. `ccf364e` feat: приватность (разрешения сайтов, DNT, блокировка попапов)
17. `cbc3179` feat: внешний вид (масштаб, шрифт, кнопка «Домой»)
18. `958a984` fix: omnibox показывает browser:// на внутренних страницах
19. `c4363ba` fix: перетаскивание окна за пустую полосу вкладок
20. `e297a0e` feat: звезда-закладка, контекстное меню панели, «Спрашивать» с очередью
21. `f0272d9` fix: Ctrl/средний клик по закладке — новая вкладка, средний клик по вкладке — закрытие
22. `72a4c59` feat: языки (орфография, перевод страницы, автоперевод)
23. `548b7e7` feat: выбор поисковика (Google/Яндекс/Bing/DuckDuckGo)
24. `2f7946c` feat: менеджер паролей (safeStorage, basic-auth диалог)
25. `4cd2613` feat: о браузере (версии, проверка обновлений GitHub)
26. `6722e68` feat: система (аппаратное ускорение, прокси)
27. `3773080` feat: полная поддержка расширений (i18n, реестр, вкл/выкл/удалить, попапы), HTTP2/SSL fallback
28. `8015a34` feat: настройки — сайдбар по разделам, ссылки на все страницы, сброс
29. `9d743be` feat: PiP извлечение видео + electron-builder NSIS
30. `744a2fd` fix: расширения — мультизагрузка, всегда видимая кнопка
31. `fca17ef` feat: установка из Chrome Web Store / Edge / Opera / .crx
32. `74cf804` feat: конвертер Firefox XPI (browser.* полифилл)
33. `cd7119e` fix: кнопка «Удалить» всегда видна + удаление папки
34. `c97581e` feat: compat-слой расширений (новый load API, MV3→MV2, фильтр разрешений, стабы)
35. `786378b` fix: host_permissions → permissions при даунгрейде
36. `b234d10` fix: попап через chrome-extension:// URL
37. `36af668` feat: автоподгон размера попапа
38. `315cde0` fix: enablePreferredSizeMode + sandbox + shim в HTML (по исследованию web)
39. `783687a` feat: перетаскивание попапа (драг-полоса)
40. `55ea003` chore: заглушены шумные warnings
41. `060a2a4` feat: баннер установки на страницах Chrome Web Store
42. `db1e886` feat: восстановление сессии («продолжить с того места»)
43. `a8c62ac` fix: ESM require() → import adm-zip (установка из магазина чинилась)

### Итоговое состояние
- **Основа**: Electron 43.4.0 (Chromium 150), UA Chrome 140/150, окно frameless с drag-зоной
- **Навигация**: Omnibox (4 поисковика), вкладки WebContentsView, внутренний протокол browser:// (9 страниц)
- **Данные**: история, закладки (+панель), загрузки, пароли (safeStorage), сессия
- **Настройки**: сайдбар, 10 разделов, ~45 из 96 настроек Chrome
- **Расширения**: Chrome/Edge/Opera/CRX/XPI, реестр, попапы, тулбар, совместимость MV3→MV2
- **Прочее**: PiP, уведомления + звук, DNT, прокси, аппаратное ускорение, русский UI
- **Документация**: `API.md` (IPC контракт), `docs/chrome-settings-map.md`
- **Упаковка**: `npm run dist` → NSIS-инсталлятор

### Известные ограничения
- chrome.identity (Web Token VK Next) — нет в Electron, стоит стаб
- Сложные MV3 service workers работают не полностью
- Firefox-специфичные API не имеют аналогов в Chromium
- Тернарники/?. /??/!! запрещены код-стилем (правило пользователя)

## 2026-08-12 — v0.4.8 — Session Restore (Продолжить с того места)

### Bug
Настройка «Продолжить с того места, где остановились» не работала — старт всегда открывал browser://newtab.

### Fixes
- [x] src/session-store.js: SessionStore — сохранение вкладок в userData/session.json
- [x] restoreStartupTabs(): continue → восстановление вкладок, vk → https://vk.com, newtab → новая вкладка
- [x] Автосохранение сессии каждые 30 сек + при before-quit

## 2026-08-12 — v0.4.7 — Extension Popup Rendering Fix (по исследованию)

### Research findings (web)
- Electron не имеет встроенного API попапов; правильный путь — chrome-extension:// URL в BrowserWindow
- Ключ: `enablePreferredSizeMode: true` + событие `preferred-size-changed` (так делает electron-chrome-extensions)
- Обязательно: та же session, что и у расширения; sandbox: true; contextIsolation: true
- Рекомендованные флаги окна: parent, movable:false, skipTaskbar, roundedCorners:false, backgroundColor:#ffffff
- Лимиты размера: 25×25 … 800×600

### Fixes
- [x] openExtensionPopup: enablePreferredSizeMode + preferred-size-changed (вместо ручного ResizeObserver)
- [x] session: session.defaultSession явно; sandbox: true; contextIsolation: true
- [x] Флаги окна как в electron-chrome-extensions
- [x] URL попапа через new URL() (корректный разбор относительных путей)
- [x] electron-compat шим инжектится и в HTML попапа/настроек (chrome.* стабы)
- [x] Удалён popup-preload.js (не нужен)

## 2026-08-12 — v0.4.6 — Extension Compatibility Layer

### Problems found (user log)
1. `session.loadExtension` deprecated → новый API `session.extensions.loadExtension`
2. `Permission 'commands' is unknown` → chrome.commands отсутствует → падение расширения
3. MV3 service worker не регистрируется в Electron
4. `Permission 'notifications' is unknown` — предупреждение, API работает
5. VK Next: chrome.identity не поддерживается (Web Token failed)

### Fixes
- [x] src/extension-compat.js: prepareExtensionForElectron
- [x] Фильтр неподдерживаемых разрешений из manifest (commands, identity, sidePanel, offscreen...)
- [x] MV3 service_worker → MV2 event page (background.scripts + persistent:false)
- [x] action → browser_action при даунгрейде
- [x] electron-compat.js шим: chrome.commands/identity/sidePanel/action/storage заглушки
- [x] Инжекция шима в background.scripts и content_scripts
- [x] Новый API: session.defaultSession.extensions.loadExtension
- [x] Попапы: поддержка и action.default_popup, и browser_action.default_popup

### Осталось ограничением (честно)
- chrome.identity (Web Token VK Next) — в Electron нет, зашит стаб с ошибкой
- Сложные MV3 service workers могут работать не полностью

## 2026-08-12 — v0.4.5 — Firefox XPI Converter

### Completed
- [x] src/xpi-converter.js: конвертер Firefox XPI → Chromium
- [x] Манифест: удаление browser_specific_settings/applications/sidebar_action, маппинг menus→contextMenus, фильтр неподдерживаемых разрешений, даунгрейд MV3→MV2 при background.scripts
- [x] Полифилл browser-polyfill.js: runtime/storage/tabs/windows/notifications/i18n/commands/bookmarks/history/action/contextMenus/webRequest/cookies + events (promise-обёртки)
- [x] Инжекция: background.scripts, content_scripts, MV3 service_worker (importScripts-обёртка), все HTML (popup/options)
- [x] Установка из файла: автоопределение .xpi → конвертация, .crx/.nex/.zip → CRX
- [x] UI: фильтр .xpi в диалоге, пояснение на странице

### Ограничения (честно)
- Firefox-специфичные API (browser.tabs.hide, sidebarAction и др.) не имеют аналогов в Chromium
- WebExtensions API покрыт частично (~80% самых частых вызовов)

## 2026-08-12 — v0.4.4 — Store Installation for Extensions

### Research
- Chromium-based browsers (Chrome/Edge/Opera/Brave/Vivaldi) — совместимы с Electron напрямую (один движок, MV3, CRX)
- Firefox (XPI/WebExtensions) и Safari — несовместимы без конвертера

### Completed
- [x] src/crx-installer.js: разбор CRX3/CRX2 (поиск ZIP-сигнатуры), извлечение adm-zip
- [x] Chrome Web Store: установка по ссылке или ID (clients2.google.com API)
- [x] Edge Add-ons: установка по ссылке (extensionwebstorebase API)
- [x] Opera Addons: установка по ссылке (addons.opera.com download)
- [x] Установка из файла .crx/.nex/.zip с ПК
- [x] UI: поле для ссылки + кнопки «Установить из магазина» и «Установить из файла»
- [x] dependency: adm-zip

## 2026-08-12 — v0.4.3 — Multiple Extensions Loading

### Fixes
- [x] Баг: кнопка «Загрузить распакованное» исчезала при наличии расширений — теперь видна всегда
- [x] Мультивыбор: dialog с multiSelections — можно выбрать несколько папок расширений за раз
- [x] Ошибки загрузки собираются и показываются (не блокируют остальные)
- [x] Toast: «Загружено расширений: N | Ошибок: M»

## 2026-08-12 — v0.4.2 — PiP Player + Packaging

### PiP
- [x] Извлечение видео: executeJavaScript в вкладке → src/currentTime/paused/title
- [x] PiP-окно: реальный источник видео, позиция воспроизведения, play/pause, перетаскивание
- [x] blob:-источники: понятное сообщение (потоковое видео извлечь нельзя)
- [x] ⋮ меню: «Картинка в картинке (PiP)» — активная вкладка
- [x] IPC: pip:openActive, pip:config, pip:togglePlay

### Packaging
- [x] electron-builder конфиг: NSIS-инсталлятор x64, ярлыки, выбор папки установки
- [x] `npm run dist` — сборка .exe
- [x] version 0.4.1

## 2026-08-12 — v0.4.1 — Settings Redesign (вкладки по разделам)

### Completed
- [x] settings.html полностью переделан: боковая панель + панели разделов (как в Chrome)
- [x] Разделы: При запуске, Внешний вид, Поиск, Языки, Загрузки, Уведомления, Конфиденциальность, Система, Сброс
- [x] Приватность (разрешения сайтов, DNT, очистка данных) встроена в настройки как раздел
- [x] Ссылки в сайдбаре: История, Закладки, Пароли, Расширения, О браузере → навигация на их страницы
- [x] Раздел «Сброс настроек»: settings:resetAll (не трогает закладки/пароли/историю)

## 2026-08-12 — v0.4.0 — Full Extension Support + UX + HTTP2 Fallback

### ⋮ Menu
- [x] «Пароли» и «О браузере» добавлены в видимое ⋮ меню (нативное меню не видно в frameless)

### Extensions (полная поддержка)
- [x] i18n: разрешение `__MSG_xxx__` из _locales (default_locale), фикс `__MSG_extName__`
- [x] Реестр расширений (registry.json) — расширения переживают перезапуск
- [x] Включить/выключить (disable = unload без удаления из реестра, enable = повторная загрузка)
- [x] Удалить (выгрузка + удаление из реестра)
- [x] Иконки расширений (base64 data URL из manifest icons) на странице и в тулбаре
- [x] Попапы: клик по иконке в тулбаре → окно 400×500 с action.default_popup, закрытие по потере фокуса
- [x] IPC: extensions:disable/enable/remove/openPopup + broadcast extensions:updated

### Network
- [x] ERR_HTTP2_SERVER_REFUSED_STREAM → автоматический повтор один раз
- [x] SSL-ошибки → fallback на http:// (один раз)

## 2026-08-12 — v0.3.4 — System (Система)

### Completed
- [x] Аппаратное ускорение: вкл/выкл, читается ДО app ready (disableHardwareAcceleration), требует перезапуск
- [x] Прокси: режим системный/без прокси/вручную, session.setProxy (direct/fixed_servers/system)
- [x] Настройки: секция «Система» (hw accel, proxy mode, proxy server)
- [x] Default settings: system.hardwareAcceleration/proxyMode/proxyServer

## 2026-08-12 — v0.3.3 — About (О браузере)

### Completed
- [x] browser://about: версии (app/Electron/Chromium/Node), ОС, архитектура, User-Agent
- [x] Проверка обновлений: fetch GitHub releases API, сравнение версий
- [x] Меню «Справка → О BunPinokWeb» теперь ведёт на browser://about
- [x] IPC: about:getInfo, about:checkUpdates

## 2026-08-12 — v0.3.2 — Passwords (Пароли)

### Completed
- [x] src/password-store.js: PasswordStore, шифрование safeStorage (fallback на plaintext с пометкой)
- [x] src/auth-dialog.js: диалог входа (пользователь/пароль/запомнить), Enter, отмена = закрытие
- [x] app.on('login'): авто-вход из хранилища, иначе диалог, опция «Запомнить»
- [x] browser://passwords: список (хост/realm/пользователь), удаление по записи, удалить все
- [x] ⋮ меню: «Пароли»
- [x] IPC: passwords:getAll/removeByIndex/clear

## 2026-08-12 — v0.3.1 — Search Engine Selection (Поисковая система)

### Completed
- [x] OmniboxParser параметризован движком: Google/Яндекс/Bing/DuckDuckGo
- [x] Настройка search.engine в настройках («Поисковая система»)
- [x] Все точки входа используют выбранный движок (omnibox, home button, tab:create/navigate, startup)

## 2026-08-12 — v0.3.0 — Languages (Языки)

### Completed
- [x] Проверка орфографии: вкл/выкл + выбор языка (setSpellCheckerLanguages)
- [x] Настройки: language.spellcheck, language.spellcheckLanguages
- [x] «Перевести страницу» в ⋮ меню → translate.google.com с URL активной вкладки
- [x] Автоперевод: did-stop-loading → проверка lang атрибута → редирект на перевод (не для browser://, не для translate.google.com)
- [x] Настройки: секция «Языки» (орфография, язык, автоперевод)

## 2026-08-12 — v0.2.5 — Bookmark Navigation Fixes

### Investigation
Traced full bookmark navigation chain: parser (tested 8 URL types — OK), IPC, loadURL, escapeHtml/dataset roundtrip (entities decode correctly). Found gaps vs Chrome behavior:

### Fixes
- [x] Панель закладок: Ctrl+клик и средний клик (колесо) открывают закладку в НОВОЙ вкладке (было: всегда текущая)
- [x] Страница browser://bookmarks: Ctrl+клик и средний клик — новая вкладка
- [x] Убрана бесполезная кнопка «Добавить текущую страницу» со страницы закладок (активная вкладка — сама страница закладок, browser:// не добавляется)
- [x] Средний клик по вкладке закрывает её (поведение Chrome)

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

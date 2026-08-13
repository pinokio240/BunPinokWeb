const AD_DOMAINS = [
    'ad.mail.ru', 'ads.vk.ru', 'vk-ads.net',
    'adman.vk.ru', 'ad.vkvideo.ru', 'ads.vk.com', 'ad.vk.com',
    'an.yandex.ru', 'mc.yandex.ru', 'yabs.yandex.ru',
    'googleads.g.doubleclick.net',
    'pagead2.googlesyndication.com',
    'adfox.yandex.ru', 'adfox.ru',
    'adriver.ru',
    'adnxs.com',
    'criteo.com', 'criteo.net',
    'rubiconproject.com',
    'pubmatic.com',
    'openx.net',
    'smartadserver.com',
    'doubleverify.com',
    'adtech.yandex.ru',
    'awaps.yandex.ru',
    'advertising.com',
    'moatads.com',
    'adservice.google.com',
    'googleadservices.com'
];

const AD_URL_PATTERNS = [
    '/ads/', '/ad/', '/banner/', '/preroll/',
    'adman_html5', 'adfox', 'ads_app',
    'vk_ads', 'promoted_', '_ad_',
    '/stats?', 'top.mail.ru'
];

const BALANCED_TRACKERS = [
    'google-analytics.com', 'googletagmanager.com', 'googleadservices.com',
    'doubleclick.net', 'googlesyndication.com', 'googleoptimize.com',
    'facebook.net', 'fbcdn.net', 'facebook.com/tr',
    'mc.yandex.ru', 'yandex.net/metrika', 'an.yandex.ru',
    'hotlog.ru', 'liveinternet.ru', 'top100.rambler.ru',
    'counter.yadro.ru', 'bigmir.net', 'mail.ru/count',
    't.co', 'analytics.twitter.com',
    'amplitude.com', 'segment.io', 'segment.com', 'mixpanel.com',
    'hotjar.com', 'fullstory.com', 'sentry.io'
];

const STRICT_TRACKERS = [
    'cdn.mxpnl.com', 'api.amplitude.com', 'api.segment.io',
    'cdn.segment.com', 'api.mixpanel.com',
    'static.hotjar.com', 'sentry.io/api',
    'platform.twitter.com/widgets', 'connect.facebook.net',
    'apis.google.com/js/plusone.js',
    'adfox.yandex.ru', 'yandex.ru/adv', 'vk.com/js/adman_event',
    'mojetrafik.ru', 'recreativ.ru', 'admail.ru'
];

const BLOCKABLE_TYPES = new Set([
    'script', 'image', 'stylesheet', 'xmlhttprequest',
    'subresource', 'media', 'font', 'other'
]);

export class PrivacyShield {
    constructor(settingsStore) {
        this.settingsStore = settingsStore;
        this.stats = {
            adsBlocked: 0,
            trackersBlocked: 0,
            httpsRedirects: 0
        };
        this.recentBlocked = [];
    }

    setup(webSession) {
        webSession.webRequest.onBeforeRequest((details, callback) => {
            const httpsOnly = this.settingsStore.get('privacy.httpsOnly', true);
            if (httpsOnly && details.url.startsWith('http://')) {
                try {
                    const parsed = new URL(details.url);
                    const hostname = parsed.hostname;
                    if (hostname === 'vk.ru' || hostname.endsWith('.vk.ru') || hostname === 'vk.com' || hostname.endsWith('.vk.com')) {
                        this.stats.httpsRedirects = this.stats.httpsRedirects + 1;
                        callback({ redirectURL: details.url.replace(/^http:/, 'https:') });
                        return;
                    }
                } catch (err) {
                    // некорректный URL — пропускаем
                }
            }

            const adblock = this.settingsStore.get('privacy.adblock', true);
            if (adblock && BLOCKABLE_TYPES.has(details.resourceType)) {
                if (this._shouldBlockAd(details.url, details.resourceType)) {
                    this._recordBlocked(details.url, 'ad');
                    callback({ cancel: true });
                    return;
                }
            }

            const trackingLevel = this.settingsStore.get('privacy.tracking', 'balanced');
            if (trackingLevel !== 'off') {
                if (this._isTracker(details.url, trackingLevel)) {
                    this._recordBlocked(details.url, 'tracker');
                    callback({ cancel: true });
                    return;
                }
            }

            callback({});
        });
    }

    _shouldBlockAd(url, resourceType) {
        try {
            const parsed = new URL(url);
            const hostname = parsed.hostname;
            for (const adDomain of AD_DOMAINS) {
                if (hostname === adDomain || hostname.endsWith('.' + adDomain)) {
                    return true;
                }
            }
            const level = this.settingsStore.get('privacy.adblockLevel', 'standard');
            if (level !== 'basic') {
                for (const pattern of AD_URL_PATTERNS) {
                    if (url.includes(pattern)) {
                        if (hostname.includes('api.vk.ru') || hostname.includes('vk.ru/method/')) {
                            return false;
                        }
                        return true;
                    }
                }
            }
            if (level === 'aggressive') {
                if (resourceType === 'image' && (url.includes('pixel') || url.includes('beacon') || url.includes('tracking'))) {
                    return true;
                }
                if (resourceType === 'script' && !hostname.endsWith('.vk.ru') && !hostname.endsWith('.vk.com')) {
                    if (url.includes('analytics') || url.includes('tracker') || url.includes('telemetry')) {
                        return true;
                    }
                }
            }
            return false;
        } catch (err) {
            return false;
        }
    }

    _isTracker(url, level) {
        const lowered = url.toLowerCase();
        const trackers = level === 'strict' ? STRICT_TRACKERS : BALANCED_TRACKERS;
        for (const tracker of trackers) {
            if (lowered.includes(tracker)) {
                return true;
            }
        }
        return false;
    }

    _recordBlocked(url, type) {
        const entry = { url: url, type: type, ts: Date.now() };
        this.recentBlocked.unshift(entry);
        if (this.recentBlocked.length > 50) {
            this.recentBlocked.pop();
        }
        if (type === 'ad') {
            this.stats.adsBlocked = this.stats.adsBlocked + 1;
        } else {
            this.stats.trackersBlocked = this.stats.trackersBlocked + 1;
        }
    }

    getStats() {
        const copy = {};
        for (const key of Object.keys(this.stats)) {
            copy[key] = this.stats[key];
        }
        return copy;
    }

    getRecentBlocked() {
        return this.recentBlocked.map((entry) => {
            return { url: entry.url, type: entry.type, ts: entry.ts };
        });
    }
}

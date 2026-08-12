const SEARCH_ENGINE = 'https://www.google.com/search?q=';

const URL_PATTERN = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w\-./?%&=+#]*)?$/i;
const DOMAIN_PATTERN = /^([\w-]+\.)+[a-z]{2,}(\/[\w\-./?%&=+#]*)?$/i;
const PROTOCOL_PATTERN = /^(https?|file|browser):\/\//i;

export class OmniboxParser {
    static parse(input) {
        if (!input || !input.trim()) {
            return 'browser://newtab';
        }

        const trimmed = input.trim();

        if (trimmed.startsWith('browser://')) {
            return trimmed;
        }

        if (PROTOCOL_PATTERN.test(trimmed)) {
            return trimmed;
        }

        if (URL_PATTERN.test(trimmed)) {
            if (!/^https?:\/\//i.test(trimmed)) {
                return `https://${trimmed}`;
            }
            return trimmed;
        }

        if (DOMAIN_PATTERN.test(trimmed)) {
            return `https://${trimmed}`;
        }

        return `${SEARCH_ENGINE}${encodeURIComponent(trimmed)}`;
    }

    static isInternalPage(url) {
        return url.startsWith('browser://');
    }

    static isValidUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
}

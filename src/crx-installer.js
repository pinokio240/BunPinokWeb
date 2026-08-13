import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import AdmZip from 'adm-zip';

const EXTENSION_ID_PATTERN = /[a-p]{32}/;

function getZipStart(buffer) {
    const signature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const maxSearch = Math.min(buffer.length, 64 * 1024);
    for (let i = 0; i < maxSearch; i++) {
        let match = true;
        for (let j = 0; j < 4; j++) {
            if (buffer[i + j] !== signature[j]) {
                match = false;
                break;
            }
        }
        if (match) {
            return i;
        }
    }
    return -1;
}

export class CrxInstaller {
    constructor(extensionManager, xpiConverter) {
        this.extensionManager = extensionManager;
        this.xpiConverter = xpiConverter;
    }

    _installedDir() {
        const dir = path.join(app.getPath('userData'), 'extensions', 'installed');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    detectSource(input) {
        const trimmed = input.trim();
        if (trimmed.includes('addons.mozilla.org')) {
            return { type: 'amo', slug: this._extractAmoSlug(trimmed) };
        }
        if (trimmed.includes('chromewebstore.google.com')) {
            return { type: 'chrome', id: this._extractId(trimmed) };
        }
        if (trimmed.includes('chrome.google.com/webstore')) {
            return { type: 'chrome', id: this._extractId(trimmed) };
        }
        if (trimmed.includes('microsoftedge.microsoft.com/addons')) {
            return { type: 'edge', id: this._extractId(trimmed) };
        }
        if (trimmed.includes('addons.opera.com')) {
            return { type: 'opera', slug: this._extractOperaSlug(trimmed) };
        }
        if (EXTENSION_ID_PATTERN.test(trimmed) && trimmed.length === 32) {
            return { type: 'chrome', id: trimmed };
        }
        return { type: 'unknown', id: '' };
    }

    _extractAmoSlug(url) {
        const match = url.match(/\/addon\/([a-zA-Z0-9\-]+)/i);
        if (match) {
            return match[1];
        }
        return '';
    }

    _extractId(url) {
        const match = url.match(/[a-p]{32}/);
        if (match) {
            return match[0];
        }
        return '';
    }

    _extractOperaSlug(url) {
        const match = url.match(/extensions\/details\/([a-z0-9\-]+)/i);
        if (match) {
            return match[1];
        }
        const match2 = url.match(/extensions\/([a-z0-9\-]+)\/?$/i);
        if (match2) {
            return match2[1];
        }
        return '';
    }

    _buildDownloadUrl(source) {
        if (source.type === 'chrome') {
            return 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=140.0&acceptformat=crx2,crx3&x=id%3D' + source.id + '%26uc';
        }
        if (source.type === 'edge') {
            return 'https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&x=id%3D' + source.id + '%26installsource%3Dondemand%26uc';
        }
        if (source.type === 'opera') {
            return 'https://addons.opera.com/extensions/download/' + source.slug + '/';
        }
        return '';
    }

    _readCrxFile(filePath) {
        const buffer = fs.readFileSync(filePath);
        const zipStart = getZipStart(buffer);
        if (zipStart < 0) {
            throw new Error('Файл не является CRX-архивом (нет ZIP-данных)');
        }
        return buffer.slice(zipStart);
    }

    _extractZip(zipBuffer, targetDir) {
        const zip = new AdmZip(zipBuffer);
        if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true, force: true });
        }
        zip.extractAllTo(targetDir, true);
    }

    async _downloadBuffer(url) {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
                'Accept-Language': 'ru,en;q=0.8'
            },
            redirect: 'follow'
        });
        if (!response.ok) {
            throw new Error('Ошибка загрузки: HTTP ' + response.status);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    async installFromUrl(url) {
        const source = this.detectSource(url);
        if (source.type === 'unknown') {
            throw new Error('Не удалось распознать источник. Вставьте ссылку из Chrome Web Store, Edge Add-ons, Opera Addons, addons.mozilla.org (Firefox) или ID расширения (32 символа).');
        }
        if (source.type === 'amo') {
            return await this._installFromAmo(source);
        }
        if (source.type === 'chrome' && !source.id) {
            throw new Error('Не найден ID расширения в ссылке');
        }
        if (source.type === 'edge' && !source.id) {
            throw new Error('Не найден ID расширения в ссылке');
        }
        if (source.type === 'opera' && !source.slug) {
            throw new Error('Не найден идентификатор расширения Opera');
        }

        const downloadUrl = this._buildDownloadUrl(source);
        const buffer = await this._downloadBuffer(downloadUrl);
        const zipStart = getZipStart(buffer);
        if (zipStart < 0) {
            throw new Error('Скачанный файл не является CRX-архивом');
        }
        const zipBuffer = buffer.slice(zipStart);

        const targetDir = path.join(this._installedDir(), source.id || source.slug);
        this._extractZip(zipBuffer, targetDir);

        const manifestPath = path.join(targetDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error('В архиве нет manifest.json');
        }

        const extId = await this.extensionManager.loadExtension(targetDir);
        return { id: extId, path: targetDir };
    }

    async _installFromAmo(source) {
        if (!source.slug) {
            throw new Error('Не найден идентификатор расширения в ссылке AMO');
        }
        const apiUrl = 'https://addons.mozilla.org/api/v5/addons/addon/' + source.slug + '/';
        const apiResponse = await fetch(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
                'Accept-Language': 'ru,en;q=0.8'
            }
        });
        if (!apiResponse.ok) {
            throw new Error('Расширение не найдено на addons.mozilla.org: HTTP ' + apiResponse.status);
        }
        const apiData = await apiResponse.json();
        const xpiUrl = apiData.current_version && apiData.current_version.file ? apiData.current_version.file.url : '';
        if (!xpiUrl) {
            throw new Error('Не удалось получить ссылку на XPI-файл');
        }
        const buffer = await this._downloadBuffer(xpiUrl);

        const tempPath = path.join(app.getPath('temp'), 'amo-' + source.slug + '-' + Date.now() + '.xpi');
        fs.writeFileSync(tempPath, buffer);

        const targetDir = path.join(this._installedDir(), 'amo-' + source.slug);
        try {
            this.xpiConverter.convert(tempPath, targetDir);
        } finally {
            try {
                fs.unlinkSync(tempPath);
            } catch (cleanupErr) {
                console.error('Не удалось удалить временный XPI:', cleanupErr);
            }
        }

        const extId = await this.extensionManager.loadExtension(targetDir);
        return { id: extId, path: targetDir };
    }

    async installFromFile(filePath) {
        const zipBuffer = this._readCrxFile(filePath);

        const tempDir = path.join(this._installedDir(), 'tmp-' + Date.now());
        this._extractZip(zipBuffer, tempDir);

        const manifestPath = path.join(tempDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            throw new Error('В архиве нет manifest.json');
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const id = manifest.key ? 'k-' + Date.now() : 'f-' + Date.now();
        const finalDir = path.join(this._installedDir(), id);
        if (fs.existsSync(finalDir)) {
            fs.rmSync(finalDir, { recursive: true, force: true });
        }
        fs.renameSync(tempDir, finalDir);

        const extId = await this.extensionManager.loadExtension(finalDir);
        return { id: extId, path: finalDir };
    }
}

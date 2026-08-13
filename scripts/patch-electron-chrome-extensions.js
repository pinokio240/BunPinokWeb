import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(scriptDir, '..', 'node_modules', 'electron-chrome-extensions', 'dist', 'chrome-extension-api.preload.js');

if (!fs.existsSync(target)) {
    console.log('[bunpinokweb] chrome-extension-api.preload.js не найден — патч пропущен');
    process.exit(0);
}

let content = fs.readFileSync(target, 'utf-8');
const before = content;
content = content.replace(/if \(true\) \{\n\s*console\.log/g, 'if (false) {\n      console.log');
if (content === before) {
    console.log('[bunpinokweb] патч не требуется');
    process.exit(0);
}
fs.writeFileSync(target, content, 'utf-8');
console.log('[bunpinokweb] chrome-extension-api.preload.js пропатчен: debug-спам выключен');

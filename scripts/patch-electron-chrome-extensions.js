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
let patched = false;

const replacements = [
    {
        from: /if \(true\) \{\n\s*console\.log/g,
        to: 'if (false) {\n      console.log',
        name: 'debug-спам'
    },
    {
        from: /delete globalThis\.electron;\n\s*Object\.freeze\(chrome\);/g,
        to: 'delete globalThis.electron;',
        name: 'Object.freeze(chrome)'
    },
    {
        from: /^(\s*)import_electron2\.contextBridge\.exposeInMainWorld\("electron", electronContext\);$/gm,
        to: '$1try { import_electron2.contextBridge.exposeInMainWorld("electron", electronContext); } catch (bindErr) { try { window.electron = electronContext; } catch (bindErr2) {} }',
        name: 'exposeInMainWorld guard'
    }
];

for (const replacement of replacements) {
    if (replacement.from.test(content)) {
        content = content.replace(replacement.from, replacement.to);
        patched = true;
        console.log('[bunpinokweb] применён патч: ' + replacement.name);
    }
}

if (!patched) {
    console.log('[bunpinokweb] патч не требуется');
    process.exit(0);
}
fs.writeFileSync(target, content, 'utf-8');
console.log('[bunpinokweb] chrome-extension-api.preload.js пропатчен');

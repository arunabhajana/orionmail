import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cli from '@tauri-apps/cli';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const command = args[0];

const iconsDir = path.join(__dirname, '../src-tauri/icons');
const devIconsDir = path.join(__dirname, '../src-tauri/icons-dev');
const prodIconsDir = path.join(__dirname, '../src-tauri/icons-prod');

// Avoid rewriting identical assets: Tauri watches these files and Cargo already
// reruns its build script when an icon really changes.
function syncIcons(source, destination) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name);
        const to = path.join(destination, entry.name);
        if (entry.isDirectory()) syncIcons(from, to);
        else if (entry.isFile()) {
            const bytes = fs.readFileSync(from);
            if (!fs.existsSync(to) || !bytes.equals(fs.readFileSync(to))) fs.writeFileSync(to, bytes);
        }
    }
}

if (command === 'dev' && fs.existsSync(devIconsDir)) {
    console.log("🚀 [OrionMail] Switching to DEV icon set...");
    syncIcons(devIconsDir, iconsDir);
} else if (command === 'build' && fs.existsSync(prodIconsDir)) {
    console.log("📦 [OrionMail] Switching to PRODUCTION icon set...");
    syncIcons(prodIconsDir, iconsDir);
}

// Use the installed CLI in this process rather than retaining a wrapper,
// a shell, and npx for the entire development session.

cli.run(args, 'npm run tauri').catch(error => {
    cli.logError(error.message);
    process.exitCode = 1;
});

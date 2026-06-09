const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const command = args[0];

const iconsDir = path.join(__dirname, '../src-tauri/icons');
const devIconsDir = path.join(__dirname, '../src-tauri/icons-dev');
const prodIconsDir = path.join(__dirname, '../src-tauri/icons-prod');

const buildRsPath = path.join(__dirname, '../src-tauri/build.rs');

if (command === 'dev' && fs.existsSync(devIconsDir)) {
    console.log("🚀 [OrionMail] Switching to DEV icon set...");
    fs.cpSync(devIconsDir, iconsDir, { recursive: true });
    if (fs.existsSync(buildRsPath)) {
        const now = new Date();
        fs.utimesSync(buildRsPath, now, now);
    }
} else if (command === 'build' && fs.existsSync(prodIconsDir)) {
    console.log("📦 [OrionMail] Switching to PRODUCTION icon set...");
    fs.cpSync(prodIconsDir, iconsDir, { recursive: true });
    if (fs.existsSync(buildRsPath)) {
        const now = new Date();
        fs.utimesSync(buildRsPath, now, now);
    }
}

spawnSync('npx', ['@tauri-apps/cli', ...args], { stdio: 'inherit', shell: true });

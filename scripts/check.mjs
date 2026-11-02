import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './release/lib.mjs';
const mode = process.argv[2] || 'quick';
const node = process.execPath;
const commands = {
    quick: [[node, ['scripts/release.mjs', 'versions']], [node, ['scripts/release.mjs', 'generate', '--check']], [node, ['node_modules/typescript/bin/tsc', '--noEmit']], [node, ['node_modules/eslint/bin/eslint.js', '.', '--max-warnings=0']], [node, ['scripts/check.mjs', 'tests']]],
    unit: [[node, ['--test', ...fs.readdirSync(path.join(ROOT, 'scripts')).filter(name => name.endsWith('.test.mjs')).sort().map(name => `scripts/${name}`)]]],
    tests: [[node, ['scripts/check.mjs', 'unit']], [node, ['node_modules/vitest/vitest.mjs', 'run']]],
    desktop: [['cargo', ['check', '--manifest-path', 'src-tauri/Cargo.toml', '--locked']], ['cargo', ['clippy', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--all-targets', '--', '-D', 'warnings']], ['cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--lib']]],
    all: [[node, ['scripts/check.mjs', 'quick']], [node, ['scripts/check.mjs', 'desktop']], [node, ['node_modules/next/dist/bin/next', 'build']]],
    build: [[node, ['scripts/release.mjs', 'doctor', '--release']], [node, ['scripts/release.mjs', 'generate']], [node, ['scripts/release.mjs', 'release-check']], [node, ['scripts/tauri.js', 'build']]],
};
try {
    if (!commands[mode]) throw new Error(`Unknown check group: ${mode}`);
    for (const [bin, args] of commands[mode]) {
        console.log(`\n> ${bin} ${args.join(' ')}`);
        const result = spawnSync(bin, args, { cwd: ROOT, stdio: 'inherit', shell: false });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`Check failed (${result.status ?? result.signal}): ${bin} ${args.join(' ')}`);
    }
} catch (error) { console.error(error.message); process.exitCode = 1; }

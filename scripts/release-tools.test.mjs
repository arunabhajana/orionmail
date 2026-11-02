import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, checkVersions, bumpPlan, writeBatch, validateRelease, generatedCatalog, readJSON, markdown, requirePublishable } from './release/lib.mjs';
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-release-test-'));
    t.after(() => { const resolved = path.resolve(root); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.ok(path.basename(resolved).startsWith('orion-release-test-')); fs.rmSync(resolved, { recursive: true, force: true }); });
    for (const name of ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json']) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.copyFileSync(path.join(ROOT, name), path.join(root, name)); }
    fs.cpSync(path.join(ROOT, 'releases'), path.join(root, 'releases'), { recursive: true }); fs.cpSync(path.join(ROOT, 'public/releases'), path.join(root, 'public/releases'), { recursive: true });
    return root;
}
test('version bumps update all application versions and preserve dependency lock entries', t => {
    const root = fixture(t), old = checkVersions(root), plan = bumpPlan(root, 'minor');
    assert.equal(checkVersions(root), old, 'planning must not write');
    const before = fs.readFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'utf8'); writeBatch(root, plan.updates);
    assert.equal(checkVersions(root), plan.next);
    const after = fs.readFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'utf8');
    assert.equal(after.replace(/\r\n/g, '\n').replace(`name = "app"\nversion = "${plan.next}"`, `name = "app"\nversion = "${old}"`), before.replace(/\r\n/g, '\n'));
});

test('bump dry runs do not mutate the checkout', () => {
    const files = ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json'];
    const before = files.map(name => fs.readFileSync(path.join(ROOT, name), 'utf8'));
    const result = spawnSync(process.execPath, ['scripts/release.mjs', 'bump', 'patch', '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /no files changed/);
    assert.deepEqual(files.map(name => fs.readFileSync(path.join(ROOT, name), 'utf8')), before);
});

test('release preparation rejects samples, drafts, missing dates and typo flags', () => {
    const ready = { status: 'ready', sample: false, date: '2026-11-03' };
    assert.equal(requirePublishable(ready), ready);
    for (const changes of [{ sample: true }, { status: 'draft' }, { date: null }]) assert.throws(() => requirePublishable({ ...ready, ...changes }));
    const result = spawnSync(process.execPath, ['scripts/release.mjs', 'bump', '--dryrun'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /Unknown option/);
});

test('staging failures preserve every original file', t => {
    const root = fixture(t), before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    const collision = path.join(root, `package-lock.json.release-${process.pid}.tmp`);
    fs.writeFileSync(collision, 'already in use');
    assert.throws(() => writeBatch(root, new Map([['package.json', 'changed'], ['package-lock.json', 'changed']])));
    assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), before);
    assert.equal(fs.readFileSync(collision, 'utf8'), 'already in use');
});
test('invalid, backward and mismatched bumps fail without modifying files', t => {
    const root = fixture(t), before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    for (const version of ['0.0.0', '0.1.0', 'v1.0.0', '1.0.0-beta.1', '01.2.3', '256.0.0']) assert.throws(() => bumpPlan(root, version));
    assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), before);
    const config = readJSON(root, 'src-tauri/tauri.conf.json'); config.version = '9.0.0'; fs.writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify(config)); assert.throws(() => checkVersions(root), /does not match/);
});
test('release validation rejects unfinished notes, missing images and unsafe image paths', t => {
    const root = fixture(t), release = readJSON(root, 'releases/0.1.0.json'); assert.equal(validateRelease(root, release, '0.1.0'), release);
    for (const mutate of [r => r.title = 'TODO: title', r => r.version = '0.2.0', r => r.whatsNew[0].image.alt = '', r => r.whatsNew[0].image.src = '/releases/0.1.0/missing.png', r => r.whatsNew[0].image.src = '/releases/0.1.0/../../private.png', r => r.sections[0].category = 'Other', r => r.date = '2026-02-30']) { const copy = structuredClone(release); mutate(copy); assert.throws(() => validateRelease(root, copy, '0.1.0')); }
});
test('catalog and text-only release description are deterministic and version aligned', t => {
    const root = fixture(t), release = readJSON(root, 'releases/0.1.0.json'); assert.equal(generatedCatalog(root), generatedCatalog(root));
    const body = markdown(release); assert.match(body, /## Added/); assert.match(body, /## Known issues/); assert.ok(!body.includes('<svg')); assert.ok(!body.includes('!['));
});

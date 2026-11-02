import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const readJSON = (root, name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
export function versionParts(value) {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('Use a stable version such as 0.2.0 (no v prefix).');
    const parts = value.split('.').map(Number);
    if (parts[0] > 255 || parts[1] > 255 || parts[2] > 65535) throw new Error('Version exceeds the Windows MSI version range.');
    return parts;
}
export function versions(root = ROOT) {
    const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
    const packageSection = cargo.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1];
    const name = packageSection?.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const rust = packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    const blocks = fs.readFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'utf8').split('[[package]]');
    const own = blocks.filter(block => block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] === name && !/^source\s*=/m.test(block));
    if (!name || !rust || own.length !== 1) throw new Error('Cannot uniquely locate the application in Cargo manifests.');
    const lock = readJSON(root, 'package-lock.json');
    return {
        'package.json': readJSON(root, 'package.json').version,
        'package-lock.json': lock.version,
        'package-lock.json packages[""]': lock.packages?.['']?.version,
        'src-tauri/tauri.conf.json': readJSON(root, 'src-tauri/tauri.conf.json').version,
        'src-tauri/Cargo.toml': rust,
        'src-tauri/Cargo.lock': own[0].match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    };
}
export function checkVersions(root = ROOT) {
    const values = versions(root), current = values['package.json'];
    versionParts(current);
    for (const [file, value] of Object.entries(values)) if (value !== current) throw new Error(`${file}: ${value} does not match ${current}.`);
    return current;
}
export function bumpPlan(root, requested) {
    const current = checkVersions(root), parts = versionParts(current);
    let next = requested;
    if (['major', 'minor', 'patch'].includes(requested)) {
        const index = ['major', 'minor', 'patch'].indexOf(requested);
        parts[index]++; for (let i = index + 1; i < 3; i++) parts[i] = 0;
        next = parts.join('.');
    }
    const nextParts = versionParts(next);
    const old = versionParts(current);
    const comparison = nextParts.map((n, i) => n - old[i]).find(n => n !== 0) || 0;
    if (comparison <= 0) throw new Error('The new version must be greater than the current version.');
    const updates = new Map();
    for (const name of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json']) {
        const data = readJSON(root, name); data.version = next;
        if (name === 'package-lock.json') data.packages[''].version = next;
        updates.set(name, JSON.stringify(data, null, 2) + '\n');
    }
    const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
    const name = cargo.match(/\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m)[1];
    updates.set('src-tauri/Cargo.toml', cargo.replace(/(\[package\][\s\S]*?^version\s*=\s*")[^"]+/m, (_, prefix) => prefix + next));
    const lock = fs.readFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'utf8');
    updates.set('src-tauri/Cargo.lock', lock.split('[[package]]').map(block => {
        if (block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] === name && !/^source\s*=/m.test(block)) return block.replace(/(^version\s*=\s*")[^"]+/m, (_, prefix) => prefix + next);
        return block;
    }).join('[[package]]'));
    return { current, next, updates };
}
/** Stage all files first; restore original bytes if replacement fails. */
export function writeBatch(root, updates) {
    const originals = new Map(), temporary = [];
    try {
        for (const [name, text] of updates) {
            const target = path.join(root, name); originals.set(target, fs.existsSync(target) ? fs.readFileSync(target) : null);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const temp = target + `.release-${process.pid}.tmp`; fs.writeFileSync(temp, text, { flag: 'wx' }); temporary.push([temp, target]);
        }
        for (const [temp, target] of temporary) {
            try { fs.renameSync(temp, target); }
            catch (error) {
                // Windows controlled folders can disallow rename-over-existing.
                // Keep the staged bytes and rollback protection for this fallback.
                if (error.code !== 'EPERM' || !fs.existsSync(target)) throw error;
                fs.writeFileSync(target, fs.readFileSync(temp));
            }
        }
    } catch (error) {
        for (const [target, bytes] of originals) { if (bytes === null) { if (fs.existsSync(target)) fs.unlinkSync(target); } else fs.writeFileSync(target, bytes); }
        throw error;
    } finally { for (const [temp] of temporary) if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
const categories = ['Added', 'Improved', 'Fixed', 'Known issues'];
function text(value, label, max = 1200) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /\b(TODO|TBD|PLACEHOLDER)\b/i.test(value)) throw new Error(`Invalid or unfinished ${label}.`);
}
export function validateRelease(root, release, expected) {
    if (release.schemaVersion !== 1 || release.version !== expected) throw new Error(`Release file/version mismatch for ${expected}.`);
    if (typeof release.sample !== 'boolean') throw new Error('Release sample must be true or false.');
    versionParts(release.version); text(release.title, 'release title', 100); text(release.summary, 'release summary');
    if (!['draft', 'ready', 'released'].includes(release.status)) throw new Error('Release status must be draft, ready or released.');
    if (release.date !== null && (typeof release.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(release.date) || new Date(release.date).toISOString().slice(0, 10) !== release.date)) throw new Error('Invalid release date.');
    if (release.status !== 'draft' && !release.date) throw new Error('Ready releases need a date.');
    if (!Array.isArray(release.sections) || !release.sections.length) throw new Error('Release notes need categorized text.');
    const seen = new Set();
    for (const section of release.sections) {
        if (!categories.includes(section.category) || seen.has(section.category)) throw new Error('Unknown or duplicate release category.');
        seen.add(section.category);
        if (!Array.isArray(section.items) || !section.items.length) throw new Error('A release category needs at least one entry.');
        for (const item of section.items) { text(item.title, 'entry title', 120); text(item.text, 'entry text'); }
    }
    if (!Array.isArray(release.whatsNew) || !release.whatsNew.length || release.whatsNew.length > 10) throw new Error('What’s new needs 1–10 slides.');
    const ids = new Set();
    for (const slide of release.whatsNew) {
        if (!/^[a-z0-9-]+$/.test(slide.id) || ids.has(slide.id)) throw new Error('Slide IDs must be unique slugs.'); ids.add(slide.id);
        text(slide.title, 'slide title', 100); text(slide.eyebrow, 'slide eyebrow', 100); text(slide.text, 'slide text', 600); text(slide.image?.alt, 'image alt text', 200);
        const src = slide.image?.src;
        if (typeof src !== 'string' || !src.startsWith(`/releases/${expected}/`) || src.includes('..') || src.includes('\\') || !/\.(svg|png|webp|jpg|jpeg)$/.test(src)) throw new Error('Slides need a local version-scoped image.');
        const asset = path.resolve(root, 'public', src.slice(1)), base = path.resolve(root, 'public/releases', expected);
        if (!asset.startsWith(base + path.sep) || !fs.existsSync(asset) || !fs.statSync(asset).isFile()) throw new Error(`Missing release image: ${src}`);
    }
    return release;
}
export function loadReleases(root = ROOT) {
    const directory = path.join(root, 'releases');
    const entries = fs.readdirSync(directory).filter(name => /^\d+\.\d+\.\d+\.json$/.test(name)).map(name => validateRelease(root, readJSON(root, `releases/${name}`), name.slice(0, -5)));
    return entries.sort((a, b) => { const aa = versionParts(a.version), bb = versionParts(b.version); return bb[0] - aa[0] || bb[1] - aa[1] || bb[2] - aa[2]; });
}
export function requirePublishable(release) {
    if (release.status === 'draft' || release.sample !== false || !release.date) throw new Error('Review the release notes: set sample=false, status=ready and a release date before tagging.');
    return release;
}
export function generatedCatalog(root = ROOT) {
    const current = checkVersions(root), releases = loadReleases(root);
    if (!releases.some(entry => entry.version === current)) throw new Error(`Missing releases/${current}.json. Run npm run release:notes.`);
    return '// Generated by npm run release:generate. Edit releases/*.json, not this file.\nimport type { Release } from "../release-types";\nexport const releases: Release[] = ' + JSON.stringify(releases, null, 2) + ';\nexport const currentRelease = releases.find(release => release.version === ' + JSON.stringify(current) + ')!;\n';
}
export function markdown(release) {
    return `# OrionMail ${release.version} — ${release.title}\n\n${release.summary}\n\n` + release.sections.map(section => `## ${section.category}\n\n` + section.items.map(item => `- **${item.title}:** ${item.text}`).join('\n')).join('\n\n') + '\n';
}

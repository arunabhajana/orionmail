import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { ROOT, checkVersions, bumpPlan, writeBatch, loadReleases, generatedCatalog, sameGeneratedContent, markdown, requirePublishable } from './release/lib.mjs';
const [command, ...args] = process.argv.slice(2);
const dry = args.includes('--dry-run');
function run(bin, argv) {
    console.log(`\n> ${bin} ${argv.join(' ')}`);
    const result = spawnSync(bin, argv, { cwd: ROOT, stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${bin} failed (${result.status ?? result.signal}).`);
}
function npm(script) {
    const executable = process.env.npm_execpath;
    if (!executable) throw new Error('Run this command through npm run.');
    run(process.execPath, [executable, 'run', script]);
}
function git(...argv) { return execFileSync('git', ['-c', `safe.directory=${ROOT}`, ...argv], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function currentRelease(ready = false) {
    const version = checkVersions();
    const release = loadReleases().find(entry => entry.version === version);
    if (!release) throw new Error(`Missing releases/${version}.json.`);
    if (ready) requirePublishable(release);
    return release;
}
function generate(check = false) {
    const target = 'lib/generated/releases.ts', content = generatedCatalog();
    if (check) { if (!fs.existsSync(path.join(ROOT, target)) || !sameGeneratedContent(fs.readFileSync(path.join(ROOT, target), 'utf8'), content)) throw new Error('Release catalog is stale. Run npm run release:generate and commit it.'); }
    else writeBatch(ROOT, new Map([[target, content]]));
}
function requireReleaseGit(version, remoteCheck) {
    if (git('branch', '--show-current') !== 'master') throw new Error('Prepare releases from master after the PR is merged.');
    if (git('status', '--porcelain')) throw new Error('Commit or stash changes, including release notes, before preparing a release.');
    const head = git('rev-parse', 'HEAD');
    let upstream;
    try { upstream = git('rev-parse', 'refs/remotes/origin/master'); } catch { throw new Error('Fetch origin/master before preparing a release.'); }
    if (head !== upstream) throw new Error('HEAD must match origin/master. Fetch and fast-forward master first.');
    const tag = `v${version}`;
    if (git('tag', '--list', tag)) throw new Error(`${tag} already exists locally.`);
    if (remoteCheck) {
        if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`)) throw new Error(`${tag} already exists on origin.`);
        if (git('ls-remote', 'origin', 'refs/heads/master').split(/\s/)[0] !== head) throw new Error('origin/master changed; fetch and update master.');
    }
    return { head, tag };
}
function doctor(release = false) {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 24 || major >= 27) throw new Error('Use Node 24–26; .node-version records the tested runtime.');
    for (const [bin, argv] of [['git', ['--version']], ['rustc', ['--version']], ['cargo', ['--version']]]) run(bin, argv);
    if (process.platform !== 'win32') console.log('Windows native/install checks must run on Windows with MSVC, Windows SDK and WebView2.');
    if (release) {
        const envFile = path.join(ROOT, 'src-tauri/.env');
        const contents = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
        for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
            if (!process.env[name] && !new RegExp(`^\\s*${name}\\s*=\\s*\\S+`, 'm').test(contents)) throw new Error(`Production sign-in configuration is missing ${name}. Values are never printed.`);
        }
    }
    console.log(`Doctor passed. Node ${process.versions.node}; version ${checkVersions()}.`);
}
try {
    const options = { bump: ['--dry-run'], versions: [], notes: ['--dry-run'], generate: ['--check'], 'release-check': ['--ready'], render: ['--dry-run'], prepare: ['--dry-run'], push: ['--dry-run'], doctor: ['--release'] };
    for (const arg of args) {
        if (arg.startsWith('--') && !options[command]?.includes(arg)) throw new Error(`Unknown option: ${arg}`);
        if (!arg.startsWith('--') && command !== 'bump') throw new Error(`Unexpected argument: ${arg}`);
    }
    if (command === 'bump' && args.filter(arg => !arg.startsWith('--')).length > 1) throw new Error('Supply only one version or bump type.');
    switch (command) {
        case 'bump': {
            const plan = bumpPlan(ROOT, args.find(arg => !arg.startsWith('--')) || 'patch');
            console.log(`${plan.current} → ${plan.next}\n${[...plan.updates.keys()].join('\n')}`);
            if (!dry) writeBatch(ROOT, plan.updates);
            console.log(dry ? 'Dry run: no files changed.' : 'Version updated. Next: npm run release:notes, then edit the new release file.');
            break;
        }
        case 'versions': console.log(`All version files match ${checkVersions()}.`); break;
        case 'notes': {
            const version = checkVersions(), target = `releases/${version}.json`;
            if (fs.existsSync(path.join(ROOT, target))) { console.log(`${target} already exists; nothing overwritten.`); break; }
            const release = { schemaVersion: 1, version, status: 'draft', sample: true, date: null, title: 'TODO: release headline', summary: 'TODO: summarize this release.', sections: [{ category: 'Added', items: [{ title: 'TODO: feature name', text: 'TODO: describe the user-facing change.' }] }], whatsNew: [{ id: 'overview', eyebrow: 'New in OrionMail', title: 'TODO: feature headline', text: 'TODO: describe the feature.', image: { src: `/releases/${version}/overview.svg`, alt: 'TODO: describe the illustration.' } }] };
            const image = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320"><rect width="640" height="320" rx="24" fill="#191c24"/><text x="320" y="160" text-anchor="middle" fill="#a8acb8" font-family="sans-serif">Replace with a release illustration</text></svg>\n';
            if (!dry) writeBatch(ROOT, new Map([[target, JSON.stringify(release, null, 2) + '\n'], [`public/releases/${version}/overview.svg`, image]]));
            console.log(`${dry ? 'Would create' : 'Created'} ${target}. Replace TODO text and artwork before validation.`); break;
        }
        case 'generate': generate(args.includes('--check')); console.log('Release catalog is current.'); break;
        case 'release-check': {
            const release = currentRelease(args.includes('--ready')); generate(true);
            console.log(`Release ${release.version} validated (${release.status}${release.sample ? ', sample' : ''}).`); break;
        }
        case 'render': {
            const release = currentRelease(); const target = `.release-output/${release.version}.md`;
            if (!dry) writeBatch(ROOT, new Map([[target, markdown(release)]])); console.log(target); break;
        }
        case 'prepare': {
            const release = currentRelease(true); generate(true);
            const { head, tag } = requireReleaseGit(release.version, !dry);
            if (dry) { console.log(`Would run check:all and create annotated ${tag} at ${head}. No checks, tags or pushes performed.`); break; }
            npm('check:all');
            const after = requireReleaseGit(release.version, true);
            if (after.head !== head) throw new Error('HEAD changed during validation.');
            git('tag', '-a', tag, '-m', `OrionMail ${release.version}\n\n${release.title}`);
            console.log(`Created local ${tag}. Review it, then run npm run release:push.`); break;
        }
        case 'push': {
            const release = currentRelease(true), tag = `v${release.version}`;
            generate(true);
            if (git('status', '--porcelain')) throw new Error('The worktree must be clean.');
            if (git('branch', '--show-current') !== 'master' || git('rev-parse', `${tag}^{commit}`) !== git('rev-parse', 'HEAD')) throw new Error('The release tag must point at the current master commit.');
            if (git('cat-file', '-t', `refs/tags/${tag}`) !== 'tag') throw new Error('Release tags must be annotated.');
            if (git('ls-remote', 'origin', 'refs/heads/master').split(/\s/)[0] !== git('rev-parse', 'HEAD')) throw new Error('Update master from origin before pushing the tag.');
            if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) throw new Error('Remote tag already exists; it will not be overwritten.');
            if (!dry) run('git', ['-c', `safe.directory=${ROOT}`, 'push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`]);
            console.log(dry ? `Would push only ${tag}.` : `Pushed ${tag}. No CI publishing is configured yet.`); break;
        }
        case 'doctor': doctor(args.includes('--release')); break;
        default: throw new Error('Unknown release command. Use the documented npm scripts.');
    }
} catch (error) { console.error(`Release tooling: ${error.message}`); process.exitCode = 1; }

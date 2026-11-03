import {execFileSync} from 'node:child_process';

export function validateReleaseTag(root, tag, {refresh = false} = {}) {
    if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid release tag.');
    const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root}`, ...args], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    // checkout can fetch the event's commit SHA into refs/tags/<tag>, losing
    // the annotation locally. Restore the actual remote tag before inspecting it.
    if (refresh) git('fetch', '--no-tags', 'origin', `+refs/tags/${tag}:refs/tags/${tag}`);
    if (git('cat-file', '-t', `refs/tags/${tag}`) !== 'tag') {
        throw new Error('Use an annotated release tag.');
    }
    if (git('rev-parse', `refs/tags/${tag}^{commit}`) !== git('rev-parse', 'HEAD')) {
        throw new Error('Release tag does not point at the checked-out commit.');
    }
}

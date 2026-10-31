// Checks GitHub on startup and keeps the app up to date.
//
//  - If the app was installed with git (recommended), it syncs to the latest
//    version on its branch and relaunches — fully automatic.
//  - If it was unzipped (no git), it can't safely replace its own files, so it
//    just tells you a new version is out and where to get it.
//
// It only updates when the version in package.json on GitHub is HIGHER than the
// local one, so day-to-day commits don't trigger a restart.

const { execFile } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

function sh(cmd, args, { cwd, timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '').trim() });
    });
  });
}

// true if a.b.c is strictly greater than the other.
function isNewer(remote, local) {
  const pa = String(remote).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(local).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function parseRepo(repository) {
  // Accepts "github:owner/repo", "owner/repo", or a full github URL.
  const s = typeof repository === 'string' ? repository : (repository && repository.url) || '';
  const m = s.match(/(?:github[:.]com[/:]|^github:|^)([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function httpsText(url, { timeout = 7000, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'TrollRemote-Updater' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return httpsText(res.headers.location, { timeout, redirects: redirects - 1 }).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve(data));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function isGitClone(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return false;
  return (await sh('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, timeout: 6000 })).ok;
}

async function gitBranch(root) {
  const r = await sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeout: 6000 });
  return r.ok && r.out && r.out !== 'HEAD' ? r.out : null;
}

async function gitRevParse(root, ref) {
  const r = await sh('git', ['rev-parse', ref], { cwd: root, timeout: 8000 });
  return r.ok ? r.out : null;
}

// Version string from a branch's package.json on the remote (for the "updated
// to vX" message only; the actual trigger is a commit difference).
async function gitRemoteVersion(root, branch) {
  const show = await sh('git', ['show', `origin/${branch}:package.json`], { cwd: root, timeout: 8000 });
  if (!show.ok) return null;
  try { return JSON.parse(show.out).version; } catch { return null; }
}

async function applyGitUpdate(root, branch) {
  // Force the tracked files to match the remote branch. Untracked files
  // (media/, firebase-config.js if ignored, node_modules/) are left alone.
  const reset = await sh('git', ['reset', '--hard', `origin/${branch}`], { cwd: root, timeout: 20000 });
  if (!reset.ok) return false;
  await sh(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: root, timeout: 240000 });
  return true;
}

// Returns one of:
//   { updated: true, version }      -> files changed, caller should relaunch
//   { available: true, version }    -> newer exists but we didn't apply it
//   { upToDate: true }
//   { skipped: reason }
async function check({ root, localVersion, pkg, apply = true }) {
  try {
    if (await isGitClone(root)) {
      // Git installs sync to the latest commit on their branch, so EVERY push
      // is picked up on the next start — no version bump needed.
      const branch = (await gitBranch(root)) || pkg.updateBranch;
      if (!branch) return { skipped: 'no-branch' };
      const fetched = await sh('git', ['fetch', '--quiet', 'origin', branch], { cwd: root, timeout: 25000 });
      if (!fetched.ok) return { skipped: 'fetch-failed' };
      const local = await gitRevParse(root, 'HEAD');
      const remote = await gitRevParse(root, `origin/${branch}`);
      if (!remote) return { skipped: 'no-remote' };
      if (local === remote) return { upToDate: true };            // already current
      // Behind or diverged -> force-sync to GitHub.
      const version = (await gitRemoteVersion(root, branch)) || remote.slice(0, 7);
      if (!apply) return { available: true, version, mode: 'git' };
      const ok = await applyGitUpdate(root, branch);
      return ok ? { updated: true, version } : { skipped: 'git-apply-failed' };
    }

    // No git: can only check + notify (can't safely self-replace a ZIP install).
    const info = parseRepo(pkg.repository);
    const branch = pkg.updateBranch;
    if (!info || !branch) return { skipped: 'no-repo-info' };
    const raw = `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${branch}/package.json`;
    const remote = JSON.parse(await httpsText(raw)).version;
    if (isNewer(remote, localVersion)) return { available: true, version: remote, mode: 'zip' };
    return { upToDate: true, version: remote };
  } catch (e) {
    return { skipped: e.message };
  }
}

module.exports = { check, isNewer, parseRepo };

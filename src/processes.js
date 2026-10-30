// Lists the apps your friend has open (the ones with a window) and lets the
// iPad close one. This only ever touches normal apps you pick from a list:
// a denylist keeps the operating system's own critical processes out of the
// list entirely, and refuses to close them even if asked, so you can't break
// the PC.

const { execFile } = require('child_process');

// Never show or close these, on any platform. Killing them can crash or
// corrupt the PC. Names are compared lower-cased, without the extension.
const PROTECTED = new Set([
  // Windows core
  'system', 'registry', 'idle', 'smss', 'csrss', 'wininit', 'winlogon',
  'services', 'lsass', 'svchost', 'dwm', 'explorer', 'fontdrvhost', 'sihost',
  'ctfmon', 'taskhostw', 'taskhost', 'searchhost', 'searchindexer', 'searchapp',
  'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost', 'systemsettings',
  'dllhost', 'conhost', 'runtimebroker', 'audiodg', 'spoolsv', 'lsaiso', 'wudfhost',
  'applicationframehost', 'widgets', 'widgetservice', 'securityhealthsystray',
  'useroobebroker', 'lockapp', 'logonui', 'csrss', 'winstore.app',
  // macOS core
  'windowserver', 'finder', 'dock', 'systemuiserver', 'loginwindow',
  'controlcenter', 'notificationcenter', 'spotlight', 'coreaudiod', 'launchd',
  // Linux core
  'systemd', 'init', 'xorg', 'xwayland', 'gnome-shell', 'kwin', 'kwin_x11',
  'kwin_wayland', 'plasmashell', 'wayland', 'pipewire', 'pulseaudio', 'dbus-daemon',
]);

// Also never close our own app.
const SELF = new Set(['troll remote', 'electron', 'troll-app']);

let lastError = '';

function isProtected(name) {
  const n = String(name || '').toLowerCase().replace(/\.(exe|app)$/, '').trim();
  return !n || PROTECTED.has(n) || SELF.has(n);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 12000, ...opts }, (err, stdout) => {
      resolve({ out: stdout ? String(stdout) : '', err });
    });
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- listing

async function listWindows() {
  if (process.platform === 'win32') return listWindows_win();
  if (process.platform === 'darwin') return listWindows_mac();
  return listWindows_linux();
}

async function listWindows_win() {
  // Preferred: PowerShell. MainWindowHandle catches windows whose title is
  // momentarily empty (some games), which MainWindowTitle misses.
  const ps = 'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ' +
    'Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress';
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps];
  let r = await run('powershell.exe', args);
  if (!r.out) r = await run('powershell', args);      // some PATHs lack the .exe alias
  if (!r.out) r = await run('pwsh', args);            // PowerShell 7
  const parsed = r.out && tryJson(r.out);
  if (parsed) return parsed.map((p) => ({ pid: p.Id, name: p.ProcessName, title: p.MainWindowTitle || p.ProcessName }));

  // Fallback: tasklist, keeping only rows that actually have a window title.
  const t = await run('tasklist', ['/v', '/fo', 'csv', '/nh']);
  if (t.out) {
    const rows = parseCsv(t.out).map((c) => ({
      name: (c[0] || '').replace(/\.exe$/i, ''),
      pid: parseInt(c[1], 10),
      title: (c[c.length - 1] || '').trim(),
    })).filter((p) => p.pid && p.title && p.title !== 'N/A');
    if (rows.length) return rows;
  }

  lastError = 'Could not read the app list. Windows may be blocking PowerShell/tasklist.';
  return [];
}

function tryJson(s) {
  try {
    let d = JSON.parse(s);
    if (!Array.isArray(d)) d = [d];
    return d;
  } catch { return null; }
}

// Minimal CSV parser for tasklist's quoted output.
function parseCsv(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const cells = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}

async function listWindows_mac() {
  const script = 'tell application "System Events" to get the name of (every process whose background only is false)';
  const r = await run('osascript', ['-e', script]);
  const names = r.out.split(',').map((s) => s.trim()).filter(Boolean);
  const list = [];
  for (const name of names) {
    const p = await run('pgrep', ['-x', name]);
    const pid = parseInt(p.out.split('\n')[0], 10);
    if (pid) list.push({ pid, name, title: name });
  }
  return list;
}

async function listWindows_linux() {
  const w = await run('wmctrl', ['-lp']);
  if (w.out) {
    const seen = new Set();
    const list = [];
    for (const line of w.out.split('\n')) {
      const m = line.match(/^0x[0-9a-f]+\s+\S+\s+(\d+)\s+\S+\s+(.*)$/i);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      const name = (await run('ps', ['-p', String(pid), '-o', 'comm='])).out.trim() || 'app';
      list.push({ pid, name, title: m[2].trim() || name });
    }
    if (list.length) return list;
  }
  const r = await run('ps', ['-u', String(process.getuid ? process.getuid() : ''), '-o', 'pid=,comm=,%mem=', '--sort=-%mem']);
  return r.out.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40).map((l) => {
    const [pid, name] = l.split(/\s+/);
    return { pid: parseInt(pid, 10), name, title: name };
  }).filter((p) => p.pid);
}

async function listApps() {
  lastError = '';
  let list = [];
  try { list = await listWindows(); } catch (e) { lastError = 'Could not read the app list: ' + e.message; }
  const byPid = new Map();
  for (const p of list) {
    if (!p.pid || isProtected(p.name) || p.pid === process.pid) continue;
    if (!byPid.has(p.pid)) byPid.set(p.pid, { pid: p.pid, name: p.name, title: p.title || p.name });
  }
  return [...byPid.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- closing

// Confirm the pid really is one of the user-facing apps before touching it,
// so a stale or hand-crafted pid can't be used to hit something protected.
async function closeApp(pid) {
  pid = parseInt(pid, 10);
  if (!pid || pid === process.pid) return { ok: false, error: 'No such app.' };
  const apps = await listApps();
  const target = apps.find((a) => a.pid === pid);
  if (!target) return { ok: false, error: 'That app is not open any more.' };

  const stillOpen = async () => (await listApps()).some((a) => a.pid === pid);

  if (process.platform === 'win32') {
    // Ask politely first (closes the window like clicking X), then force it if
    // the app ignored that — games often do. /T also gets child windows.
    await run('taskkill', ['/PID', String(pid), '/T']);
    await delay(1200);
    if (await stillOpen()) await run('taskkill', ['/PID', String(pid), '/T', '/F']);
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    await delay(1200);
    if (await stillOpen()) { try { process.kill(pid, 'SIGKILL'); } catch { /* */ } }
  }

  const gone = !(await stillOpen());
  return gone ? { ok: true, name: target.name } : { ok: false, name: target.name, error: `Couldn't close ${target.name}.` };
}

module.exports = { listApps, closeApp, isProtected, getLastError: () => lastError };

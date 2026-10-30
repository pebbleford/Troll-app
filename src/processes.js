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
  'ctfmon', 'taskhostw', 'searchhost', 'searchindexer', 'startmenuexperiencehost',
  'shellexperiencehost', 'textinputhost', 'systemsettings', 'dllhost', 'conhost',
  'runtimebroker', 'audiodg', 'spoolsv', 'lsaiso', 'wudfhost', 'applicationframehost',
  'widgets', 'widgetservice', 'securityhealthsystray', 'useroobebroker',
  // macOS core
  'windowserver', 'finder', 'dock', 'systemuiserver', 'loginwindow',
  'controlcenter', 'notificationcenter', 'spotlight', 'coreaudiod', 'launchd',
  // Linux core
  'systemd', 'init', 'xorg', 'xwayland', 'gnome-shell', 'kwin', 'kwin_x11',
  'kwin_wayland', 'plasmashell', 'wayland', 'pipewire', 'pulseaudio', 'dbus-daemon',
]);

// Also never close our own app.
const SELF = new Set(['troll remote', 'electron', 'troll-app']);

function isProtected(name) {
  const n = String(name || '').toLowerCase().replace(/\.(exe|app)$/, '').trim();
  return !n || PROTECTED.has(n) || SELF.has(n);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 8000, ...opts }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

// ---------------------------------------------------------------- listing

async function listWindows() {
  if (process.platform === 'win32') return listWindows_win();
  if (process.platform === 'darwin') return listWindows_mac();
  return listWindows_linux();
}

async function listWindows_win() {
  // Only processes that own a visible main window — i.e. real apps, not
  // background services. Output is JSON so there's nothing to parse by hand.
  const ps = 'Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | ' +
    'Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress';
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  let data;
  try { data = JSON.parse(out); } catch { return []; }
  if (!Array.isArray(data)) data = [data];
  return data.map((p) => ({ pid: p.Id, name: p.ProcessName, title: p.MainWindowTitle }));
}

async function listWindows_mac() {
  // AppleScript: visible, non-background apps (the ones in the app switcher).
  const script = 'tell application "System Events" to get the name of (every process whose background only is false)';
  const out = await run('osascript', ['-e', script]);
  const names = out.split(',').map((s) => s.trim()).filter(Boolean);
  const list = [];
  for (const name of names) {
    const pidOut = await run('pgrep', ['-x', name]);
    const pid = parseInt(pidOut.split('\n')[0], 10);
    if (pid) list.push({ pid, name, title: name });
  }
  return list;
}

async function listWindows_linux() {
  // Prefer wmctrl (one row per real window). Fall back to a conservative
  // process list so the feature still does something on a plain box.
  const w = await run('wmctrl', ['-lp']);
  if (w) {
    const seen = new Set();
    const list = [];
    for (const line of w.split('\n')) {
      const m = line.match(/^0x[0-9a-f]+\s+\S+\s+(\d+)\s+\S+\s+(.*)$/i);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      const name = (await run('ps', ['-p', String(pid), '-o', 'comm='])).trim() || 'app';
      list.push({ pid, name, title: m[2].trim() || name });
    }
    if (list.length) return list;
  }
  // Fallback: this user's processes that aren't kernel threads, heaviest first.
  const out = await run('ps', ['-u', String(process.getuid ? process.getuid() : ''), '-o', 'pid=,comm=,%mem=', '--sort=-%mem']);
  return out.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40).map((l) => {
    const [pid, name] = l.split(/\s+/);
    return { pid: parseInt(pid, 10), name, title: name };
  }).filter((p) => p.pid);
}

async function listApps() {
  const list = await listWindows();
  const byPid = new Map();
  for (const p of list) {
    if (!p.pid || isProtected(p.name) || p.pid === process.pid) continue;
    // One row per app; keep the first window title we saw for it.
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

  if (process.platform === 'win32') {
    // No /F: this asks the window to close politely (like clicking the X),
    // which is what sells the prank. /T also closes its child windows.
    await run('taskkill', ['/PID', String(pid), '/T']);
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  return { ok: true, name: target.name };
}

module.exports = { listApps, closeApp, isProtected };

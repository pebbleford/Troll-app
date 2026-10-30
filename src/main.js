// Electron entry point. Runs on the PC that your friend is using.
//
//  - An invisible, click-through, always-on-top overlay window plays the
//    sounds and shows the scares on top of whatever game is running.
//  - A small "setup" panel shows the QR code, address and sign-in for the iPad.
//  - A web server on your Wi-Fi serves the remote control to the iPad (LAN).
//  - Optionally, when you add a Firebase project, the panel window also relays
//    commands through the cloud so the iPad works from anywhere (see cloud.js).

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, shell, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const QRCode = require('qrcode');
const { startServer, mediaKind } = require('./server');
const { createDirector } = require('./director');
const processes = require('./processes');

// Let the overlay play sound without anyone clicking on it first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MEDIA_DIR = path.join(ROOT, 'media');
const ICON_PATH = path.join(ROOT, 'assets', 'icon.png');
const FIREBASE_CONFIG = path.join(ROOT, 'firebase-config.js');
const DEFAULT_PORT = Number(process.env.TROLL_PORT) || 4545;

const SHORTCUT_PANEL = 'CommandOrControl+Alt+Shift+T';
const SHORTCUT_PANIC = 'CommandOrControl+Alt+Shift+X';

const FX_IDS = new Set([
  // visuals
  'jumpscare', 'flashbang', 'crash', 'crack', 'spiders', 'ghost', 'eyes', 'blackout', 'flicker',
  'glitch', 'emojiRain', 'message',
  // sounds
  'scream', 'airhorn', 'fart', 'knock', 'footsteps', 'whispers', 'mosquito', 'heartbeat', 'phone',
  'doorbell', 'ding', 'siren', 'explosion', 'drone', 'static', 'glass',
  // other
  'say', 'media',
]);

let overlay = null;
let panel = null;
let tray = null;
let server = null;
let director = null;
let config = null;
let clientCount = 0;
let quitting = false;
let balloonShown = false;

// ---------------------------------------------------------------- config

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { /* first run */ }
  if (!/^[A-Z2-9]{6}$/.test(cfg.code || '')) {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    cfg.code = Array.from(crypto.randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
  }
  return cfg;
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Could not save config:', err.message);
  }
}

// ---------------------------------------------------------------- start on login

function applyAutoLaunch() {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!config.openAtLogin,
      openAsHidden: true,
      args: ['--hidden'],
    });
  } catch (err) {
    console.error('Could not change the start-on-login setting:', err.message);
  }
}

// First launch only: ask whether to start with the PC. In dev we skip it.
function maybeAskAutoLaunch() {
  if (config.openAtLogin !== undefined || !app.isPackaged) return;
  const { response } = dialogSyncSafe({
    type: 'question',
    buttons: ['Yes, start automatically', 'No thanks'],
    defaultId: 0,
    cancelId: 1,
    title: 'Troll Remote',
    message: 'Start Troll Remote when this PC turns on?',
    detail: 'Recommended, so it is already running and ready before your friend sits down. It starts hidden in the system tray (bottom-right). You can change this later in the Troll Remote window.',
  });
  config.openAtLogin = response === 0;
  saveConfig();
  applyAutoLaunch();
}

function dialogSyncSafe(opts) {
  try { return { response: dialog.showMessageBoxSync(panel || undefined, opts) }; }
  catch { return { response: 1 }; }
}

// ---------------------------------------------------------------- network

function lanAddresses() {
  const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|vbox|br-|veth|utun|tailscale|zerotier|loopback|bluetooth/i;
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out.sort((a, b) => (virtual.test(a.name) - virtual.test(b.name)) || (rank(a.address) - rank(b.address)));
}

function cloudConfigured() {
  try {
    const t = fs.readFileSync(FIREBASE_CONFIG, 'utf8');
    return /apiKey/.test(t) && !/YOUR_API_KEY|REPLACE_ME|xxxxxxxx/i.test(t);
  } catch { return false; }
}

async function connectionInfo() {
  const addrs = lanAddresses();
  const urls = addrs.map((a) => ({ ...a, url: `http://${a.address}:${server.port}/?code=${config.code}` }));
  const main = urls[0] ? urls[0].url : `http://localhost:${server.port}/?code=${config.code}`;
  const qr = await QRCode.toDataURL(main, { margin: 1, width: 260, color: { dark: '#111111', light: '#ffffff' } });
  return {
    code: config.code,
    port: server.port,
    url: main,
    urls,
    qr,
    clients: clientCount,
    openAtLogin: !!config.openAtLogin,
    cloudConfigured: cloudConfigured(),
    pcName: os.hostname(),
    shortcuts: { panel: SHORTCUT_PANEL, panic: SHORTCUT_PANIC },
    platform: process.platform,
  };
}

// LAN presence the signed-in iPad uses to find this PC on the local network.
function lanPresence() {
  return {
    pcName: os.hostname(),
    port: server ? server.port : DEFAULT_PORT,
    code: config.code,
    urls: lanAddresses().map((a) => `http://${a.address}:${server ? server.port : DEFAULT_PORT}`),
  };
}

// ---------------------------------------------------------------- windows

function targetDisplay() {
  const displays = screen.getAllDisplays();
  return displays.find((d) => d.id === config.displayId) || screen.getPrimaryDisplay();
}

function createOverlay() {
  const { bounds } = targetDisplay();
  overlay = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadFile(path.join(__dirname, 'overlay', 'overlay.html'));
  overlay.webContents.on('did-finish-load', () => {
    overlay.webContents.send('fx', { id: 'volume', value: director.state().volume });
  });
  overlay.on('closed', () => { overlay = null; });
}

function fitOverlay() {
  if (!overlay) return;
  overlay.setBounds(targetDisplay().bounds);
}

function showOverlay(visible) {
  if (!overlay) return;
  if (visible) {
    fitOverlay();
    // Games like to grab the top spot; take it back every time we scare.
    overlay.setAlwaysOnTop(true, 'screen-saver');
    if (!overlay.isVisible()) overlay.showInactive();
    overlay.moveTop();
  } else if (overlay.isVisible()) {
    overlay.hide();
  }
}

function createPanel() {
  panel = new BrowserWindow({
    width: 460,
    height: 760,
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Troll Remote',
    icon: ICON_PATH,
    backgroundColor: '#0f0f14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-panel.js'),
      // The panel renderer also runs the optional Firebase cloud relay, so it
      // must keep working while hidden in the tray.
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  panel.setMenu(null);
  panel.loadFile(path.join(__dirname, 'panel', 'panel.html'));
  // Closing or minimizing the panel just tucks it into the tray; the app
  // keeps running so the iPad stays connected.
  panel.on('close', (e) => {
    if (!quitting) { e.preventDefault(); hideToTray(); }
  });
  panel.on('minimize', (e) => { e.preventDefault(); hideToTray(); });
}

function hideToTray() {
  if (panel) panel.hide();
  if (balloonShown) return;
  balloonShown = true;
  if (process.platform === 'win32' && tray) {
    tray.displayBalloon({ icon: ICON_PATH, title: 'Still running down here 👇', content: 'Troll Remote is hidden in the tray. Click its icon to open it again.' });
  } else if (Notification.isSupported()) {
    new Notification({ title: 'Troll Remote is still running', body: 'Find it in the menu bar / tray. Click to open it again.' }).show();
  }
}

function togglePanel(force) {
  if (!panel) return;
  const show = force ?? !panel.isVisible();
  if (show) { panel.show(); panel.focus(); } else panel.hide();
}

function sendPanelStatus() {
  if (panel && !panel.isDestroyed()) {
    panel.webContents.send('panel:status', { clients: clientCount, ...director.state() });
  }
}

// ---------------------------------------------------------------- tray

function buildTrayMenu() {
  const displays = screen.getAllDisplays();
  const current = targetDisplay().id;
  return Menu.buildFromTemplate([
    { label: 'Open Troll Remote', click: () => togglePanel(true) },
    { type: 'separator' },
    { label: 'Test jumpscare', click: () => director.trigger({ id: 'jumpscare' }, 0) },
    { label: 'Stop everything', click: () => director.stopAll() },
    {
      label: 'Show scares on screen',
      submenu: displays.map((d, i) => ({
        label: `Screen ${i + 1} (${d.size.width}x${d.size.height})${d.id === screen.getPrimaryDisplay().id ? ' - main' : ''}`,
        type: 'radio',
        checked: d.id === current,
        click: () => { config.displayId = d.id; saveConfig(); fitOverlay(); },
      })),
    },
    {
      label: 'Start when PC turns on',
      type: 'checkbox',
      checked: !!config.openAtLogin,
      click: (item) => { config.openAtLogin = item.checked; saveConfig(); applyAutoLaunch(); },
    },
    { label: 'Open media folder', click: () => shell.openPath(MEDIA_DIR) },
    { type: 'separator' },
    { label: 'Quit Troll Remote', click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  let img = nativeImage.createFromPath(ICON_PATH);
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Troll Remote');
  refreshTray();
  tray.on('click', () => togglePanel(true));
  tray.on('double-click', () => togglePanel(true));
  screen.on('display-added', refreshTray);
  screen.on('display-removed', () => { refreshTray(); fitOverlay(); });
  screen.on('display-metrics-changed', fitOverlay);
}

// ---------------------------------------------------------------- text to speech fallback

function speakNative(text, rate) {
  text = String(text).slice(0, 300);
  if (process.platform === 'win32') {
    // Text goes in through an env var so nothing in it can be run as code.
    const script = 'Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
      '$s.Volume = 100; $s.Rate = [int]$env:TROLL_RATE; $s.Speak($env:TROLL_TEXT)';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      env: { ...process.env, TROLL_TEXT: text, TROLL_RATE: String(Math.round((rate - 1) * 5)) },
    }, () => {});
  } else if (process.platform === 'darwin') {
    execFile('say', ['-r', String(Math.round(180 * rate)), text], () => {});
  } else {
    execFile('espeak', ['-s', String(Math.round(160 * rate)), text], (err) => {
      if (err) execFile('spd-say', [text], () => {});
    });
  }
}

// ---------------------------------------------------------------- remote control messages

function cleanFx(fx) {
  if (!fx || !FX_IDS.has(fx.id)) return null;
  const out = { id: fx.id };
  if (typeof fx.text === 'string') out.text = fx.text.slice(0, 300);
  if (typeof fx.voice === 'string') out.voice = fx.voice.slice(0, 20);
  if (typeof fx.style === 'string') out.style = fx.style.slice(0, 20);
  if (typeof fx.emoji === 'string') out.emoji = fx.emoji.slice(0, 16);
  if (typeof fx.mode === 'string') out.mode = fx.mode.slice(0, 20);

  if (fx.id === 'media') {
    const name = path.basename(String(fx.name || ''));
    const file = path.join(MEDIA_DIR, name);
    const kind = mediaKind(name);
    if (!kind || !fs.existsSync(file)) return null;
    out.name = name;
    out.kind = kind;
    out.src = pathToFileURL(file).href;
    // A custom image jumpscare can use one of your uploaded sounds instead of
    // the built-in scream.
    if (kind === 'image' && typeof fx.sound === 'string' && fx.sound) {
      const sName = path.basename(fx.sound);
      const sFile = path.join(MEDIA_DIR, sName);
      if (mediaKind(sName) === 'audio' && fs.existsSync(sFile)) out.soundSrc = pathToFileURL(sFile).href;
    }
  }
  return out;
}

// `reply` sends a message back to whichever remote asked (LAN socket or cloud).
async function handleMessage(msg, reply) {
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'hello':
      reply({ type: 'hello', pcName: os.hostname(), state: director.state(), media: server.listMedia() });
      break;
    case 'fx': {
      const fx = cleanFx(msg.fx);
      if (!fx) return reply({ type: 'error', text: 'Unknown effect or missing file.' });
      director.trigger(fx, msg.delay, typeof msg.label === 'string' ? msg.label.slice(0, 40) : fx.id);
      break;
    }
    case 'stop':
      director.stopAll();
      break;
    case 'cancel':
      director.cancelPending(Number.isFinite(msg.id) ? msg.id : null);
      break;
    case 'volume':
      director.setVolume(msg.value);
      break;
    case 'haunt':
      director.setHaunt(msg.on);
      break;
    case 'deleteMedia': {
      const name = path.basename(String(msg.name || ''));
      if (mediaKind(name)) fs.rm(path.join(MEDIA_DIR, name), { force: true }, () => server.broadcastMedia());
      break;
    }
    case 'listApps':
      reply({ type: 'apps', list: await processes.listApps() });
      break;
    case 'closeApp': {
      const res = await processes.closeApp(msg.pid);
      reply({ type: 'closed', ok: res.ok, name: res.name, error: res.error });
      // Give the app a moment to disappear, then send a fresh list.
      setTimeout(async () => reply({ type: 'apps', list: await processes.listApps() }), 600);
      break;
    }
  }
}

// ---------------------------------------------------------------- cloud relay (optional)

// All Firebase I/O happens in the panel renderer (see src/panel/cloud.js). Main
// just forwards commands in and pushes results/state out.
function cloudPush(obj) {
  if (panel && !panel.isDestroyed()) panel.webContents.send('cloud:push', obj);
}

// ---------------------------------------------------------------- app lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => togglePanel(true));

  app.whenReady().then(async () => {
    config = loadConfig();
    saveConfig();
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    if (config.openAtLogin !== undefined) applyAutoLaunch();

    director = createDirector({
      sendToOverlay: (fx) => {
        if (overlay && !overlay.isDestroyed()) overlay.webContents.send('fx', fx);
      },
      onState: (state) => {
        if (server) server.broadcast({ type: 'state', state });
        cloudPush({ type: 'state', state });
        sendPanelStatus();
      },
    });

    try {
      server = await startServer({
        port: config.port || DEFAULT_PORT,
        code: config.code,
        publicDir: PUBLIC_DIR,
        mediaDir: MEDIA_DIR,
        extraStatic: { '/firebase-config.js': FIREBASE_CONFIG },
        onMessage: (msg, ws) => handleMessage(msg, (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj))),
        onMedia: (list) => cloudPush({ type: 'media', list }),
        onClientsChanged: (n) => { clientCount = n; sendPanelStatus(); },
      });
    } catch (err) {
      console.error('Could not start the web server:', err);
      app.quit();
      return;
    }

    ipcMain.on('overlay:visible', (_e, visible) => showOverlay(!!visible));
    ipcMain.on('overlay:speak-native', (_e, { text, rate }) => speakNative(text, Number(rate) || 1));
    ipcMain.handle('panel:info', () => connectionInfo());
    ipcMain.on('panel:hide', () => hideToTray());
    ipcMain.on('panel:test', (_e, id) => director.trigger({ id: FX_IDS.has(id) ? id : 'jumpscare' }, 0));
    ipcMain.on('panel:open-media', () => shell.openPath(MEDIA_DIR));
    ipcMain.on('panel:set-autolaunch', (_e, on) => { config.openAtLogin = !!on; saveConfig(); applyAutoLaunch(); refreshTray(); });
    ipcMain.on('panel:quit', () => app.quit());

    // Bridge between the cloud relay (panel renderer) and the effect engine.
    ipcMain.handle('cloud:lan-presence', () => lanPresence());
    ipcMain.on('cloud:command', (_e, msg) => handleMessage(msg, cloudPush));

    createOverlay();
    createPanel();
    createTray();

    const startHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
    panel.once('ready-to-show', () => { if (!startHidden) panel.show(); else hideToTray(); });

    globalShortcut.register(SHORTCUT_PANEL, () => togglePanel());
    globalShortcut.register(SHORTCUT_PANIC, () => director.stopAll());

    maybeAskAutoLaunch();

    console.log(`Troll Remote running. Open ${(await connectionInfo()).url} on your iPad.`);
  });

  app.on('before-quit', () => { quitting = true; cloudPush({ type: 'shutdown' }); });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (server) server.close();
  });
  app.on('window-all-closed', () => {});
}

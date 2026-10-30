// Electron entry point. Runs on the PC that your friend is using.
//
//  - An invisible, click-through, always-on-top overlay window plays the
//    sounds and shows the scares on top of whatever game is running.
//  - A small "setup" panel shows the QR code / address for your iPad.
//  - A web server on your Wi-Fi serves the remote control to the iPad.

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const QRCode = require('qrcode');
const { startServer, mediaKind } = require('./server');
const { createDirector } = require('./director');

// Let the overlay play sound without anyone clicking on it first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MEDIA_DIR = path.join(ROOT, 'media');
const ICON_PATH = path.join(ROOT, 'assets', 'icon.png');
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
    shortcuts: { panel: SHORTCUT_PANEL, panic: SHORTCUT_PANIC },
    platform: process.platform,
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
    width: 440,
    height: 720,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Troll Remote',
    icon: ICON_PATH,
    backgroundColor: '#0f0f14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-panel.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  panel.setMenu(null);
  panel.loadFile(path.join(__dirname, 'panel', 'panel.html'));
  // Closing the panel just hides it; the app keeps running in the tray.
  panel.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      panel.hide();
    }
  });
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
    { label: 'Show connection info', click: () => togglePanel(true) },
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
    { label: 'Open media folder', click: () => shell.openPath(MEDIA_DIR) },
    { type: 'separator' },
    { label: 'Quit Troll Remote', click: () => app.quit() },
  ]);
}

function createTray() {
  let img = nativeImage.createFromPath(ICON_PATH);
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Troll Remote');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => togglePanel(true));
  screen.on('display-added', () => tray.setContextMenu(buildTrayMenu()));
  screen.on('display-removed', () => { tray.setContextMenu(buildTrayMenu()); fitOverlay(); });
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
  }
  return out;
}

function handleMessage(msg, ws) {
  const reply = (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
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
  }
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

    director = createDirector({
      sendToOverlay: (fx) => {
        if (overlay && !overlay.isDestroyed()) overlay.webContents.send('fx', fx);
      },
      onState: (state) => {
        if (server) server.broadcast({ type: 'state', state });
        sendPanelStatus();
      },
    });

    try {
      server = await startServer({
        port: config.port || DEFAULT_PORT,
        code: config.code,
        publicDir: PUBLIC_DIR,
        mediaDir: MEDIA_DIR,
        onMessage: handleMessage,
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
    ipcMain.on('panel:hide', () => togglePanel(false));
    ipcMain.on('panel:test', (_e, id) => director.trigger({ id: FX_IDS.has(id) ? id : 'jumpscare' }, 0));
    ipcMain.on('panel:open-media', () => shell.openPath(MEDIA_DIR));
    ipcMain.on('panel:quit', () => app.quit());

    createOverlay();
    createPanel();
    createTray();

    globalShortcut.register(SHORTCUT_PANEL, () => togglePanel());
    globalShortcut.register(SHORTCUT_PANIC, () => director.stopAll());

    console.log(`Troll Remote running. Open ${(await connectionInfo()).url} on your iPad.`);
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (server) server.close();
  });
  // Keep running in the tray when the panel is closed.
  app.on('window-all-closed', () => {});
}

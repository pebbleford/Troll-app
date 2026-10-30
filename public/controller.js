// The iPad remote. Talks to the PC either directly over Wi-Fi (WebSocket) or,
// when you sign in with an account, through Firebase from anywhere.

const SCARES = [
  ['jumpscare', '😱', 'Jumpscare', 'face + scream'],
  ['flashbang', '💥', 'Flashbang', 'white screen + ringing'],
  ['crash', '💀', 'Fake crash', 'blue screen of doom'],
  ['crack', '🔨', 'Crack screen', 'shattered glass'],
  ['spiders', '🕷️', 'Spiders', 'crawling everywhere'],
  ['ghost', '👻', 'Ghost', 'walks past'],
  ['eyes', '👀', 'Eyes', 'in the dark + growl'],
  ['blackout', '🌑', 'Blackout', 'lights flicker off'],
  ['glitch', '📺', 'Glitch', 'TV static'],
];

const SOUNDS = [
  ['scream', '😫', 'Scream'], ['airhorn', '📯', 'Air horn'], ['fart', '💨', 'Fart'],
  ['knock', '🚪', 'Knocking'], ['footsteps', '👣', 'Footsteps'], ['whispers', '🤫', 'Whispers'],
  ['mosquito', '🦟', 'Mosquito'], ['heartbeat', '💓', 'Heartbeat'], ['phone', '📞', 'Phone ring'],
  ['doorbell', '🛎️', 'Doorbell'], ['ding', '💬', 'Notification'], ['siren', '🚨', 'Siren'],
  ['explosion', '💣', 'Explosion'], ['drone', '🌫️', 'Creepy ambience'], ['static', '📻', 'Static'],
  ['glass', '🪟', 'Glass break'],
];

const PHRASES = [
  'Behind you', 'I can see you', 'Turn around', 'Bruh', 'You are so bad at this game',
  'Skill issue', 'Your computer has a virus', 'Ha ha ha ha ha', 'Why are you running', 'Get good',
];

const EMOJIS = ['💩', '🤡', '💀', '🗿', '😂', '🐸', '🕷️', '🔥', '🐀', '👁️'];

const $ = (id) => document.getElementById(id);

let delay = 0;
let voice = 'normal';
let msgStyle = 'creepy';
let pending = [];
let mediaList = [];
let soundMap = {};

// ------------------------------------------------------------ toast

let toastTimer = null;
function toast(text, error) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast' + (error ? ' error' : ''); }, 1700);
}

// ------------------------------------------------------------ transport
// Exactly one transport is "active" at a time (LAN socket OR cloud), so a tap
// never fires twice.

const Net = {
  active: null,      // 'lan' | 'cloud' | null
  ws: null,
  lanBase: null,     // e.g. http://192.168.1.5:4545 — also used for media urls/upload
  code: '',          // LAN auth code
  cloudSubs: [],     // firestore unsubscribers (receivers)
  presSub: null,     // presence watcher
  lastNotice: 0,
  lanAttempt: 0,

  isConnected() { return this.active === 'lan' ? this.ws && this.ws.readyState === 1 : this.active === 'cloud'; },
  canUpload() { return !!this.lanBase; },

  send(obj) {
    if (this.active === 'lan' && this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(obj)); return true; }
    if (this.active === 'cloud') { TrollCloud.sendCommand(obj); return true; }
    toast('Not connected to the PC', true);
    return false;
  },
};

function handleIncoming(msg) {
  switch (msg.type) {
    case 'hello':
      setStatus('ok', `Connected to ${msg.pcName || 'your PC'}`);
      applyState(msg.state || {});
      renderMedia(msg.media || []);
      setSoundMap(msg.soundMap || {});
      break;
    case 'state': applyState(msg.state || {}); break;
    case 'media': renderMedia(msg.list || []); break;
    case 'soundMap': setSoundMap(msg.map || {}); break;
    case 'apps': renderApps(msg.list || [], msg.error); break;
    case 'closed': toast(msg.ok ? `Closed ${msg.name}` : (msg.error || 'Could not close that app'), !msg.ok); break;
    case 'error': toast(msg.text, true); break;
  }
}

function setStatus(state, text) {
  $('status').className = 'status ' + state;
  $('statusText').textContent = text;
}

// ---- LAN (WebSocket) ----

function wsUrlFor(base, code) { return base.replace(/^http/, 'ws') + '/ws?code=' + encodeURIComponent(code); }

// Code mode: page is served by the PC, reconnect forever.
let codeRetry = 0;
let codeWs = null;
function codeConnect(code) {
  Net.code = code;
  Net.lanBase = location.origin;
  if (codeWs) { try { codeWs.onclose = null; codeWs.close(); } catch { /* */ } }
  setStatus('', 'Connecting…');
  const ws = new WebSocket(wsUrlFor(location.origin, code));
  codeWs = ws;
  ws.onopen = () => { codeRetry = 0; Net.active = 'lan'; Net.ws = ws; ws.send(JSON.stringify({ type: 'hello' })); };
  ws.onmessage = (e) => { try { handleIncoming(JSON.parse(e.data)); } catch { /* ignore */ } };
  ws.onclose = (e) => {
    if (codeWs !== ws) return;             // superseded by a newer attempt
    if (Net.ws === ws) Net.ws = null;
    if (e.code === 4001) { setStatus('bad', 'Wrong code'); localStorage.removeItem('trollCode'); return askCode(); }
    setStatus('bad', 'Disconnected – retrying…');
    codeRetry = Math.min(codeRetry + 1, 5);
    setTimeout(() => { if (codeWs === ws) codeConnect(code); }, 500 * codeRetry);
  };
}

// Account mode: try to upgrade from cloud to a direct Wi-Fi socket.
function attemptLan(urls, code) {
  if (Net.active === 'lan') return;
  const myAttempt = ++Net.lanAttempt;
  let settled = false;
  for (const base of urls) {
    let ws;
    try { ws = new WebSocket(wsUrlFor(base, code)); } catch { continue; }
    const timer = setTimeout(() => { try { ws.close(); } catch { /* */ } }, 2500);
    ws.onopen = () => {
      clearTimeout(timer);
      if (settled || myAttempt !== Net.lanAttempt || Net.active === 'lan') { try { ws.close(); } catch { /* */ } return; }
      settled = true;
      switchToLan(ws, base, code);
    };
    ws.onerror = () => clearTimeout(timer);
  }
}

function switchToLan(ws, base, code) {
  stopCloudReceivers();
  Net.active = 'lan';
  Net.ws = ws;
  Net.lanBase = base;
  Net.code = code;
  ws.onmessage = (e) => { try { handleIncoming(JSON.parse(e.data)); } catch { /* ignore */ } };
  ws.onclose = () => {
    if (Net.ws !== ws) return;
    Net.ws = null; Net.active = null; Net.lanBase = null;
    toast('Switched to cloud');
    startCloudReceivers();          // fall back to cloud
  };
  ws.send(JSON.stringify({ type: 'hello' }));
  toast('On direct Wi-Fi ⚡');
}

// ---- cloud (Firestore relay) ----

function startCloudReceivers() {
  if (Net.active === 'lan') return;
  stopCloudReceivers();
  Net.active = 'cloud';
  setStatus('ok', 'Connected via cloud');
  Net.cloudSubs.push(TrollCloud.watchDoc('state', (r) => handleIncoming({ type: 'state', state: r.data })));
  Net.cloudSubs.push(TrollCloud.watchDoc('media', (r) => handleIncoming({ type: 'media', list: r.data })));
  Net.cloudSubs.push(TrollCloud.watchDoc('soundmap', (r) => handleIncoming({ type: 'soundMap', map: r.data })));
  Net.cloudSubs.push(TrollCloud.watchDoc('apps', (r) => handleIncoming({ type: 'apps', list: (r.data && r.data.list) || [], error: r.data && r.data.error })));
  Net.cloudSubs.push(TrollCloud.watchDoc('notice', (r) => {
    if ((r.at || 0) > Net.lastNotice) { Net.lastNotice = r.at || Date.now(); handleIncoming(r.data || {}); }
  }));
  TrollCloud.sendCommand({ type: 'hello' });
}

function stopCloudReceivers() {
  for (const un of Net.cloudSubs) { try { un(); } catch { /* */ } }
  Net.cloudSubs = [];
}

function onPresence(pres, at) {
  const fresh = pres && pres.online && at && Date.now() - at < 70000;
  if (fresh && Array.isArray(pres.urls) && pres.urls.length && pres.code) attemptLan(pres.urls, pres.code);
}

function startAccountMode() {
  hideModal('codeModal'); hideModal('signInModal');
  $('accountRow').hidden = false;
  startCloudReceivers();
  Net.presSub = TrollCloud.watchDoc('presence', (r) => onPresence(r.data, r.at));
}

function stopAccountMode() {
  if (Net.presSub) { try { Net.presSub(); } catch { /* */ } Net.presSub = null; }
  stopCloudReceivers();
  if (Net.ws) { try { Net.ws.close(); } catch { /* */ } }
  Net.active = null; Net.ws = null; Net.lanBase = null;
  $('accountRow').hidden = true;
}

// ------------------------------------------------------------ actions

function delayLabel() {
  if (delay === 'random') return ' at a random time';
  if (!delay) return '';
  return delay >= 60000 ? ` in ${delay / 60000} min` : ` in ${delay / 1000}s`;
}

function fire(fx, label, tile) {
  if (!Net.send({ type: 'fx', fx, delay, label })) return;
  toast(`${label}${delayLabel() || ' ✓'}`);
  if (tile) { tile.classList.remove('fired'); void tile.offsetWidth; tile.classList.add('fired'); }
}

// ------------------------------------------------------------ build buttons

function buildTiles(container, list, kind) {
  for (const [id, icon, name, sub] of list) {
    const b = document.createElement('button');
    b.className = `tile ${kind}`;
    b.dataset.fxId = id;
    b.innerHTML = `<span class="icon">${icon}</span><span>${name}</span>${sub ? `<small>${sub}</small>` : ''}`;
    b.addEventListener('click', () => fire({ id }, name, b));
    container.appendChild(b);
  }
}
buildTiles($('scares'), SCARES, 'scare');
buildTiles($('sounds'), SOUNDS, 'sound');

// Show a little badge on sound buttons that play one of your own files.
function setSoundMap(map) {
  soundMap = map || {};
  for (const tile of document.querySelectorAll('#sounds .tile')) {
    const custom = !!soundMap[tile.dataset.fxId];
    tile.classList.toggle('custom', custom);
    let badge = tile.querySelector('.badge');
    if (custom && !badge) { badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = '🎵 yours'; tile.appendChild(badge); }
    if (!custom && badge) badge.remove();
  }
}

for (const e of EMOJIS) {
  const b = document.createElement('button');
  b.className = 'tile emoji';
  b.textContent = e;
  b.addEventListener('click', () => fire({ id: 'emojiRain', emoji: e }, `${e} rain`, b));
  $('emojis').appendChild(b);
}

for (const p of PHRASES) {
  const b = document.createElement('button');
  b.textContent = p;
  b.addEventListener('click', () => fire({ id: 'say', text: p, voice }, `"${p}"`));
  $('phrases').appendChild(b);
}

function chipGroup(id, onPick) {
  $(id).addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $(id).querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chip));
    onPick(chip);
  });
}
chipGroup('delayChips', (c) => { delay = c.dataset.delay === 'random' ? 'random' : Number(c.dataset.delay); });
chipGroup('voiceChips', (c) => { voice = c.dataset.voice; });
chipGroup('styleChips', (c) => { msgStyle = c.dataset.style; });

$('sayBtn').addEventListener('click', () => {
  const text = $('sayText').value.trim();
  if (!text) return toast('Type something first', true);
  fire({ id: 'say', text, voice }, 'Speech');
});
$('msgBtn').addEventListener('click', () => {
  const text = $('msgText').value.trim() || 'I can see you';
  fire({ id: 'message', text, style: msgStyle }, 'Message');
});
$('stopAll').addEventListener('click', () => { if (Net.send({ type: 'stop' })) toast('Stopped everything'); });

let volTimer = null;
$('volume').addEventListener('input', (e) => {
  $('volumeNum').textContent = `${e.target.value}%`;
  clearTimeout(volTimer);
  volTimer = setTimeout(() => Net.send({ type: 'volume', value: e.target.value / 100 }), 120);
});
$('haunt').addEventListener('change', (e) => {
  if (Net.send({ type: 'haunt', on: e.target.checked })) toast(e.target.checked ? 'Haunt mode on 👻' : 'Haunt mode off');
});

// ------------------------------------------------------------ pending (delayed) effects

function renderPending() {
  const box = $('pending');
  box.innerHTML = '';
  for (const p of pending) {
    const secs = Math.max(0, Math.ceil((p.at - Date.now()) / 1000));
    const b = document.createElement('button');
    b.textContent = `⏱ ${p.label} in ${secs}s  ✕`;
    b.addEventListener('click', () => Net.send({ type: 'cancel', id: p.id }));
    box.appendChild(b);
  }
}
setInterval(() => pending.length && renderPending(), 1000);

function applyState(state) {
  pending = state.pending || [];
  renderPending();
  $('haunt').checked = !!state.haunt;
  if (typeof state.volume === 'number' && document.activeElement !== $('volume')) {
    const v = Math.round(state.volume * 100);
    $('volume').value = v;
    $('volumeNum').textContent = `${v}%`;
  }
}

// ------------------------------------------------------------ media library

const KIND_ICON = { image: '🖼️', audio: '🎵', video: '🎬' };

function mediaUrl(name) {
  if (!Net.lanBase) return '';
  return `${Net.lanBase}/api/media/${encodeURIComponent(name)}?code=${encodeURIComponent(Net.code)}`;
}

function renderMedia(list) {
  mediaList = list;
  const box = $('media');
  box.innerHTML = '';
  for (const m of list) {
    const b = document.createElement('button');
    b.className = 'media-item';
    b.textContent = KIND_ICON[m.kind] || '📄';
    const url = m.kind === 'image' ? mediaUrl(m.name) : '';
    if (url) { const img = document.createElement('img'); img.loading = 'lazy'; img.src = url; b.appendChild(img); }
    const label = document.createElement('span');
    label.textContent = m.name;
    b.appendChild(label);
    b.addEventListener('click', () => openSheet(m));
    box.appendChild(b);
  }
}

function openSheet(m) {
  $('sheetTitle').textContent = m.name;
  const box = $('sheetButtons');
  box.innerHTML = '';
  const add = (text, fn, cls) => {
    const b = document.createElement('button');
    b.className = 'sheet-btn ' + (cls || '');
    b.textContent = text;
    b.addEventListener('click', () => { closeSheet(); fn(); });
    box.appendChild(b);
  };
  const media = (mode, extra) => Object.assign({ id: 'media', name: m.name, mode }, extra);

  if (m.kind === 'image') {
    // Optional: pick one of your uploaded sounds for this jumpscare.
    const sounds = mediaList.filter((x) => x.kind === 'audio');
    let chosenSound = '';
    if (sounds.length) {
      const wrap = document.createElement('div');
      wrap.className = 'sheet-sound';
      wrap.innerHTML = '<label>Jumpscare sound</label>';
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="">Default scream</option>' + sounds.map((s) => `<option value="${encodeURIComponent(s.name)}">${s.name}</option>`).join('');
      sel.addEventListener('change', () => { chosenSound = sel.value ? decodeURIComponent(sel.value) : ''; });
      wrap.appendChild(sel);
      box.appendChild(wrap);
    }
    add('😱 Jumpscare with it', () => fire(media('scare', chosenSound ? { sound: chosenSound } : null), 'Custom jumpscare'));
    add('🖼️ Just show it', () => fire(media('show'), 'Picture'));
  } else if (m.kind === 'video') {
    add('🎬 Play full screen', () => fire(media('play'), 'Video'));
  } else {
    add('🔊 Play sound', () => fire(media('play'), 'Sound'));
    // Assign this real sound to a soundboard button (replaces the built-in one).
    const wrap = document.createElement('div');
    wrap.className = 'sheet-sound';
    wrap.innerHTML = '<label>Use this as a soundboard button</label>';
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">— choose a button —</option>'
      + SOUNDS.map(([id, icon, name]) => `<option value="${id}">${icon} ${name}</option>`).join('')
      + '<option value="jumpscare">😱 Jumpscare scream</option>';
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      Net.send({ type: 'mapSound', id: sel.value, name: m.name });
      toast('Set ✓');
      closeSheet();
    });
    wrap.appendChild(sel);
    box.appendChild(wrap);
  }
  add('🗑️ Delete from PC', () => { if (confirm(`Delete "${m.name}" from the PC?`)) Net.send({ type: 'deleteMedia', name: m.name }); }, 'danger');
  $('sheet').hidden = false;
}

function closeSheet() { $('sheet').hidden = true; }
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet') || e.target.hasAttribute('data-close')) closeSheet(); });

$('upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!Net.canUpload()) return toast('Uploading needs the same Wi-Fi as the PC', true);
  const xhr = new XMLHttpRequest();
  const bar = $('progress');
  bar.hidden = false;
  bar.firstElementChild.style.width = '0%';
  xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) bar.firstElementChild.style.width = `${(ev.loaded / ev.total) * 100}%`; };
  xhr.onload = () => {
    bar.hidden = true;
    let res = {};
    try { res = JSON.parse(xhr.responseText); } catch { /* */ }
    if (xhr.status === 200) toast(`Uploaded ${res.name}`);
    else toast(res.error || 'Upload failed', true);
  };
  xhr.onerror = () => { bar.hidden = true; toast('Upload failed', true); };
  xhr.open('POST', `${Net.lanBase}/api/upload?code=${encodeURIComponent(Net.code)}&name=${encodeURIComponent(file.name)}`);
  xhr.send(file);
});

// ------------------------------------------------------------ close apps

function renderApps(list, error) {
  const box = $('apps');
  box.innerHTML = '';
  if (error) { box.innerHTML = `<p class="hint" style="color:#fb7185">${error}</p>`; return; }
  if (!list.length) { box.innerHTML = '<p class="hint">No closeable apps are open right now. Tap again once your friend has their game open.</p>'; return; }
  for (const a of list) {
    const b = document.createElement('button');
    b.className = 'app-item';
    b.innerHTML = `<span class="app-x">✕</span><span class="app-info"><span class="app-name"></span><span class="app-title"></span></span>`;
    b.querySelector('.app-name').textContent = a.name;
    b.querySelector('.app-title').textContent = a.title && a.title !== a.name ? a.title : '';
    b.addEventListener('click', () => {
      if (Net.send({ type: 'closeApp', pid: a.pid })) { toast(`Closing ${a.name}…`); b.remove(); }
    });
    box.appendChild(b);
  }
}

$('refreshApps').addEventListener('click', () => {
  if (Net.send({ type: 'listApps' })) { $('apps').innerHTML = '<p class="hint">Loading…</p>'; }
});

// ------------------------------------------------------------ modals / sign-in

function showModal(id) { $(id).hidden = false; }
function hideModal(id) { $(id).hidden = true; }

function askCode() { hideModal('signInModal'); showModal('codeModal'); $('codeInput').focus(); }
function askSignIn() { hideModal('codeModal'); showModal('signInModal'); $('emailInput').focus(); }

$('codeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('codeInput').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(v)) return toast('The code has 6 characters', true);
  localStorage.setItem('trollCode', v);
  localStorage.setItem('trollMode', 'code');
  hideModal('codeModal');
  codeConnect(v);
});

$('toSignIn').addEventListener('click', askSignIn);
$('toCode').addEventListener('click', () => { localStorage.setItem('trollMode', 'code'); askCode(); });

$('signInForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('signInErr').textContent = '';
  $('signInBtn').disabled = true;
  try {
    await TrollCloud.signIn($('emailInput').value, $('passwordInput').value);
    $('passwordInput').value = '';
    localStorage.setItem('trollMode', 'account');
    // onUser (below) takes it from here.
  } catch (err) {
    const c = (err && err.code) || '';
    $('signInErr').textContent = /invalid-credential|wrong-password|user-not-found/.test(c) ? 'Wrong email or password.'
      : /network/.test(c) ? 'No internet connection.'
        : /too-many-requests/.test(c) ? 'Too many tries — wait a minute.' : 'Sign-in failed.';
  } finally {
    $('signInBtn').disabled = false;
  }
});

$('signOutBtn').addEventListener('click', async () => {
  localStorage.setItem('trollMode', '');
  stopAccountMode();
  try { await TrollCloud.signOut(); } catch { /* */ }
  decideEntry(true);
});

// ------------------------------------------------------------ startup

const params = new URLSearchParams(location.search);
const urlCode = (params.get('code') || '').toUpperCase();
if (params.has('code')) { localStorage.setItem('trollCode', urlCode); history.replaceState(null, '', location.pathname); }

async function decideEntry(forceChoose) {
  const savedCode = (localStorage.getItem('trollCode') || '').toUpperCase();
  const mode = localStorage.getItem('trollMode');

  // If an account is set up and wanted, let Firebase restore the saved session.
  if (TrollCloud.isConfigured() && mode !== 'code') {
    try {
      await TrollCloud.init();
      let firstEvent = true;
      TrollCloud.onUser((user) => {
        if (user) { startAccountMode(); }
        else {
          stopAccountMode();
          if (!firstEvent || forceChoose || mode === 'account') askSignIn();
          else if (savedCode) codeConnect(savedCode);
          else askSignIn();
        }
        firstEvent = false;
      });
      // Offer the account option from the code screen too.
      $('toSignIn').hidden = false;
      return;
    } catch {
      // No internet to load Firebase — fall back to the local code.
      $('toSignIn').hidden = true;
    }
  }

  if (savedCode) codeConnect(savedCode);
  else askCode();
}

decideEntry(false);

// iPad Safari drops sockets when the screen sleeps; nudge things on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (Net.active === 'lan' && Net.ws && Net.ws.readyState > 1) {
    if (localStorage.getItem('trollMode') === 'account') startCloudReceivers();
    else codeConnect(Net.code);
  }
});

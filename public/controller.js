// The iPad remote. Talks to the PC over a WebSocket.

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
  ['scream', '😫', 'Scream'],
  ['airhorn', '📯', 'Air horn'],
  ['fart', '💨', 'Fart'],
  ['knock', '🚪', 'Knocking'],
  ['footsteps', '👣', 'Footsteps'],
  ['whispers', '🤫', 'Whispers'],
  ['mosquito', '🦟', 'Mosquito'],
  ['heartbeat', '💓', 'Heartbeat'],
  ['phone', '📞', 'Phone ring'],
  ['doorbell', '🛎️', 'Doorbell'],
  ['ding', '💬', 'Notification'],
  ['siren', '🚨', 'Siren'],
  ['explosion', '💣', 'Explosion'],
  ['drone', '🌫️', 'Creepy ambience'],
  ['static', '📻', 'Static'],
  ['glass', '🪟', 'Glass break'],
];

const PHRASES = [
  'Behind you',
  'I can see you',
  'Turn around',
  'Bruh',
  'You are so bad at this game',
  'Skill issue',
  'Your computer has a virus',
  'Ha ha ha ha ha',
  'Why are you running',
  'Get good',
];

const EMOJIS = ['💩', '🤡', '💀', '🗿', '😂', '🐸', '🕷️', '🔥', '🐀', '👁️'];

const $ = (id) => document.getElementById(id);

let ws = null;
let code = '';
let delay = 0;
let voice = 'normal';
let msgStyle = 'creepy';
let pending = [];
let retry = 0;

// ------------------------------------------------------------ helpers

let toastTimer = null;
function toast(text, error) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast' + (error ? ' error' : ''); }, 1600);
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Not connected to the PC', true);
    return false;
  }
  ws.send(JSON.stringify(obj));
  return true;
}

function delayLabel() {
  if (delay === 'random') return ' at a random time';
  if (!delay) return '';
  return delay >= 60000 ? ` in ${delay / 60000} min` : ` in ${delay / 1000}s`;
}

function fire(fx, label, tile) {
  if (!send({ type: 'fx', fx, delay, label })) return;
  toast(`${label}${delayLabel() || ' ✓'}`);
  if (tile) {
    tile.classList.remove('fired');
    void tile.offsetWidth;
    tile.classList.add('fired');
  }
}

function setStatus(state, text) {
  $('status').className = 'status ' + state;
  $('statusText').textContent = text;
}

function chipGroup(id, onPick) {
  $(id).addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $(id).querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chip));
    onPick(chip);
  });
}

// ------------------------------------------------------------ build the buttons

function buildTiles(container, list, kind) {
  for (const [id, icon, name, sub] of list) {
    const b = document.createElement('button');
    b.className = `tile ${kind}`;
    b.innerHTML = `<span class="icon">${icon}</span><span>${name}</span>${sub ? `<small>${sub}</small>` : ''}`;
    b.addEventListener('click', () => fire({ id }, name, b));
    container.appendChild(b);
  }
}
buildTiles($('scares'), SCARES, 'scare');
buildTiles($('sounds'), SOUNDS, 'sound');

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

$('stopAll').addEventListener('click', () => {
  if (send({ type: 'stop' })) toast('Stopped everything');
});

let volTimer = null;
$('volume').addEventListener('input', (e) => {
  $('volumeNum').textContent = `${e.target.value}%`;
  clearTimeout(volTimer);
  volTimer = setTimeout(() => send({ type: 'volume', value: e.target.value / 100 }), 120);
});

$('haunt').addEventListener('change', (e) => {
  if (send({ type: 'haunt', on: e.target.checked })) toast(e.target.checked ? 'Haunt mode on 👻' : 'Haunt mode off');
});

// ------------------------------------------------------------ pending (delayed) effects

function renderPending() {
  const box = $('pending');
  box.innerHTML = '';
  for (const p of pending) {
    const secs = Math.max(0, Math.ceil((p.at - Date.now()) / 1000));
    const b = document.createElement('button');
    b.textContent = `⏱ ${p.label} in ${secs}s  ✕`;
    b.addEventListener('click', () => send({ type: 'cancel', id: p.id }));
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
  return `/api/media/${encodeURIComponent(name)}?code=${code}`;
}

function renderMedia(list) {
  const box = $('media');
  box.innerHTML = '';
  for (const m of list) {
    const b = document.createElement('button');
    b.className = 'media-item';
    b.textContent = KIND_ICON[m.kind] || '📄';
    if (m.kind === 'image') {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = mediaUrl(m.name);
      b.appendChild(img);
    }
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
  const media = (mode) => ({ id: 'media', name: m.name, mode });
  if (m.kind === 'image') {
    add('😱 Jumpscare with it (+ scream)', () => fire(media('scare'), 'Custom jumpscare'));
    add('🖼️ Just show it', () => fire(media('show'), 'Picture'));
  } else if (m.kind === 'video') {
    add('🎬 Play full screen', () => fire(media('play'), 'Video'));
  } else {
    add('🔊 Play sound', () => fire(media('play'), 'Sound'));
  }
  add('🗑️ Delete from PC', () => {
    if (confirm(`Delete "${m.name}" from the PC?`)) send({ type: 'deleteMedia', name: m.name });
  }, 'danger');
  $('sheet').hidden = false;
}

function closeSheet() { $('sheet').hidden = true; }
$('sheet').addEventListener('click', (e) => {
  if (e.target === $('sheet') || e.target.hasAttribute('data-close')) closeSheet();
});

$('upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const xhr = new XMLHttpRequest();
  const bar = $('progress');
  bar.hidden = false;
  bar.firstElementChild.style.width = '0%';
  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) bar.firstElementChild.style.width = `${(ev.loaded / ev.total) * 100}%`;
  };
  xhr.onload = () => {
    bar.hidden = true;
    let res = {};
    try { res = JSON.parse(xhr.responseText); } catch { /* ignore */ }
    if (xhr.status === 200) toast(`Uploaded ${res.name}`);
    else toast(res.error || 'Upload failed', true);
  };
  xhr.onerror = () => { bar.hidden = true; toast('Upload failed', true); };
  xhr.open('POST', `/api/upload?code=${code}&name=${encodeURIComponent(file.name)}`);
  xhr.send(file);
});

// ------------------------------------------------------------ connection

function askForCode() {
  $('codeModal').hidden = false;
  $('codeInput').focus();
}

$('codeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('codeInput').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(v)) return toast('The code has 6 characters', true);
  code = v;
  localStorage.setItem('trollCode', code);
  $('codeModal').hidden = true;
  connect();
});

function connect() {
  if (ws) { ws.onclose = null; ws.close(); }
  setStatus('', 'Connecting…');
  ws = new WebSocket(`ws://${location.host}/ws?code=${code}`);
  ws.onopen = () => {
    retry = 0;
    ws.send(JSON.stringify({ type: 'hello' }));
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'hello') {
      setStatus('ok', `Connected to ${msg.pcName}`);
      applyState(msg.state);
      renderMedia(msg.media);
    } else if (msg.type === 'state') {
      applyState(msg.state);
    } else if (msg.type === 'media') {
      renderMedia(msg.list);
    } else if (msg.type === 'error') {
      toast(msg.text, true);
    }
  };
  ws.onclose = (e) => {
    if (e.code === 4001) {
      setStatus('bad', 'Wrong code');
      localStorage.removeItem('trollCode');
      return askForCode();
    }
    setStatus('bad', 'Disconnected – retrying…');
    retry = Math.min(retry + 1, 5);
    setTimeout(connect, 500 * retry);
  };
}

// Pick up the code from the QR link, then hide it from the address bar.
const params = new URLSearchParams(location.search);
code = (params.get('code') || localStorage.getItem('trollCode') || '').toUpperCase();
if (params.has('code')) {
  localStorage.setItem('trollCode', code);
  history.replaceState(null, '', location.pathname);
}
if (code) connect();
else askForCode();

// iPad Safari drops sockets when the screen sleeps; reconnect on return.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (!ws || ws.readyState > WebSocket.OPEN)) connect();
});

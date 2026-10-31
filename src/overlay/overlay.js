// Receives effects from the main process and plays them.

let volume = 0.8;
const mediaAudio = new Set();

// ------------------------------------------------------------ text to speech

const VOICE_STYLES = {
  normal: { pitch: 1, rate: 1 },
  deep: { pitch: 0.1, rate: 0.8 },
  chipmunk: { pitch: 2, rate: 1.35 },
  creepy: { pitch: 0.4, rate: 0.6 },
  fast: { pitch: 1.1, rate: 2 },
};

let voices = [];
const loadVoices = () => { voices = speechSynthesis.getVoices(); };
loadVoices();
speechSynthesis.addEventListener('voiceschanged', loadVoices);

function speak(text, style) {
  text = String(text || '').trim();
  if (!text) return;
  const v = VOICE_STYLES[style] || VOICE_STYLES.normal;
  if (!voices.length) {
    // No browser voices (happens on some PCs): use the system voice instead.
    window.troll.speakNative(text, v.rate);
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voices.find((x) => x.default && /^en/i.test(x.lang)) || voices.find((x) => /^en/i.test(x.lang)) || voices[0];
  u.pitch = v.pitch;
  u.rate = v.rate;
  u.volume = volume;
  speechSynthesis.speak(u);
}

// ------------------------------------------------------------ your own files

function reportError(text) {
  try { if (window.troll && window.troll.report) window.troll.report(text); } catch { /* */ }
}

function playFile(src, label) {
  const a = new Audio(src);
  a.volume = volume;
  mediaAudio.add(a);
  a.onended = () => mediaAudio.delete(a);
  a.onerror = () => {
    mediaAudio.delete(a);
    reportError(`Couldn't play ${label || 'that sound'} (${(a.error && a.error.message) || 'unsupported file'}).`);
  };
  a.play().catch((e) => { mediaAudio.delete(a); reportError(`Couldn't play ${label || 'that sound'} (${e.message}).`); });
}

function playMedia(fx) {
  if (fx.kind === 'image') {
    if (fx.mode === 'show') {
      Sounds.ding();
      Visuals.showImage(fx.src);
    } else {
      // A custom jumpscare can bring its own sound; otherwise use the scream.
      if (fx.soundSrc) playFile(fx.soundSrc, fx.name);
      else Sounds.scream();
      Visuals.jumpscare({ src: fx.src });
    }
  } else if (fx.kind === 'video') {
    Visuals.playVideo(fx.src, volume, () => reportError(`Couldn't play ${fx.name || 'that video'} (unsupported file).`));
  } else if (fx.kind === 'audio') {
    playFile(fx.src, fx.name);
  }
}

// ------------------------------------------------------------ mic trolls
// Route audio to a chosen output device (a virtual audio cable), so it shows up
// as the PC's microphone in a game / Discord.

const MIC_RATE = { normal: 1, deep: 0.8, chipmunk: 1.45, creepy: 0.72, fast: 1.7 };

async function listOutputs() {
  // Getting (then immediately dropping) mic access unlocks the device labels.
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); }
  catch { /* labels may be blank, but ids still work */ }
  let devices = [];
  try {
    devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audiooutput' && d.deviceId)
      .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Audio output' }));
  } catch { /* */ }
  if (window.troll && window.troll.micDevices) window.troll.micDevices(devices);
}

async function playToDevice(src, device, rate, label) {
  try {
    const a = new Audio(src);
    a.preservesPitch = false;
    try { a.mozPreservesPitch = false; a.webkitPreservesPitch = false; } catch { /* */ }
    a.playbackRate = rate || 1;
    a.volume = 1;
    if (device && a.setSinkId) {
      try { await a.setSinkId(device); }
      catch (e) { return reportError(`Mic device not available (${e.message}). Re-pick it in the PC window.`); }
    }
    mediaAudio.add(a);
    a.onended = () => mediaAudio.delete(a);
    a.onerror = () => { mediaAudio.delete(a); reportError(`Couldn't play ${label || 'the mic message'}.`); };
    await a.play();
  } catch (e) { reportError(`Mic troll failed (${e.message}).`); }
}

// ------------------------------------------------------------ live mic (WebRTC)
// The iPad streams its microphone here; we play it to the chosen output device
// (the virtual cable), so it reaches a game / Discord as the PC's mic.

const RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let micPc = null;
let micRtcEl = null;

function rtcStop() {
  if (micRtcEl) { try { micRtcEl.pause(); micRtcEl.srcObject = null; } catch { /* */ } micRtcEl = null; }
  if (micPc) { try { micPc.close(); } catch { /* */ } micPc = null; }
}

async function rtcHandle(m) {
  try {
    if (m.type === 'offer') {
      rtcStop();
      micPc = new RTCPeerConnection(RTC_CFG);
      micPc.onicecandidate = (e) => { if (e.candidate && window.troll) window.troll.sendRtc({ type: 'rtcIce', candidate: e.candidate.toJSON() }); };
      micPc.ontrack = (e) => {
        micRtcEl = new Audio();
        micRtcEl.srcObject = e.streams[0];
        micRtcEl.autoplay = true;
        const play = () => micRtcEl.play().catch((err) => reportError('Live mic playback failed: ' + err.message));
        if (m.device && micRtcEl.setSinkId) micRtcEl.setSinkId(m.device).then(play, (err) => reportError(`Mic device not available (${err.message}).`));
        else play();
      };
      await micPc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      const answer = await micPc.createAnswer();
      await micPc.setLocalDescription(answer);
      if (window.troll) window.troll.sendRtc({ type: 'rtcAnswer', sdp: answer.sdp });
    } else if (m.type === 'ice') {
      if (micPc && m.candidate) await micPc.addIceCandidate(m.candidate).catch(() => {});
    } else if (m.type === 'stop') {
      rtcStop();
    }
  } catch (e) { reportError('Live mic failed: ' + e.message); }
}

// ------------------------------------------------------------ dispatcher

function stopAll() {
  Sounds.stopAll();
  Visuals.stopAll();
  speechSynthesis.cancel();
  for (const a of mediaAudio) a.pause();
  mediaAudio.clear();
}

const FX = {
  jumpscare: (fx) => { if (fx && fx.soundSrc) playFile(fx.soundSrc, fx.name); else Sounds.scream(); Visuals.jumpscare(); },
  flashbang: () => { Sounds.flashbang(); Visuals.flashbang(); },
  crash: () => Visuals.crash(),
  crack: () => { Sounds.glass(); Visuals.crack(); },
  spiders: () => Visuals.spiders(),
  ghost: () => { Sounds.ghost(); Visuals.ghost(); },
  eyes: () => { Sounds.growl(); Visuals.eyes(); },
  blackout: () => Visuals.blackout(false, Sounds.zap),
  flicker: () => Visuals.blackout(true, Sounds.zap),
  glitch: () => { Sounds.staticNoise(1.7); Visuals.glitch(); },
  emojiRain: (fx) => Visuals.emojiRain(fx.emoji),
  message: (fx) => {
    if (fx.style === 'toast') Sounds.ding();
    Visuals.message(fx.text, fx.style);
  },
  say: (fx) => speak(fx.text, fx.voice),
  media: playMedia,
  micAudio: (fx) => playToDevice(fx.src, fx.device, MIC_RATE[fx.voice] || 1, fx.label),
  stop: stopAll,
  volume: (fx) => {
    volume = Math.max(0, Math.min(1, Number(fx.value) || 0));
    Sounds.setVolume(volume);
  },
};
for (const name of ['scream', 'airhorn', 'fart', 'knock', 'footsteps', 'whispers', 'mosquito', 'heartbeat', 'phone',
  'doorbell', 'ding', 'siren', 'explosion', 'drone', 'static', 'glass']) {
  FX[name] = () => Sounds[name]();
}

function run(fx) {
  const handler = fx && FX[fx.id];
  if (!handler) return;
  try { handler(fx); } catch (err) { console.error('Effect failed:', fx.id, err); }
}

if (window.troll) window.troll.onFx(run);
if (window.troll && window.troll.onEnumerateMic) window.troll.onEnumerateMic(listOutputs);
if (window.troll && window.troll.onRtc) window.troll.onRtc(rtcHandle);
// Handy for testing in a normal browser: run({ id: 'jumpscare' })
window.run = run;

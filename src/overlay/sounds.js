// Every sound here is synthesized live with the Web Audio API, so the app
// doesn't need to ship any audio files.

const Sounds = (() => {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const R = Math.random;
  const rand = (a, b) => a + R() * (b - a);

  const master = ctx.createGain();
  master.gain.value = 0.8;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.25;
  master.connect(limiter).connect(ctx.destination);

  // Shared reverb for the spooky stuff.
  const reverb = ctx.createConvolver();
  reverb.buffer = (() => {
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (R() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  })();
  reverb.connect(master);

  const noiseBuffer = (() => {
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = R() * 2 - 1;
    return buf;
  })();

  const distortion = (k) => {
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i * 2) / curve.length - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  };

  // ------------------------------------------------------------ building blocks

  const playing = new Set();

  // A "voice" is one playing sound: everything feeds into voice.input,
  // which is panned, optionally sent to the reverb, and cleaned up after.
  function voice({ pan = 0, wet = 0, gain = 1, duration = 2 } = {}) {
    if (ctx.state === 'suspended') ctx.resume();
    const input = ctx.createGain();
    input.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    input.connect(panner).connect(master);
    let send = null;
    if (wet) {
      send = ctx.createGain();
      send.gain.value = wet;
      panner.connect(send).connect(reverb);
    }
    const v = {
      t: ctx.currentTime + 0.03,
      input,
      panner,
      sources: [],
      end() {
        if (!playing.has(v)) return;
        playing.delete(v);
        clearTimeout(v.timer);
        for (const s of v.sources) { try { s.stop(); } catch { /* already stopped */ } }
        setTimeout(() => { input.disconnect(); panner.disconnect(); if (send) send.disconnect(); }, 100);
      },
      stop() {
        input.gain.cancelScheduledValues(ctx.currentTime);
        input.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        setTimeout(() => v.end(), 150);
      },
    };
    v.timer = setTimeout(() => v.end(), (duration + 0.5) * 1000);
    playing.add(v);
    return v;
  }

  function osc(v, type, freq, start, stop) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    o.start(start);
    o.stop(stop);
    v.sources.push(o);
    return o;
  }

  function noise(v, start, stop) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer;
    s.loop = true;
    s.start(start, R() * 2);
    s.stop(stop);
    v.sources.push(s);
    return s;
  }

  function filter(type, freq, Q = 1) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    // Anchor the value so later ramps start from here, not from time 0.
    f.frequency.setValueAtTime(freq, ctx.currentTime);
    f.Q.value = Q;
    return f;
  }

  function amp(value = 0) {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  }

  // Quick percussive hit: instant attack, exponential decay.
  function hit(param, t, peak, decay) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + 0.004);
    param.exponentialRampToValueAtTime(0.0001, t + decay);
  }

  function boom(v, t, level = 1, length = 0.8) {
    const o = osc(v, 'sine', 120, t, t + length);
    o.frequency.exponentialRampToValueAtTime(32, t + length * 0.6);
    const g = amp();
    hit(g.gain, t, level, length);
    o.connect(g).connect(v.input);
    const n = noise(v, t, t + 0.25);
    const lp = filter('lowpass', 900);
    const ng = amp();
    hit(ng.gain, t, level * 0.6, 0.2);
    n.connect(lp).connect(ng).connect(v.input);
  }

  // ------------------------------------------------------------ the sounds

  function scream() {
    const v = voice({ wet: 0.15, duration: 1.9 });
    const t = v.t;
    const end = t + 1.8;
    const out = amp();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.55, t + 0.02);
    out.gain.setValueAtTime(0.55, t + 1.15);
    out.gain.exponentialRampToValueAtTime(0.001, t + 1.75);
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortion(30);
    const tone = filter('peaking', 1100, 0.8);
    tone.gain.value = 9;
    const lp = filter('lowpass', 6000);
    shaper.connect(tone).connect(lp).connect(out).connect(v.input);

    const rough = osc(v, 'sine', 31, t, end);
    const roughDepth = amp(55);
    rough.connect(roughDepth);
    [[640, 0], [910, 12], [1270, -15], [1580, 6]].forEach(([f, cents]) => {
      const o = osc(v, 'sawtooth', f * 0.75, t, end);
      o.detune.value = cents;
      o.frequency.exponentialRampToValueAtTime(f * 1.15, t + 0.22);
      o.frequency.exponentialRampToValueAtTime(f * 0.88, t + 1.7);
      roughDepth.connect(o.frequency);
      const g = amp(0.22);
      o.connect(g).connect(shaper);
    });
    const breath = noise(v, t, end);
    const bp = filter('bandpass', 2600, 0.7);
    const bg = amp(0.45);
    breath.connect(bp).connect(bg).connect(out);
    boom(v, t, 1.1, 0.7);
  }

  function airhorn() {
    const blasts = [[0, 0.16], [0.22, 0.16], [0.44, 0.12], [0.6, 1.05]];
    const total = 1.75;
    const v = voice({ wet: 0.08, duration: total });
    const t = v.t;
    const gate = amp();
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortion(4);
    const lp = filter('lowpass', 3200);
    gate.connect(shaper).connect(lp).connect(v.input);
    gate.gain.setValueAtTime(0, t);
    for (const [start, len] of blasts) {
      gate.gain.setValueAtTime(0, t + start);
      gate.gain.linearRampToValueAtTime(0.3, t + start + 0.012);
      gate.gain.setValueAtTime(0.3, t + start + len - 0.04);
      gate.gain.linearRampToValueAtTime(0, t + start + len);
    }
    for (const f of [415.3, 418.6, 493.9, 622.3]) {
      const o = osc(v, 'sawtooth', f, t, t + total);
      o.frequency.setValueAtTime(f, t + 1.2);
      o.frequency.linearRampToValueAtTime(f * 0.97, t + total);
      o.connect(gate);
    }
  }

  function fart() {
    const dur = rand(0.8, 1.6);
    const v = voice({ duration: dur + 0.2 });
    const t = v.t;
    const o = osc(v, 'sawtooth', 100, t, t + dur + 0.1);
    const curve = new Float32Array(48);
    let f = rand(85, 125);
    for (let i = 0; i < curve.length; i++) {
      f = Math.min(170, Math.max(55, f + (R() - 0.5) * 30));
      const tail = i > curve.length * 0.75 ? 1 - ((i - curve.length * 0.75) / curve.length) * 1.6 : 1;
      curve[i] = Math.max(35, f * tail);
    }
    o.frequency.setValueCurveAtTime(curve, t, dur);

    const flutter = amp(0.6);
    const lfo = osc(v, 'square', rand(20, 32), t, t + dur + 0.1);
    const lfoDepth = amp(0.4);
    lfo.connect(lfoDepth).connect(flutter.gain);
    const lp = filter('lowpass', 750, 7);
    lp.frequency.linearRampToValueAtTime(320, t + dur);
    o.connect(flutter).connect(lp);
    const n = noise(v, t, t + dur + 0.1);
    const nbp = filter('bandpass', 260, 1.4);
    const ng = amp(0.7);
    n.connect(nbp).connect(ng).connect(flutter);

    const out = amp();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + 0.03);
    out.gain.setValueAtTime(1, t + dur * 0.65);
    out.gain.linearRampToValueAtTime(0.5, t + dur * 0.85);
    out.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(out).connect(v.input);
  }

  function knockAt(v, t, level) {
    const o = osc(v, 'sine', 160, t, t + 0.25);
    o.frequency.exponentialRampToValueAtTime(65, t + 0.08);
    const g = amp();
    hit(g.gain, t, level, 0.2);
    o.connect(g).connect(v.input);
    const n = noise(v, t, t + 0.1);
    const bp = filter('bandpass', 950, 1.2);
    const ng = amp();
    hit(ng.gain, t, level * 0.7, 0.06);
    n.connect(bp).connect(ng).connect(v.input);
  }

  function knock() {
    const v = voice({ pan: rand(-0.8, 0.8), wet: 0.4, duration: 3.5 });
    const times = [0, 0.3, 0.6];
    if (R() < 0.5) times.push(1.9, 2.15);
    times.forEach((d, i) => knockAt(v, v.t + d, i > 2 ? 0.7 : 1));
  }

  function footsteps() {
    const steps = 9;
    const gap = 0.5;
    const v = voice({ wet: 0.35, duration: steps * gap + 1 });
    const t = v.t;
    const dir = R() < 0.5 ? 1 : -1;
    v.panner.pan.setValueAtTime(-0.9 * dir, t);
    v.panner.pan.linearRampToValueAtTime(0.9 * dir, t + steps * gap);
    for (let i = 0; i < steps; i++) {
      const at = t + i * gap + rand(-0.03, 0.03);
      const level = 0.25 + 0.75 * Math.sin((Math.PI * (i + 0.5)) / steps);
      const n = noise(v, at, at + 0.2);
      const lp = filter('lowpass', 260);
      const g = amp();
      hit(g.gain, at, level * 1.6, 0.14);
      n.connect(lp).connect(g).connect(v.input);
      const o = osc(v, 'sine', 90, at, at + 0.15);
      o.frequency.exponentialRampToValueAtTime(45, at + 0.1);
      const og = amp();
      hit(og.gain, at, level * 0.7, 0.12);
      o.connect(og).connect(v.input);
      const s = noise(v, at + 0.03, at + 0.12);
      const hp = filter('highpass', 2500);
      const sg = amp();
      hit(sg.gain, at + 0.03, level * 0.08, 0.07);
      s.connect(hp).connect(sg).connect(v.input);
    }
  }

  function whispers() {
    const dur = 4.5;
    const v = voice({ wet: 0.55, gain: 1.4, duration: dur });
    const t = v.t;
    const pans = new Float32Array(16).map((_, i) => Math.sin(i * 0.9 + R() * 6) * 0.9);
    v.panner.pan.setValueCurveAtTime(pans, t, dur);
    const n = noise(v, t, t + dur);
    const syll = amp();
    let at = t + 0.1;
    while (at < t + dur - 0.4) {
      const len = rand(0.12, 0.38);
      syll.gain.setValueAtTime(0, at);
      syll.gain.linearRampToValueAtTime(rand(0.4, 1), at + len * 0.3);
      syll.gain.linearRampToValueAtTime(0, at + len);
      at += len + rand(0.02, 0.3);
    }
    n.connect(syll);
    [[[500, 900], 5, 0.8], [[1400, 2600], 7, 0.6], [[4000, 6000], 2, 0.25]].forEach(([[lo, hi], Q, level]) => {
      const f = filter('bandpass', lo, Q);
      const vals = new Float32Array(24).map(() => rand(lo, hi));
      f.frequency.setValueCurveAtTime(vals, t, dur);
      const g = amp(level);
      syll.connect(f).connect(g).connect(v.input);
    });
  }

  function mosquito() {
    const dur = 8;
    const v = voice({ gain: 0.32, duration: dur });
    const t = v.t;
    const o = osc(v, 'sawtooth', 600, t, t + dur);
    const drift = new Float32Array(20).map(() => rand(560, 690));
    o.frequency.setValueCurveAtTime(drift, t, dur);
    const vib = osc(v, 'sine', 7, t, t + dur);
    const vibDepth = amp(18);
    vib.connect(vibDepth).connect(o.frequency);
    const lp = filter('lowpass', 4500);
    const level = amp(0.5);
    const swell = osc(v, 'sine', rand(0.15, 0.3), t, t + dur);
    const swellDepth = amp(0.45);
    swell.connect(swellDepth).connect(level.gain);
    const around = osc(v, 'sine', rand(0.2, 0.35), t, t + dur);
    const aroundDepth = amp(0.95);
    around.connect(aroundDepth).connect(v.panner.pan);
    const env = amp();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.6);
    env.gain.setValueAtTime(1, t + dur - 0.9);
    env.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp).connect(level).connect(env).connect(v.input);
  }

  function heartbeat() {
    const dur = 8;
    const v = voice({ gain: 1.6, wet: 0.1, duration: dur + 0.5 });
    let at = 0;
    let bpm = 68;
    while (at < dur) {
      [[0, 1], [0.22, 0.65]].forEach(([off, level]) => {
        const s = v.t + at + off;
        const o = osc(v, 'sine', 75, s, s + 0.3);
        o.frequency.exponentialRampToValueAtTime(38, s + 0.12);
        const g = amp();
        hit(g.gain, s, level, 0.25);
        o.connect(g).connect(v.input);
      });
      bpm = Math.min(155, bpm * 1.09);
      at += 60 / bpm;
    }
  }

  function phone() {
    const rings = [[0, 0.4], [0.6, 0.4], [2.6, 0.4], [3.2, 0.4], [5.2, 0.4], [5.8, 0.4]];
    const total = 6.4;
    const v = voice({ pan: rand(-0.5, 0.5), wet: 0.2, gain: 0.5, duration: total });
    const t = v.t;
    const gate = amp();
    gate.gain.setValueAtTime(0, t);
    for (const [s, len] of rings) {
      gate.gain.setValueAtTime(0, t + s);
      gate.gain.linearRampToValueAtTime(0.5, t + s + 0.01);
      gate.gain.setValueAtTime(0.5, t + s + len - 0.02);
      gate.gain.linearRampToValueAtTime(0, t + s + len);
    }
    const trill = amp(0.5);
    const lfo = osc(v, 'square', 18, t, t + total);
    const depth = amp(0.5);
    lfo.connect(depth).connect(trill.gain);
    for (const f of [1150, 1420]) osc(v, 'triangle', f, t, t + total).connect(trill);
    trill.connect(gate).connect(v.input);
  }

  function bell(v, f, t, len, level) {
    [[1, 1], [2, 0.3], [2.76, 0.22], [5.4, 0.07]].forEach(([mult, a]) => {
      const o = osc(v, 'sine', f * mult, t, t + len);
      const g = amp();
      hit(g.gain, t, level * a, len);
      o.connect(g).connect(v.input);
    });
  }

  function doorbell() {
    const v = voice({ wet: 0.3, duration: 3 });
    bell(v, 659.25, v.t, 1.6, 0.45);
    bell(v, 523.25, v.t + 0.55, 2.2, 0.45);
  }

  function ding() {
    const v = voice({ wet: 0.1, duration: 1.2 });
    bell(v, 880, v.t, 0.5, 0.35);
    bell(v, 1318.5, v.t + 0.09, 0.9, 0.35);
  }

  function siren() {
    const dur = 5;
    const v = voice({ gain: 0.32, wet: 0.2, duration: dur });
    const t = v.t;
    const o = osc(v, 'square', 650, t, t + dur);
    const curve = new Float32Array(200).map((_, i) => 975 + 325 * Math.sin((i / 200) * Math.PI * 2 * 2.5 - Math.PI / 2));
    o.frequency.setValueCurveAtTime(curve, t, dur);
    const lp = filter('lowpass', 2400);
    const env = amp();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.2);
    env.gain.setValueAtTime(1, t + dur - 0.4);
    env.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp).connect(env).connect(v.input);
  }

  function explosion(length = 2.4) {
    const v = voice({ wet: 0.3, duration: length + 0.3 });
    const t = v.t;
    const n = noise(v, t, t + length);
    const lp = filter('lowpass', 5000, 0.7);
    lp.frequency.exponentialRampToValueAtTime(70, t + length * 0.85);
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortion(8);
    const g = amp();
    hit(g.gain, t, 1, length);
    n.connect(lp).connect(shaper).connect(g).connect(v.input);
    boom(v, t, 1.3, length * 0.5);
  }

  function drone() {
    const dur = 12;
    const v = voice({ wet: 0.5, duration: dur });
    const t = v.t;
    const lp = filter('lowpass', 380, 3);
    const sweep = osc(v, 'sine', 0.12, t, t + dur);
    const sweepDepth = amp(160);
    sweep.connect(sweepDepth).connect(lp.frequency);
    const env = amp();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.45, t + 2.5);
    env.gain.setValueAtTime(0.45, t + dur - 3);
    env.gain.linearRampToValueAtTime(0, t + dur);
    for (const f of [55, 55.4, 77.8, 110.3]) osc(v, 'sawtooth', f, t, t + dur).connect(lp);
    lp.connect(env).connect(v.input);
    const high = amp(0.025);
    const trem = osc(v, 'sine', 0.7, t, t + dur);
    const tremDepth = amp(0.02);
    trem.connect(tremDepth).connect(high.gain);
    for (const f of [1760, 1767]) osc(v, 'sine', f, t, t + dur).connect(high);
    high.connect(env);
  }

  function staticNoise(length = 2) {
    const v = voice({ duration: length });
    const t = v.t;
    const n = noise(v, t, t + length);
    const bp = filter('bandpass', 3000, 0.4);
    const crackle = amp();
    const curve = new Float32Array(120).map(() => (R() < 0.15 ? 1 : rand(0.15, 0.5)));
    crackle.gain.setValueCurveAtTime(curve, t, length);
    const out = amp(0.45);
    n.connect(bp).connect(crackle).connect(out).connect(v.input);
  }

  function glass() {
    const v = voice({ wet: 0.25, duration: 1.4 });
    const t = v.t;
    const n = noise(v, t, t + 0.4);
    const hp = filter('highpass', 1800);
    const g = amp();
    hit(g.gain, t, 1, 0.3);
    n.connect(hp).connect(g).connect(v.input);
    const o = osc(v, 'sine', 220, t, t + 0.2);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.1);
    const og = amp();
    hit(og.gain, t, 0.6, 0.15);
    o.connect(og).connect(v.input);
    for (let i = 0; i < 16; i++) {
      const s = t + rand(0.02, 0.7);
      const tink = osc(v, 'sine', rand(2500, 7500), s, s + 0.3);
      const tg = amp();
      hit(tg.gain, s, rand(0.05, 0.18), rand(0.06, 0.25));
      tink.connect(tg).connect(v.input);
    }
  }

  function flashbang() {
    explosion(1.2);
    const v = voice({ gain: 0.13, duration: 6 });
    const t = v.t + 0.15;
    const o = osc(v, 'sine', 3800, t, t + 5.5);
    const g = amp();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.05);
    g.gain.setValueAtTime(1, t + 1.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + 5.5);
    o.connect(g).connect(v.input);
  }

  function ghost() {
    const dur = 2.2;
    const v = voice({ wet: 0.6, duration: dur });
    const t = v.t;
    v.panner.pan.setValueAtTime(-1, t);
    v.panner.pan.linearRampToValueAtTime(1, t + dur);
    const n = noise(v, t, t + dur);
    const bp = filter('bandpass', 300, 1.5);
    bp.frequency.exponentialRampToValueAtTime(1800, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = amp();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.8, t + dur * 0.45);
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(bp).connect(g).connect(v.input);
    const moan = osc(v, 'triangle', 270, t, t + dur);
    moan.frequency.exponentialRampToValueAtTime(170, t + dur);
    const vib = osc(v, 'sine', 5, t, t + dur);
    const vibDepth = amp(9);
    vib.connect(vibDepth).connect(moan.frequency);
    const mg = amp();
    mg.gain.setValueAtTime(0, t);
    mg.gain.linearRampToValueAtTime(0.18, t + 0.6);
    mg.gain.linearRampToValueAtTime(0, t + dur);
    moan.connect(mg).connect(v.input);
  }

  function growl() {
    const dur = 2.6;
    const v = voice({ wet: 0.35, gain: 1.3, duration: dur });
    const t = v.t;
    const lp = filter('lowpass', 220, 6);
    const rumble = amp(0.5);
    const lfo = osc(v, 'sawtooth', 11, t, t + dur);
    const lfoDepth = amp(0.5);
    lfo.connect(lfoDepth).connect(rumble.gain);
    for (const f of [44, 46.5, 66]) {
      const o = osc(v, 'sawtooth', f, t, t + dur);
      o.frequency.linearRampToValueAtTime(f * 0.85, t + dur);
      o.connect(rumble);
    }
    const env = amp();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.9, t + 0.5);
    env.gain.linearRampToValueAtTime(0, t + dur);
    rumble.connect(lp).connect(env).connect(v.input);
  }

  // Short electrical zap, used by the blackout flicker.
  function zap() {
    const v = voice({ duration: 0.3 });
    const t = v.t;
    const o = osc(v, 'square', 60, t, t + 0.18);
    const n = noise(v, t, t + 0.12);
    const hp = filter('highpass', 1200);
    const g = amp();
    hit(g.gain, t, 0.35, 0.16);
    o.connect(g);
    n.connect(hp).connect(g);
    g.connect(v.input);
  }

  function setVolume(value) {
    master.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), ctx.currentTime, 0.05);
  }

  function stopAll() {
    for (const v of [...playing]) v.stop();
  }

  return {
    scream, airhorn, fart, knock, footsteps, whispers, mosquito, heartbeat, phone, doorbell, ding,
    siren, explosion: () => explosion(), drone, static: () => staticNoise(2), glass, flashbang, ghost,
    growl, zap, staticNoise, setVolume, stopAll,
  };
})();

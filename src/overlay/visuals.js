// Everything that shows up on screen. All the scary pictures are drawn in
// code, so there are no image files to ship.

const Visuals = (() => {
  const stage = document.getElementById('stage');
  const R = Math.random;
  const rand = (a, b) => a + R() * (b - a);
  const TAU = Math.PI * 2;
  const active = new Set();

  // The overlay window is only shown while something is on screen, so the
  // game runs untouched the rest of the time.
  let visible = false;
  let hideTimer = null;
  function refresh() {
    const want = active.size > 0;
    if (want) {
      clearTimeout(hideTimer);
      if (!visible) { visible = true; window.troll && window.troll.setVisible(true); }
    } else if (visible) {
      // Give the window a moment to paint an empty frame before hiding it,
      // otherwise the last scare can flash up next time it is shown.
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (active.size === 0) { visible = false; window.troll && window.troll.setVisible(false); }
      }, 200);
    }
  }

  function el(tag, className, style) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (style) e.style.cssText = style;
    return e;
  }

  function fullCanvas(scale = 1) {
    const c = el('canvas', 'layer');
    c.width = Math.round(innerWidth * scale);
    c.height = Math.round(innerHeight * scale);
    return c;
  }

  // A scene owns its elements, timers and animation loop, and cleans all of
  // them up when it ends (or when "stop everything" is pressed).
  function scene(build) {
    const s = { done: false, els: [], timers: [], raf: 0, cleanups: [] };
    s.add = (node) => { stage.appendChild(node); s.els.push(node); return node; };
    s.after = (ms, fn) => { s.timers.push(setTimeout(() => !s.done && fn(), ms)); };
    s.onEnd = (fn) => s.cleanups.push(fn);
    s.loop = (fn) => {
      const start = performance.now();
      const tick = (now) => {
        if (s.done) return;
        if (fn(now - start) === false) return s.end();
        s.raf = requestAnimationFrame(tick);
      };
      s.raf = requestAnimationFrame(tick);
    };
    s.end = () => {
      if (s.done) return;
      s.done = true;
      s.timers.forEach(clearTimeout);
      cancelAnimationFrame(s.raf);
      for (const fn of s.cleanups) { try { fn(); } catch { /* ignore */ } }
      s.els.forEach((n) => n.remove());
      active.delete(s);
      refresh();
    };
    active.add(s);
    refresh();
    try { build(s); } catch (err) { console.error(err); s.end(); }
    return s;
  }

  // ------------------------------------------------------------ jumpscare face

  function drawFace(canvas) {
    const W = (canvas.width = Math.min(1600, innerWidth || 1600));
    const H = (canvas.height = Math.round(W * ((innerHeight || 9) / (innerWidth || 16))));
    const c = canvas.getContext('2d');

    let g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, '#2b0000');
    g.addColorStop(1, '#000');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H * 0.47;
    const fh = H * 0.98; // nearly screen-height: it is right in your face
    const fw = fh * 0.66;

    const headPath = () => {
      c.beginPath();
      c.moveTo(cx, cy - fh * 0.52);
      c.bezierCurveTo(cx + fw * 0.62, cy - fh * 0.52, cx + fw * 0.6, cy + fh * 0.05, cx + fw * 0.36, cy + fh * 0.34);
      c.bezierCurveTo(cx + fw * 0.22, cy + fh * 0.5, cx + fw * 0.09, cy + fh * 0.57, cx, cy + fh * 0.57);
      c.bezierCurveTo(cx - fw * 0.09, cy + fh * 0.57, cx - fw * 0.22, cy + fh * 0.5, cx - fw * 0.36, cy + fh * 0.34);
      c.bezierCurveTo(cx - fw * 0.6, cy + fh * 0.05, cx - fw * 0.62, cy - fh * 0.52, cx, cy - fh * 0.52);
      c.closePath();
    };

    // Skin.
    headPath();
    g = c.createRadialGradient(cx, cy - fh * 0.12, fh * 0.04, cx, cy, fh * 0.62);
    g.addColorStop(0, '#dcd7c2');
    g.addColorStop(0.45, '#a59e86');
    g.addColorStop(0.8, '#4a4537');
    g.addColorStop(1, '#121110');
    c.fillStyle = g;
    c.fill();

    c.save();
    headPath();
    c.clip();
    // Blotchy, sickly skin.
    for (let i = 0; i < 320; i++) {
      c.fillStyle = `rgba(${(30 + R() * 50) | 0},${(25 + R() * 30) | 0},${(20 + R() * 20) | 0},${0.03 + R() * 0.1})`;
      c.beginPath();
      c.arc(cx + (R() - 0.5) * fw * 1.2, cy + (R() - 0.5) * fh * 1.1, 2 + R() * fh * 0.05, 0, TAU);
      c.fill();
    }
    // Sunken cheeks.
    for (const s of [-1, 1]) {
      g = c.createRadialGradient(cx + s * fw * 0.3, cy + fh * 0.14, 0, cx + s * fw * 0.3, cy + fh * 0.14, fh * 0.2);
      g.addColorStop(0, 'rgba(0,0,0,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    // Forehead wrinkles.
    c.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const y = cy - fh * 0.33 + k * fh * 0.035;
      c.strokeStyle = `rgba(35,25,18,${0.12 + R() * 0.15})`;
      c.lineWidth = fh * 0.002 + R() * fh * 0.003;
      c.beginPath();
      c.moveTo(cx - fw * rand(0.12, 0.26), y + rand(-6, 6));
      c.bezierCurveTo(cx - fw * 0.1, y - fh * rand(0.01, 0.03), cx + fw * 0.1, y + fh * rand(0.01, 0.03), cx + fw * rand(0.12, 0.26), y + rand(-6, 6));
      c.stroke();
    }
    c.restore();

    const vein = (x, y, a, len, width) => {
      c.beginPath();
      c.moveTo(x, y);
      for (let i = 0; i < 14; i++) {
        a += (R() - 0.5) * 0.7;
        x += (Math.cos(a) * len) / 14;
        y += (Math.sin(a) * len) / 14;
        c.lineTo(x, y);
      }
      c.lineWidth = width;
      c.strokeStyle = 'rgba(70,8,28,0.5)';
      c.stroke();
    };

    const drip = (x, y, len, w) => {
      g = c.createLinearGradient(x, y, x, y + len);
      g.addColorStop(0, '#4a0000');
      g.addColorStop(1, '#8a0303');
      c.strokeStyle = g;
      c.fillStyle = '#7a0202';
      const steps = 10;
      let px = x;
      for (let i = 0; i < steps; i++) {
        const nx = px + rand(-w * 0.3, w * 0.3);
        c.lineWidth = w * (0.45 + (0.55 * i) / steps);
        c.beginPath();
        c.moveTo(px, y + (len * i) / steps);
        c.lineTo(nx, y + (len * (i + 1)) / steps);
        c.stroke();
        px = nx;
      }
      c.beginPath();
      c.ellipse(px, y + len, w * 0.75, w * 1.0, 0, 0, TAU);
      c.fill();
    };

    // Eyes: deep black holes with tiny glowing pupils.
    const eyeY = cy - fh * 0.075;
    for (const s of [-1, 1]) {
      const ex = cx + s * fw * 0.2;
      for (let i = 0; i < 7; i++) vein(ex + s * fw * 0.08, eyeY, (s > 0 ? 0 : Math.PI) + rand(-1.2, 1.2), fw * rand(0.12, 0.3), fh * 0.003);
      g = c.createRadialGradient(ex, eyeY, 0, ex, eyeY, fw * 0.24);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.55, 'rgba(12,0,0,0.88)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(ex, eyeY, fw * 0.25, fw * 0.21, 0, 0, TAU);
      c.fill();
      c.fillStyle = '#000';
      c.beginPath();
      c.ellipse(ex, eyeY + fw * 0.01, fw * 0.115, fw * 0.135, s * 0.3, 0, TAU);
      c.fill();
      c.save();
      c.shadowColor = '#ff2200';
      c.shadowBlur = fw * 0.06;
      c.fillStyle = '#fff3d6';
      c.beginPath();
      c.arc(ex - s * fw * 0.012, eyeY + fw * 0.02, fw * 0.013, 0, TAU);
      c.fill();
      c.fill();
      c.restore();
      drip(ex + rand(-fw * 0.04, fw * 0.04), eyeY + fw * 0.12, fh * rand(0.16, 0.3), fw * 0.022);
      if (R() < 0.6) drip(ex + rand(-fw * 0.07, fw * 0.07), eyeY + fw * 0.11, fh * rand(0.06, 0.14), fw * 0.014);
    }

    // Nose: two slits.
    for (const s of [-1, 1]) {
      c.fillStyle = '#140b08';
      c.beginPath();
      c.ellipse(cx + s * fw * 0.033, cy + fh * 0.045, fw * 0.011, fw * 0.03, s * 0.45, 0, TAU);
      c.fill();
    }

    // Mouth: stretched wide open, full of crooked teeth.
    const my = cy + fh * 0.27;
    const mw = fw * 0.22;
    const mh = fh * 0.155;
    c.fillStyle = 'rgba(35,8,8,0.9)';
    c.beginPath();
    c.ellipse(cx, my, mw * 1.12, mh * 1.1, 0, 0, TAU);
    c.fill();
    c.save();
    c.beginPath();
    c.ellipse(cx, my, mw, mh, 0, 0, TAU);
    c.clip();
    g = c.createRadialGradient(cx, my + mh * 0.1, 0, cx, my, mw * 1.1);
    g.addColorStop(0, '#000');
    g.addColorStop(0.55, '#190000');
    g.addColorStop(1, '#4a0707');
    c.fillStyle = g;
    c.fillRect(cx - mw * 1.2, my - mh * 1.2, mw * 2.4, mh * 2.4);
    const tooth = (a, dir) => {
      const bx = cx + mw * Math.cos(a);
      const by = my + mh * Math.sin(a);
      const len = mh * rand(0.22, 0.48);
      const w = mw * rand(0.11, 0.19);
      const tipX = bx + (cx - bx) * 0.15 + rand(-w * 0.3, w * 0.3);
      const tipY = by + dir * len;
      const tg = c.createLinearGradient(bx, by, tipX, tipY);
      tg.addColorStop(0, '#6e5f3a');
      tg.addColorStop(0.35, '#d8cc9c');
      tg.addColorStop(1, '#efe6c4');
      c.fillStyle = tg;
      c.strokeStyle = 'rgba(20,10,5,0.8)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(bx - w / 2, by - dir * 6);
      c.quadraticCurveTo(bx - w * 0.3, by + dir * len * 0.6, tipX, tipY);
      c.quadraticCurveTo(bx + w * 0.3, by + dir * len * 0.6, bx + w / 2, by - dir * 6);
      c.closePath();
      c.fill();
      c.stroke();
    };
    for (let i = 0; i < 11; i++) tooth(Math.PI + 0.25 + ((Math.PI - 0.5) * i) / 10 + rand(-0.04, 0.04), 1);
    for (let i = 0; i < 10; i++) tooth(0.3 + ((Math.PI - 0.6) * i) / 9 + rand(-0.04, 0.04), -1);
    c.restore();
    for (let i = 0; i < 3; i++) drip(cx + rand(-mw * 0.8, mw * 0.8), my + mh * 0.9, fh * rand(0.06, 0.18), fw * 0.02);

    // Grain + vignette.
    const grain = document.createElement('canvas');
    grain.width = grain.height = 256;
    const gc = grain.getContext('2d');
    const img = gc.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (R() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 28;
    }
    gc.putImageData(img, 0, 0);
    c.fillStyle = c.createPattern(grain, 'repeat');
    c.fillRect(0, 0, W, H);
    g = c.createRadialGradient(cx, cy, fh * 0.25, cx, cy, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.9)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  function jumpscare({ src } = {}) {
    return scene((s) => {
      s.add(el('div', 'layer', 'background:#000'));
      let face;
      if (src) {
        face = el('img', 'layer', 'object-fit:cover;width:100%;height:100%');
        face.src = src;
      } else {
        face = el('canvas', 'layer', 'width:100%;height:100%');
        drawFace(face);
      }
      s.add(face);
      const red = s.add(el('div', 'layer', 'background:#d00000;mix-blend-mode:multiply;opacity:0'));
      const DURATION = 1700;
      const LUNGE = 110;
      s.loop((t) => {
        if (t > DURATION) return false;
        const p = Math.min(1, t / LUNGE);
        const scale = 0.25 + (1 - Math.pow(1 - p, 3)) * 0.85 + (t / DURATION) * 0.15;
        const k = t < LUNGE ? 0 : 1;
        const dx = (R() - 0.5) * 70 * k;
        const dy = (R() - 0.5) * 70 * k;
        const rot = (R() - 0.5) * 7 * k;
        face.style.transform = `translate(${dx}px,${dy}px) scale(${scale}) rotate(${rot}deg)`;
        const roll = R();
        face.style.filter = roll < 0.07 ? 'invert(1) contrast(2)' : roll < 0.15 ? 'contrast(1.7) brightness(1.5)' : 'none';
        red.style.opacity = Math.sin(t / 35) > 0.2 ? '0.55' : '0.1';
      });
    });
  }

  // ------------------------------------------------------------ simple full-screen effects

  function flashbang() {
    return scene((s) => {
      const white = s.add(el('div', 'layer', 'background:#fff'));
      const HOLD = 1000;
      const FADE = 4000;
      s.loop((t) => {
        if (t > HOLD + FADE) return false;
        white.style.opacity = t < HOLD ? 1 : 1 - Math.pow((t - HOLD) / FADE, 1.6);
      });
    });
  }

  // Lights go out. Short version is used by haunt mode.
  function blackout(short, zap) {
    const pattern = short
      ? [[0, 1], [70, 0], [150, 1], [230, 0]]
      : [[0, 1], [90, 0], [170, 1], [430, 0], [500, 1], [2700, 0], [2780, 1], [3400, 0]];
    return scene((s) => {
      const black = s.add(el('div', 'layer', `background:#000;opacity:0`));
      for (const [at, on] of pattern) {
        s.after(at, () => {
          black.style.opacity = on ? (short ? '0.93' : '1') : '0';
          if (on && zap) zap();
        });
      }
      s.after(pattern[pattern.length - 1][0] + 50, s.end);
    });
  }

  function glitch() {
    return scene((s) => {
      const c = s.add(el('canvas', 'layer'));
      c.width = 240;
      c.height = Math.round((240 * innerHeight) / innerWidth) || 135;
      c.style.cssText = 'width:100%;height:100%;image-rendering:pixelated;opacity:0.85';
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(c.width, c.height);
      s.loop((t) => {
        if (t > 1700) return false;
        if (R() < 0.12) { ctx.clearRect(0, 0, c.width, c.height); return; }
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = (R() * 255) | 0;
          d[i] = d[i + 1] = d[i + 2] = v;
          d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        for (let b = 0; b < 4; b++) {
          ctx.fillStyle = ['rgba(255,0,60,0.5)', 'rgba(0,255,200,0.5)', 'rgba(60,60,255,0.5)', 'rgba(0,0,0,0.8)'][(R() * 4) | 0];
          ctx.fillRect(0, R() * c.height, c.width, rand(1, c.height * 0.15));
        }
      });
    });
  }

  function emojiRain(emoji) {
    const chars = [...(emoji || '💩')].filter((ch) => ch.trim());
    return scene((s) => {
      let longest = 0;
      for (let i = 0; i < 80; i++) {
        const e = s.add(el('div', 'emoji', `left:${rand(-3, 97)}vw;font-size:${rand(30, 96)}px`));
        e.textContent = chars[i % chars.length] || '💩';
        const duration = rand(2500, 5500);
        const delay = rand(0, 2500);
        longest = Math.max(longest, duration + delay);
        e.animate(
          [{ transform: 'translateY(-15vh) rotate(0deg)' }, { transform: `translateY(115vh) rotate(${rand(-360, 360)}deg)` }],
          { duration, delay, easing: 'cubic-bezier(.4,0,.9,1)', fill: 'both' },
        );
      }
      s.after(longest + 100, s.end);
    });
  }

  // ------------------------------------------------------------ fake crash screen

  function fakeQr(size) {
    const c = el('canvas');
    const n = 25;
    c.width = c.height = n;
    c.style.cssText = `width:${size}px;height:${size}px;image-rendering:pixelated;background:#fff`;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = '#0a5fb4';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (R() < 0.5) ctx.fillRect(x, y, 1, 1);
    for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      ctx.fillStyle = '#0a5fb4'; ctx.fillRect(x, y, 7, 7);
      ctx.fillStyle = '#fff'; ctx.fillRect(x + 1, y + 1, 5, 5);
      ctx.fillStyle = '#0a5fb4'; ctx.fillRect(x + 2, y + 2, 3, 3);
    }
    return c;
  }

  function crash() {
    return scene((s) => {
      const screenEl = s.add(el('div', 'layer crash'));
      screenEl.innerHTML = `
        <div class="crash-inner">
          <div class="crash-face">:(</div>
          <p class="crash-msg">Your PC ran into a problem and needs to restart. We're just collecting some error info, and then we'll restart for you.</p>
          <p class="crash-pct"><span>0</span>% complete</p>
          <div class="crash-foot">
            <div class="crash-qr"></div>
            <div>
              <p class="crash-small">For more information about this issue and possible fixes, visit https://www.windows.com/stopcode</p>
              <p class="crash-small">If you call a support person, give them this info:<br>Stop code: CRITICAL_PROCESS_DIED</p>
            </div>
          </div>
        </div>`;
      screenEl.querySelector('.crash-qr').appendChild(fakeQr(110));
      const pct = screenEl.querySelector('.crash-pct span');
      let value = 0;
      const step = () => {
        value = Math.min(100, value + Math.floor(rand(3, 18)));
        pct.textContent = value;
        if (value < 100) s.after(rand(300, 1100), step);
        else s.after(1200, restart);
      };
      // After "collecting error info", it looks like Windows reboots: a black
      // screen with the spinning dots, then it fades back to the game.
      const restart = () => {
        screenEl.className = 'layer win-restart';
        screenEl.innerHTML = '<div class="win-spinner"><i></i><i></i><i></i><i></i><i></i></div><div class="win-text">Restarting</div>';
        s.after(14000, () => {
          screenEl.style.transition = 'opacity 1.2s';
          screenEl.style.opacity = '0';
          s.after(1200, s.end);
        });
      };
      s.after(1200, step);
    });
  }

  // ------------------------------------------------------------ cracked screen

  function crack() {
    return scene((s) => {
      const dpr = devicePixelRatio || 1;
      const c = s.add(fullCanvas(dpr));
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      const W = innerWidth;
      const H = innerHeight;
      const cx = rand(W * 0.3, W * 0.7);
      const cy = rand(H * 0.3, H * 0.7);
      const reach = Math.hypot(W, H);
      const rays = 14 + ((R() * 8) | 0);
      const rings = [35, 80, 150, 240, 360].map((r) => r * rand(0.85, 1.2));
      const ringPts = rings.map(() => []);

      const stroke = (pts, width) => {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + 1, y + 1) : ctx.moveTo(x + 1, y + 1)));
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = width + 1.5;
        ctx.stroke();
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = width;
        ctx.stroke();
      };

      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * TAU + rand(-0.15, 0.15);
        const len = reach * rand(0.25, 0.75);
        const pts = [[cx, cy]];
        let d = 0;
        let ang = a;
        let x = cx;
        let y = cy;
        let ring = 0;
        while (d < len) {
          const step = rand(15, 45);
          ang = a + rand(-0.12, 0.12);
          x += Math.cos(ang) * step;
          y += Math.sin(ang) * step;
          d += step;
          pts.push([x, y]);
          while (ring < rings.length && d >= rings[ring]) { ringPts[ring][i] = [x, y]; ring++; }
          if (R() < 0.08) {
            // little side branch
            const ba = ang + (R() < 0.5 ? 1 : -1) * rand(0.4, 0.9);
            const bl = rand(20, 90);
            stroke([[x, y], [x + Math.cos(ba) * bl * 0.5 + rand(-5, 5), y + Math.sin(ba) * bl * 0.5 + rand(-5, 5)], [x + Math.cos(ba) * bl, y + Math.sin(ba) * bl]], 0.8);
          }
        }
        stroke(pts, rand(0.8, 1.8));
      }
      ringPts.forEach((pts) => {
        for (let i = 0; i < rays; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % rays];
          if (!a || !b || R() < 0.3) continue;
          const mx = (a[0] + b[0]) / 2 + rand(-8, 8);
          const my = (a[1] + b[1]) / 2 + rand(-8, 8);
          stroke([a, [mx, my], b], 0.9);
        }
      });
      // Shattered impact point.
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 40; i++) {
        const a = R() * TAU;
        const r = rand(2, 34);
        stroke([[cx + Math.cos(a) * r, cy + Math.sin(a) * r], [cx + Math.cos(a + rand(-1, 1)) * (r + rand(4, 14)), cy + Math.sin(a + rand(-1, 1)) * (r + rand(4, 14))]], 0.7);
      }
      // A few glinting shards.
      for (let i = 0; i < 10; i++) {
        const a = R() * TAU;
        const r = rand(30, 260);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        ctx.fillStyle = `rgba(255,255,255,${rand(0.04, 0.12)})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + rand(-40, 40), y + rand(-40, 40));
        ctx.lineTo(x + rand(-40, 40), y + rand(-40, 40));
        ctx.fill();
      }
      s.after(14000, () => {
        c.style.transition = 'opacity 1s';
        c.style.opacity = '0';
        s.after(1000, s.end);
      });
    });
  }

  // ------------------------------------------------------------ spiders

  function drawSpider(ctx, sp) {
    const z = sp.size;
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(sp.angle);
    ctx.strokeStyle = '#120d0a';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const baseAngles = [0.6, 1.2, 1.9, 2.5];
    for (const side of [-1, 1]) {
      baseAngles.forEach((ba, i) => {
        const swing = Math.sin(sp.phase + (i % 2 === (side > 0 ? 0 : 1) ? 0 : Math.PI)) * 0.22;
        const a = side * (ba + swing);
        const hipX = z * 0.12 - i * z * 0.06;
        const kx = hipX + Math.cos(a) * z * 0.55;
        const ky = Math.sin(a) * z * 0.55;
        const fa = a + side * (i < 2 ? -0.5 : 0.5);
        const fx = kx + Math.cos(fa) * z * 0.6;
        const fy = ky + Math.sin(fa) * z * 0.6;
        ctx.lineWidth = z * 0.055;
        ctx.beginPath();
        ctx.moveTo(hipX, 0);
        ctx.lineTo(kx, ky);
        ctx.lineTo(fx, fy);
        ctx.stroke();
      });
    }
    let g = ctx.createRadialGradient(-z * 0.32, -z * 0.08, 0, -z * 0.3, 0, z * 0.38);
    g.addColorStop(0, '#4a3a2c');
    g.addColorStop(1, '#0d0907');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(-z * 0.3, 0, z * 0.36, z * 0.27, 0, 0, TAU);
    ctx.fill();
    g = ctx.createRadialGradient(z * 0.12, -z * 0.05, 0, z * 0.12, 0, z * 0.22);
    g.addColorStop(0, '#3d3024');
    g.addColorStop(1, '#0d0907');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(z * 0.12, 0, z * 0.2, z * 0.16, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#a01010';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(z * 0.27, s * z * 0.05, z * 0.025, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function spiders(count = 7) {
    return scene((s) => {
      const c = s.add(fullCanvas(1));
      const ctx = c.getContext('2d');
      const W = c.width;
      const H = c.height;
      const spawn = () => {
        const edge = (R() * 4) | 0;
        const size = rand(28, 70);
        const pos = [[rand(0, W), -size], [W + size, rand(0, H)], [rand(0, W), H + size], [-size, rand(0, H)]][edge];
        const angle = Math.atan2(H / 2 + rand(-H * 0.3, H * 0.3) - pos[1], W / 2 + rand(-W * 0.3, W * 0.3) - pos[0]);
        return { x: pos[0], y: pos[1], size, angle, speed: 0, phase: R() * TAU, walk: rand(0.5, 1.5), pause: 0, turn: 0, delay: rand(0, 2500) };
      };
      const list = Array.from({ length: count }, spawn);
      const LEAVE_AT = 9000;
      let last = 0;
      s.loop((t) => {
        const dt = Math.min(0.05, (t - last) / 1000);
        last = t;
        ctx.clearRect(0, 0, W, H);
        let alive = 0;
        for (const sp of list) {
          if (t < sp.delay) { alive++; continue; }
          if (sp.pause > 0) {
            sp.pause -= dt;
            sp.speed = 0;
          } else {
            sp.walk -= dt;
            sp.speed = sp.size * rand(4, 7);
            if (sp.walk <= 0) { sp.pause = rand(0.2, 1.4); sp.walk = rand(0.4, 1.6); sp.turn = rand(-2.5, 2.5); }
          }
          if (t > LEAVE_AT) {
            // Head for the closest edge and leave.
            const tx = sp.x < W / 2 ? -200 : W + 200;
            const want = Math.atan2(0, tx - sp.x);
            sp.angle += Math.sin(want - sp.angle) * dt * 4;
            sp.pause = Math.min(sp.pause, 0.1);
          } else {
            sp.angle += sp.turn * dt * (sp.speed ? 1 : 0);
          }
          sp.x += Math.cos(sp.angle) * sp.speed * dt;
          sp.y += Math.sin(sp.angle) * sp.speed * dt;
          sp.phase += sp.speed * dt * 0.25;
          const off = sp.x < -150 || sp.x > W + 150 || sp.y < -150 || sp.y > H + 150;
          if (!off || t < LEAVE_AT) alive++;
          if (!off) drawSpider(ctx, sp);
        }
        if (!alive || t > 16000) return false;
      });
    });
  }

  // ------------------------------------------------------------ ghost

  function drawGhost(canvas) {
    const H = (canvas.height = Math.round(innerHeight * 0.85));
    const W = (canvas.width = Math.round(H * 0.45));
    const c = canvas.getContext('2d');
    const cx = W / 2;
    // Gown, fading away at the bottom.
    let g = c.createLinearGradient(0, H * 0.18, 0, H);
    g.addColorStop(0, 'rgba(235,238,240,0.95)');
    g.addColorStop(0.7, 'rgba(210,215,220,0.5)');
    g.addColorStop(1, 'rgba(200,205,210,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(cx - W * 0.16, H * 0.2);
    c.bezierCurveTo(cx - W * 0.3, H * 0.4, cx - W * 0.45, H * 0.8, cx - W * 0.4, H);
    for (let i = 0; i <= 6; i++) c.lineTo(cx - W * 0.4 + (W * 0.8 * i) / 6, H - (i % 2 ? H * 0.05 : 0));
    c.bezierCurveTo(cx + W * 0.45, H * 0.8, cx + W * 0.3, H * 0.4, cx + W * 0.16, H * 0.2);
    c.closePath();
    c.fill();
    // Arms.
    c.strokeStyle = 'rgba(225,228,232,0.85)';
    c.lineWidth = W * 0.05;
    c.lineCap = 'round';
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(cx + s * W * 0.16, H * 0.22);
      c.quadraticCurveTo(cx + s * W * 0.3, H * 0.4, cx + s * W * 0.27, H * 0.56);
      c.stroke();
    }
    // Head.
    c.fillStyle = '#d7dadc';
    c.beginPath();
    c.ellipse(cx, H * 0.1, W * 0.12, H * 0.065, 0, 0, TAU);
    c.fill();
    c.fillStyle = '#000';
    for (const s of [-1, 1]) {
      c.beginPath();
      c.ellipse(cx + s * W * 0.045, H * 0.1, W * 0.025, H * 0.012, 0, 0, TAU);
      c.fill();
    }
    // Long black hair hanging over the face.
    c.strokeStyle = 'rgba(8,8,10,0.85)';
    for (let i = 0; i < 70; i++) {
      const x0 = cx + rand(-W * 0.13, W * 0.13);
      const skipFace = Math.abs(x0 - cx) < W * 0.07 && R() < 0.7;
      if (skipFace) continue;
      c.lineWidth = rand(1, 3);
      c.beginPath();
      c.moveTo(x0, H * 0.04);
      c.bezierCurveTo(x0 + rand(-10, 10), H * 0.15, x0 + rand(-15, 15) * 1.5, H * 0.25, x0 + rand(-20, 20) * 1.5, H * rand(0.28, 0.42));
      c.stroke();
    }
  }

  function ghost() {
    return scene((s) => {
      const fig = el('canvas', '', 'position:absolute;bottom:0;left:0;filter:blur(1.5px);opacity:0');
      drawGhost(fig);
      s.add(fig);
      const fromLeft = R() < 0.5;
      const peek = R() < 0.4;
      const W = innerWidth;
      const w = fig.width;
      const DURATION = peek ? 2200 : 1500;
      const x = fromLeft ? rand(0, W * 0.15) : rand(W * 0.85 - w, W - w);
      s.loop((t) => {
        if (t > DURATION) return false;
        const p = t / DURATION;
        if (peek) {
          // Stands still at the edge, fades in, then vanishes in a blink.
          fig.style.opacity = p < 0.8 ? Math.min(0.55, p) : 0;
          fig.style.transform = `translateX(${x}px)`;
        } else {
          const left = fromLeft ? -w + (W + w) * p : W - (W + w) * p;
          fig.style.opacity = Math.sin(Math.PI * p) * 0.5 * (R() < 0.1 ? 0.3 : 1);
          fig.style.transform = `translate(${left}px, ${Math.sin(t / 120) * 8}px)`;
        }
      });
    });
  }

  // ------------------------------------------------------------ eyes in the dark

  function eyes() {
    return scene((s) => {
      const W = innerWidth;
      const H = innerHeight;
      const x = R() < 0.5 ? rand(W * 0.08, W * 0.3) : rand(W * 0.7, W * 0.92);
      const y = rand(H * 0.2, H * 0.75);
      const shadow = s.add(el('div', 'layer', `background:radial-gradient(circle at ${x}px ${y}px, rgba(0,0,0,0.92) 0, rgba(0,0,0,0.75) 110px, rgba(0,0,0,0) 280px);opacity:0;transition:opacity .6s`));
      const pair = s.add(el('div', 'eye-pair', `left:${x}px;top:${y}px;opacity:0;transition:opacity .6s`));
      pair.innerHTML = '<div class="eye"><i></i></div><div class="eye"><i></i></div>';
      requestAnimationFrame(() => { shadow.style.opacity = '1'; pair.style.opacity = '1'; });
      const blink = () => { pair.classList.add('blink'); s.after(140, () => pair.classList.remove('blink')); };
      s.after(1500, blink);
      s.after(2500, blink);
      s.after(3700, () => { pair.style.transition = 'none'; pair.style.opacity = '0'; shadow.style.opacity = '0'; });
      s.after(4300, s.end);
    });
  }

  // ------------------------------------------------------------ text on screen

  function message(text, style) {
    text = String(text || '').trim() || 'I can see you';
    return scene((s) => {
      if (style === 'toast') {
        const toast = s.add(el('div', 'toast'));
        toast.innerHTML = '<div class="toast-icon">⚠️</div><div><div class="toast-title">System Notice <span>now</span></div><div class="toast-body"></div></div>';
        toast.querySelector('.toast-body').textContent = text;
        requestAnimationFrame(() => toast.classList.add('in'));
        s.after(6500, () => toast.classList.remove('in'));
        s.after(7100, s.end);
      } else if (style === 'big') {
        const msg = s.add(el('div', 'msg-big'));
        msg.textContent = text;
        s.loop((t) => {
          if (t > 4000) return false;
          const pop = Math.min(1, t / 160);
          const shake = t > 160 ? 6 : 0;
          msg.style.transform = `translate(${(R() - 0.5) * shake}px,${(R() - 0.5) * shake}px) scale(${0.3 + pop * 0.7})`;
          msg.style.opacity = t > 3600 ? 1 - (t - 3600) / 400 : 1;
        });
      } else {
        s.add(el('div', 'layer', 'background:radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0, rgba(0,0,0,0.92) 75%)'));
        const msg = s.add(el('div', 'msg-creepy'));
        msg.textContent = text;
        s.loop((t) => {
          if (t > 5500) return false;
          msg.style.opacity = R() < 0.06 ? 0.2 : Math.min(1, t / 600);
          msg.style.transform = `translate(${(R() - 0.5) * 4}px,${(R() - 0.5) * 4}px)`;
        });
      }
    });
  }

  // ------------------------------------------------------------ user media

  function showImage(src) {
    return scene((s) => {
      s.add(el('div', 'layer', 'background:rgba(0,0,0,0.6)'));
      const img = s.add(el('img', 'layer', 'object-fit:contain;width:100%;height:100%'));
      img.src = src;
      img.animate([{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1.05)', opacity: 1 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
      s.after(4000, s.end);
    });
  }

  function playVideo(src, volume, onError) {
    return scene((s) => {
      s.add(el('div', 'layer', 'background:#000'));
      const v = s.add(el('video', 'layer', 'object-fit:contain;width:100%;height:100%'));
      v.src = src;
      v.volume = volume;
      v.onended = () => s.end();
      v.onerror = () => { if (onError) onError(); s.end(); };
      v.play().catch(() => { if (onError) onError(); s.end(); });
      s.onEnd(() => { v.pause(); v.removeAttribute('src'); v.load(); });
      s.after(60000, s.end);
    });
  }

  function stopAll() {
    for (const s of [...active]) s.end();
  }

  return {
    jumpscare, flashbang, blackout, glitch, emojiRain, crash, crack, spiders, ghost, eyes, message,
    showImage, playVideo, stopAll, drawFace,
  };
})();

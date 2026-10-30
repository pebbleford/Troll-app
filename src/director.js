// Decides *when* effects fire: delayed triggers, "haunt mode" random
// scares and global settings like volume. The overlay decides *how*.

const HAUNT_POOL = [
  { id: 'knock' },
  { id: 'footsteps' },
  { id: 'whispers' },
  { id: 'eyes' },
  { id: 'ghost' },
  { id: 'flicker' },
  { id: 'heartbeat' },
  { id: 'say', text: 'behind you', voice: 'creepy' },
  { id: 'say', text: 'I can see you', voice: 'creepy' },
  { id: 'say', text: 'turn around', voice: 'creepy' },
];

const rand = (min, max) => min + Math.random() * (max - min);

function createDirector({ sendToOverlay, onState }) {
  const pending = new Map();
  let nextId = 1;
  let volume = 0.8;
  let haunt = false;
  let hauntTimer = null;

  function state() {
    return {
      volume,
      haunt,
      pending: [...pending.values()].map((p) => ({ id: p.id, label: p.label, at: p.at })),
    };
  }
  const changed = () => onState(state());

  function fire(fx) {
    sendToOverlay(fx);
  }

  function trigger(fx, delay, label) {
    let ms = 0;
    if (delay === 'random') ms = Math.round(rand(10, 90) * 1000);
    else if (Number.isFinite(delay)) ms = Math.max(0, Math.min(delay, 60 * 60 * 1000));

    if (!ms) return fire(fx);

    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      fire(fx);
      changed();
    }, ms);
    pending.set(id, { id, timer, label: label || fx.id, at: Date.now() + ms });
    changed();
  }

  function cancelPending(id) {
    for (const [key, p] of pending) {
      if (id == null || key === id) {
        clearTimeout(p.timer);
        pending.delete(key);
      }
    }
    changed();
  }

  function scheduleHaunt() {
    clearTimeout(hauntTimer);
    if (!haunt) return;
    hauntTimer = setTimeout(() => {
      fire(HAUNT_POOL[Math.floor(Math.random() * HAUNT_POOL.length)]);
      scheduleHaunt();
    }, rand(20, 75) * 1000);
  }

  function setHaunt(on) {
    haunt = !!on;
    scheduleHaunt();
    changed();
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0));
    fire({ id: 'volume', value: volume });
    changed();
  }

  function stopAll() {
    cancelPending();
    setHaunt(false);
    fire({ id: 'stop' });
  }

  return { trigger, cancelPending, setHaunt, setVolume, stopAll, state };
}

module.exports = { createDirector };

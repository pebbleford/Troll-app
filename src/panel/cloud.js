// Runs in the PC's setup window. If Firebase is configured, this signs in and
// relays commands between the cloud and the effect engine (main process), so
// the iPad can reach this PC from anywhere. Harmless no-op when not configured.

(() => {
  const $ = (id) => document.getElementById(id);
  const section = $('cloudSection');
  const cloud = window.TrollCloud;
  const bridge = window.cloudBridge;

  if (!cloud || !cloud.isConfigured()) {
    // Show the "set it up" hint and stop.
    if (section) section.dataset.state = 'off';
    return;
  }
  if (section) section.dataset.state = 'out';

  let heartbeat = null;
  let unsubCommands = null;
  let lastState = null;
  let lastMedia = null;

  function setUi(state, text) {
    if (!section) return;
    section.dataset.state = state;
    const s = $('cloudStatus');
    if (s && text) s.textContent = text;
  }

  async function pushPresence(online) {
    let lan = {};
    try { lan = await bridge.lanPresence(); } catch { /* ignore */ }
    await cloud.writeDoc('presence', { online, ...lan });
  }

  // Effect results coming out of the PC -> mirror them into the cloud so the
  // iPad sees the same state/media/app list it would over Wi-Fi.
  bridge.onPush((obj) => {
    if (!cloud.uid) return;
    switch (obj.type) {
      case 'state': lastState = obj.state; cloud.writeDoc('state', obj.state); break;
      case 'media': lastMedia = obj.list; cloud.writeDoc('media', obj.list); break;
      case 'apps': cloud.writeDoc('apps', { list: obj.list, error: obj.error || '' }); break;
      case 'soundMap': cloud.writeDoc('soundmap', obj.map || {}); break;
      case 'hello':
        lastState = obj.state; lastMedia = obj.media;
        cloud.writeDoc('state', obj.state);
        cloud.writeDoc('media', obj.media);
        cloud.writeDoc('soundmap', obj.soundMap || {});
        break;
      case 'closed':
      case 'error':
        cloud.writeDoc('notice', obj);
        break;
      case 'shutdown':
        pushPresence(false);
        break;
    }
  });

  async function onSignedIn() {
    setUi('in', 'Signed in — iPad can reach this PC from anywhere.');
    await pushPresence(true);
    clearInterval(heartbeat);
    heartbeat = setInterval(() => pushPresence(true), 25000);
    // Push whatever state we already have so a fresh iPad isn't blank.
    if (lastState) cloud.writeDoc('state', lastState);
    if (lastMedia) cloud.writeDoc('media', lastMedia);
    // Commands from the iPad -> run them on this PC.
    if (unsubCommands) unsubCommands();
    unsubCommands = cloud.watchCommands((msg) => bridge.sendCommand(msg));
  }

  function onSignedOut() {
    setUi('out', '');
    clearInterval(heartbeat);
    if (unsubCommands) { unsubCommands(); unsubCommands = null; }
  }

  (async () => {
    try {
      await cloud.init();
    } catch (e) {
      setUi('error', 'Could not load the cloud sign-in (no internet?).');
      console.error(e);
      return;
    }
    cloud.onUser((user) => (user ? onSignedIn() : onSignedOut()));

    const form = $('cloudForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('cloudSignIn');
        btn.disabled = true;
        setUi('out', 'Signing in…');
        try {
          await cloud.signIn($('cloudEmail').value, $('cloudPassword').value);
          $('cloudPassword').value = '';
        } catch (err) {
          setUi('error', friendly(err));
        } finally {
          btn.disabled = false;
        }
      });
    }
    $('cloudSignOut') && $('cloudSignOut').addEventListener('click', () => cloud.signOut());
  })();

  function friendly(err) {
    const c = (err && err.code) || '';
    if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Wrong email or password.';
    if (c.includes('network')) return 'No internet connection.';
    if (c.includes('too-many-requests')) return 'Too many tries — wait a minute.';
    return 'Sign-in failed: ' + (err.message || c);
  }
})();

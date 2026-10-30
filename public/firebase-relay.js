// Shared, optional cloud layer. Loaded by BOTH the PC setup window and the iPad
// remote. It only does anything if the user created firebase-config.js; without
// it, isConfigured() is false and nothing here touches the network.
//
// Roles:
//   - PC  writes presence/state/media/apps docs, reads the commands collection.
//   - iPad writes commands, reads presence/state/media/apps.
//
// The Firebase web SDK is pulled from Google's CDN only when init() is called.

window.TrollCloud = (() => {
  const VER = window.FIREBASE_SDK_VERSION || '10.14.1';
  const CDN = `https://www.gstatic.com/firebasejs/${VER}`;
  let sdk = null;   // the imported Firebase functions
  let db = null;
  let auth = null;
  let uid = null;

  function isConfigured() {
    const c = window.FIREBASE_CONFIG;
    return !!(c && c.apiKey && c.projectId && !/YOUR_API_KEY|REPLACE_ME|xxxxxxxx/i.test(c.apiKey));
  }

  async function init() {
    if (sdk) return;
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`),
    ]);
    sdk = { ...appMod, ...authMod, ...fsMod };
    const app = sdk.getApps().length ? sdk.getApp() : sdk.initializeApp(window.FIREBASE_CONFIG);
    auth = sdk.getAuth(app);
    // Keep the sign-in saved between launches.
    try { await sdk.setPersistence(auth, sdk.indexedDBLocalPersistence); }
    catch { try { await sdk.setPersistence(auth, sdk.browserLocalPersistence); } catch { /* memory only */ } }
    db = sdk.getFirestore(app);
  }

  function onUser(cb) {
    sdk.onAuthStateChanged(auth, (user) => { uid = user ? user.uid : null; cb(user); });
  }

  async function signIn(email, password) {
    await sdk.signInWithEmailAndPassword(auth, String(email).trim(), String(password));
  }

  function signOut() { return sdk.signOut(auth); }

  // ---- document helpers (one small doc per kind, under the user's own space)

  const pcDoc = (name) => sdk.doc(db, 'users', uid, 'pc', name);

  async function writeDoc(name, data) {
    if (!uid) return;
    try { await sdk.setDoc(pcDoc(name), { data, at: Date.now() }); } catch (e) { console.warn('cloud write', name, e.message); }
  }

  function watchDoc(name, cb) {
    return sdk.onSnapshot(pcDoc(name), (snap) => { if (snap.exists()) cb(snap.data()); }, (e) => console.warn('cloud watch', name, e.message));
  }

  // ---- command queue (iPad -> PC)

  async function sendCommand(msg) {
    if (!uid) return;
    try { await sdk.addDoc(sdk.collection(db, 'users', uid, 'commands'), { msg, at: Date.now() }); }
    catch (e) { console.warn('cloud command', e.message); }
  }

  // PC side: run cb(msg) for each queued command, then delete it. Ignores
  // commands older than 20s so a backlog from being offline can't replay.
  function watchCommands(cb) {
    const col = sdk.collection(db, 'users', uid, 'commands');
    return sdk.onSnapshot(col, (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type !== 'added') return;
        const d = ch.doc.data();
        if (d && d.msg && Date.now() - (d.at || 0) < 20000) cb(d.msg);
        sdk.deleteDoc(ch.doc.ref).catch(() => {});
      });
    }, (e) => console.warn('cloud commands', e.message));
  }

  return { isConfigured, init, onUser, signIn, signOut, writeDoc, watchDoc, sendCommand, watchCommands, get uid() { return uid; } };
})();

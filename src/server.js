// Tiny HTTP + WebSocket server. Serves the iPad remote control page and
// relays button presses to the Electron main process.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const MEDIA_TYPES = {
  '.png': ['image', 'image/png'],
  '.jpg': ['image', 'image/jpeg'],
  '.jpeg': ['image', 'image/jpeg'],
  '.gif': ['image', 'image/gif'],
  '.webp': ['image', 'image/webp'],
  '.bmp': ['image', 'image/bmp'],
  '.mp3': ['audio', 'audio/mpeg'],
  '.wav': ['audio', 'audio/wav'],
  '.ogg': ['audio', 'audio/ogg'],
  '.m4a': ['audio', 'audio/mp4'],
  '.aac': ['audio', 'audio/aac'],
  '.flac': ['audio', 'audio/flac'],
  '.mp4': ['video', 'video/mp4'],
  '.m4v': ['video', 'video/mp4'],
  '.webm': ['video', 'video/webm'],
  '.mov': ['video', 'video/quicktime'],
};

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

function mediaKind(name) {
  const t = MEDIA_TYPES[path.extname(name).toLowerCase()];
  return t ? t[0] : null;
}

// Keep uploaded names boring: no paths, no weird characters.
function safeName(name) {
  const base = path.basename(String(name || ''));
  const ext = path.extname(base).toLowerCase();
  const stem = path.basename(base, path.extname(base))
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .slice(0, 60) || 'upload';
  return stem + ext;
}

function listMedia(mediaDir) {
  let names = [];
  try { names = fs.readdirSync(mediaDir); } catch { return []; }
  return names
    .filter((n) => mediaKind(n))
    .map((n) => {
      const st = fs.statSync(path.join(mediaDir, n));
      return { name: n, kind: mediaKind(n), size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function startServer({ port, httpsPort, tls, code, publicDir, mediaDir, onMessage, onClientsChanged, onMedia, extraStatic = {} }) {
  const clients = new Set();

  function authed(url) {
    return (url.searchParams.get('code') || '').toUpperCase() === code;
  }

  function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  function serveStatic(res, file) {
    const type = STATIC_TYPES[path.extname(file)] || 'application/octet-stream';
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }

  function handleUpload(req, res, url) {
    const name = safeName(url.searchParams.get('name'));
    if (!mediaKind(name)) return sendJson(res, 400, { error: 'That file type is not supported.' });

    let finalName = name;
    const ext = path.extname(name);
    const stem = path.basename(name, ext);
    for (let i = 2; fs.existsSync(path.join(mediaDir, finalName)); i++) finalName = `${stem} ${i}${ext}`;

    const tmp = path.join(mediaDir, `.${finalName}.part`);
    const out = fs.createWriteStream(tmp);
    let bytes = 0;
    let failed = false;
    const fail = (status, msg) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rm(tmp, { force: true }, () => {});
      sendJson(res, status, { error: msg });
      req.destroy();
    };

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_UPLOAD_BYTES) fail(413, 'File is too big (200 MB max).');
    });
    req.on('error', () => fail(400, 'Upload interrupted.'));
    out.on('error', () => fail(500, 'Could not save the file on the PC.'));
    out.on('finish', () => {
      if (failed) return;
      fs.rename(tmp, path.join(mediaDir, finalName), (err) => {
        if (err) return fail(500, 'Could not save the file on the PC.');
        sendJson(res, 200, { ok: true, name: finalName });
        broadcastMedia();
      });
    });
    req.pipe(out);
  }

  const requestHandler = (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);

    if (p.startsWith('/api/')) {
      if (!authed(url)) return sendJson(res, 401, { error: 'Wrong code' });

      if (p === '/api/upload' && req.method === 'POST') return handleUpload(req, res, url);

      if (p.startsWith('/api/media/') && req.method === 'GET') {
        const name = path.basename(p.slice('/api/media/'.length));
        const t = MEDIA_TYPES[path.extname(name).toLowerCase()];
        const file = path.join(mediaDir, name);
        if (!t || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': t[1], 'Cache-Control': 'max-age=3600' });
        return fs.createReadStream(file).pipe(res);
      }
      return sendJson(res, 404, { error: 'Not found' });
    }

    // Public extras (e.g. the Firebase web config). These aren't secret, so
    // they're served without the code — the iPad needs them to sign in. When
    // the file doesn't exist (cloud not set up) we serve an empty script so the
    // iPad doesn't log a 404 for an optional feature.
    if (Object.prototype.hasOwnProperty.call(extraStatic, p)) {
      const file = extraStatic[p];
      return fs.readFile(file, (err, data) => {
        const type = STATIC_TYPES[path.extname(file)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        res.end(err ? '' : data);
      });
    }

    // Static files for the iPad remote.
    const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    const file = path.join(publicDir, path.normalize(rel));
    if (!file.startsWith(publicDir)) { res.writeHead(403); return res.end(); }
    serveStatic(res, file);
  };

  const server = http.createServer(requestHandler);
  // Optional HTTPS mirror, so the iPad can use its microphone (browsers only
  // allow getUserMedia on a secure origin).
  const secureServer = tls ? https.createServer(tls, requestHandler) : null;

  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!authed(url)) return ws.close(4001, 'Wrong code');
      wss.emit('connection', ws, req);
    });
  };
  server.on('upgrade', onUpgrade);
  if (secureServer) secureServer.on('upgrade', onUpgrade);

  wss.on('connection', (ws) => {
    clients.add(ws);
    onClientsChanged(clients.size);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg && typeof msg.type === 'string') onMessage(msg, ws);
    });
    ws.on('close', () => {
      clients.delete(ws);
      onClientsChanged(clients.size);
    });
  });

  // Drop dead connections (iPad went to sleep etc.)
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000);

  function broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  function broadcastMedia() {
    const list = listMedia(mediaDir);
    broadcast({ type: 'media', list });
    if (onMedia) onMedia(list);
  }

  // Pick up files dropped straight into the media folder too.
  let watchTimer = null;
  try {
    fs.watch(mediaDir, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(broadcastMedia, 400);
    });
  } catch { /* watching is a nice-to-have */ }

  // Listen on a free port starting at `start`, trying up to 10 above it.
  function listen(srv, start) {
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const tryOne = () => {
        const p = start + attempt;
        const onErr = (err) => {
          if (err.code === 'EADDRINUSE' && attempt < 10) { attempt++; tryOne(); }
          else reject(err);
        };
        srv.once('error', onErr);
        srv.listen(p, '0.0.0.0', () => { srv.removeListener('error', onErr); resolve(p); });
      };
      tryOne();
    });
  }

  return (async () => {
    const boundPort = await listen(server, port);
    let boundHttps = 0;
    if (secureServer) {
      try { boundHttps = await listen(secureServer, httpsPort || boundPort + 1); }
      catch (e) { console.error('HTTPS server failed to start (mic over Wi-Fi disabled):', e.message); }
    }
    return {
      port: boundPort,
      httpsPort: boundHttps,
      broadcast,
      broadcastMedia,
      listMedia: () => listMedia(mediaDir),
      close: () => { clearInterval(heartbeat); wss.close(); server.close(); if (secureServer) secureServer.close(); },
    };
  })();
}

module.exports = { startServer, listMedia, mediaKind };

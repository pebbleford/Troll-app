const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panel', {
  info: () => ipcRenderer.invoke('panel:info'),
  onStatus: (cb) => ipcRenderer.on('panel:status', (_e, s) => cb(s)),
  hide: () => ipcRenderer.send('panel:hide'),
  test: (id) => ipcRenderer.send('panel:test', id),
  openMedia: () => ipcRenderer.send('panel:open-media'),
  setAutolaunch: (on) => ipcRenderer.send('panel:set-autolaunch', on),
  micDevices: () => ipcRenderer.invoke('mic:devices'),
  setMicDevice: (d) => ipcRenderer.send('panel:set-mic-device', d),
  quit: () => ipcRenderer.send('panel:quit'),
});

// Bridge used only by the optional Firebase cloud relay (src/panel/cloud.js).
contextBridge.exposeInMainWorld('cloudBridge', {
  lanPresence: () => ipcRenderer.invoke('cloud:lan-presence'),
  sendCommand: (msg) => ipcRenderer.send('cloud:command', msg),
  onPush: (cb) => ipcRenderer.on('cloud:push', (_e, obj) => cb(obj)),
  saveUpload: (obj) => ipcRenderer.invoke('cloud:save-upload', obj),
});

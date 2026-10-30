const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panel', {
  info: () => ipcRenderer.invoke('panel:info'),
  onStatus: (cb) => ipcRenderer.on('panel:status', (_e, s) => cb(s)),
  hide: () => ipcRenderer.send('panel:hide'),
  test: (id) => ipcRenderer.send('panel:test', id),
  openMedia: () => ipcRenderer.send('panel:open-media'),
  quit: () => ipcRenderer.send('panel:quit'),
});

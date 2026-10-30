const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('troll', {
  onFx: (cb) => ipcRenderer.on('fx', (_e, fx) => cb(fx)),
  setVisible: (visible) => ipcRenderer.send('overlay:visible', visible),
  speakNative: (text, rate) => ipcRenderer.send('overlay:speak-native', { text, rate }),
});

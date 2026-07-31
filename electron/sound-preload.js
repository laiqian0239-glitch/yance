'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('yanceSound', Object.freeze({
  onPlay: callback => {
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('sound:play', listener);
    return () => ipcRenderer.removeListener('sound:play', listener);
  },
  report: payload => ipcRenderer.send('sound:result', payload || {})
}));

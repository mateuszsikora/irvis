const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('irvisDesktop', {
  concurrentWith: process.platform === 'darwin' ? ['browser'] : [],
  recordingStorage: (op, name, bytes, offset, length) =>
    ipcRenderer.invoke('recording:storage', op, name, bytes, offset, length),
  listDevices: () => ipcRenderer.invoke('capture:devices'),
  listModes: (device) => ipcRenderer.invoke('capture:modes', device),
  command: (id, value) => ipcRenderer.invoke('capture:command', id, value),
  start: (options) => ipcRenderer.invoke('capture:start', options),
  stop: () => ipcRenderer.invoke('capture:stop'),
  subscribe: (frame, error) => {
    const receive = (_event, value) => {
      try {
        frame(value);
      } finally {
        ipcRenderer.send('capture:ack');
      }
    };
    const fail = (_event, message) => error(message);
    ipcRenderer.on('capture:frame', receive);
    ipcRenderer.on('capture:error', fail);
    return () => {
      ipcRenderer.removeListener('capture:frame', receive);
      ipcRenderer.removeListener('capture:error', fail);
    };
  },
});

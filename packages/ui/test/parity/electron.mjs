import { app, BrowserWindow } from 'electron';
app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  return window.loadURL(process.env.IRVIS_PARITY_URL);
});
app.on('window-all-closed', () => app.quit());

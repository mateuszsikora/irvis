import { installRecordingStorage } from './recordings.js';
import { app, BrowserWindow, ipcMain, protocol, net, session } from 'electron';
import { spawn } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cameraProfiles } from '@irvis/core';
import {
  findFfmpeg,
  captureArgs,
  parseInputPixelFormat,
} from '../../../tools/capture-cli/src/ffmpeg.ts';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: process.env.IRVIS_TEST_CORS === '1',
    },
  },
]);
const root = resolve(__dirname, '../../web/dist');
let window;
let child;
let pending = false;
const trusted = (url) => url.startsWith('app://irvis/');
function stop() {
  const previous = child;
  child = undefined;
  pending = false;
  if (previous) {
    previous.kill();
    const timer = setTimeout(() => previous.kill('SIGKILL'), 2000);
    previous.once('close', () => clearTimeout(timer));
  }
}
async function boot() {
  await app.whenReady();
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'irvis' || !['GET', 'HEAD'].includes(request.method))
      return new Response('', { status: 403 });
    let file;
    try {
      file = resolve(
        root,
        '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
      );
    } catch {
      return new Response('', { status: 400 });
    }
    if (!file.startsWith(root + sep)) return new Response('', { status: 403 });
    try {
      const response = await net.fetch(pathToFileURL(file).href, { headers: request.headers });
      response.headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' app:; worker-src 'self' app:; connect-src 'self' app:; media-src 'self' app: blob:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'",
      );
      return response;
    } catch {
      return new Response('', { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(
      contents === window?.webContents && trusted(details.requestingUrl) && permission === 'media',
    ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, origin) =>
      contents === window?.webContents &&
      trusted(origin + (origin.endsWith('/') ? '' : '/')) &&
      permission === 'media',
  );
  window = new BrowserWindow({
    width: 1100,
    height: 850,
    webPreferences: {
      preload: resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', stop);
  window.on('closed', stop);
  function authorize(event) {
    if (
      event.sender !== window?.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !trusted(event.senderFrame.url)
    )
      throw new Error('Untrusted IPC sender');
  }
  const closeRecordings = installRecordingStorage(
    ipcMain,
    resolve(app.getPath('userData'), 'recordings'),
    authorize,
  );
  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      stop();
      void closeRecordings();
    }
  });
  window.webContents.on('render-process-gone', () => {
    void closeRecordings();
  });
  window.on('closed', () => {
    void closeRecordings();
  });
  ipcMain.handle('capture:start', (event, options) => {
    authorize(event);
    stop();
    if (process.platform !== 'darwin') throw new Error('M3 capture currently requires macOS.');
    const mode = cameraProfiles
      .find((p) => p.id === options?.profileId)
      ?.videoModes?.find((m) => m.id === options?.modeId);
    if (!mode?.layout || !Number.isSafeInteger(options.device) || options.device < 0)
      throw new Error('Invalid capture selection');
    const args = captureArgs({
      deviceIndex: options.device,
      width: mode.width,
      height: mode.height,
      fps: mode.fps,
      seconds: 3600,
      packetsPath: '/dev/null',
    });
    const proc = spawn(findFfmpeg(), ['-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    let buffer = Buffer.alloc(0),
      log = '',
      format = null;
    const size = mode.width * mode.height * 2;
    const sendError = (message) => {
      if (child === proc) {
        window.webContents.send('capture:error', message);
        stop();
      }
    };
    proc.stderr.on('data', (chunk) => {
      log = (log + chunk.toString()).slice(-32768);
      // Pipe chunks can end inside a pixel-format token. Keep the unfinished
      // suffix in log, but only let complete lines establish the input format.
      const complete = log.lastIndexOf('\n') + 1;
      format = parseInputPixelFormat(log.slice(0, complete)) ?? format;
      if (format && format !== 'yuyv422')
        sendError('Exact reference requires native yuyv422; received ' + format);
    });
    proc.stdout.on('data', (chunk) => {
      if (child !== proc) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= size) {
        const data = buffer.subarray(0, size);
        buffer = buffer.subarray(size);
        if (!pending && format === 'yuyv422') {
          pending = true;
          window.webContents.send('capture:frame', {
            kind: 'yuyv',
            width: mode.width,
            height: mode.height,
            timestamp: performance.now(),
            receivedAt: Date.now(),
            data: Uint8Array.from(data),
          });
        }
      }
    });
    proc.on('error', (error) => sendError(error.message));
    proc.on('close', (code) => sendError('Capture ended (' + code + '). ' + log.slice(-2000)));
  });
  ipcMain.handle('capture:stop', (event) => {
    authorize(event);
    stop();
  });
  ipcMain.on('capture:ack', (event) => {
    authorize(event);
    pending = false;
  });
  await window.loadURL('app://irvis/');
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', stop);
}
void boot();

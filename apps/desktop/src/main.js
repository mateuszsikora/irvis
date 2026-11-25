import {
  captureArgs,
  captureEndedMessage,
  captureReadPause,
  frameReader,
  listDevices,
  listModes,
  modesReader,
  pixelFormatMessage,
} from './capture.js';
import { openControl } from './control.js';
import { installRecordingStorage } from './recordings.js';
import { app, BrowserWindow, ipcMain, protocol, net, session } from 'electron';
import { spawn } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cameraProfiles, findVideoMode } from '@irvis/core';
import { parseInputPixelFormat, run } from '../../../tools/capture-cli/src/ffmpeg.ts';
import { bundledFfmpeg, locateFfmpeg } from './ffmpeg.js';

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
// A package keeps the web build, ffmpeg and the IOKit helper in its resources
// directory, outside app.asar, so that they can be fetched and spawned.
const resources = app.isPackaged ? process.resourcesPath : undefined;
const root = resources ? resolve(resources, 'web') : resolve(__dirname, '../../web/dist');
const ffmpeg = () => locateFfmpeg({ bundled: resources && bundledFfmpeg(resources) });
let window;
let child;
let pending = false;
let control;
let controlCleanup = Promise.resolve();
let generation = 0;
/**
 * Reads of a device's modes, one at a time. A capture start pauses them: the
 * probe must not hold the device while ffmpeg opens it, and DirectShow may not
 * let a second process open a device that is capturing at all.
 */
const modes = modesReader((device, signal) =>
  listModes(process.platform, device, ffmpeg, run, signal),
);
const trusted = (url) => url.startsWith('app://irvis/');
function stop() {
  generation++;
  if (control) controlCleanup = control.close().catch(() => {});
  control = undefined;
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
  ipcMain.handle('capture:devices', (event) => {
    authorize(event);
    return listDevices(process.platform, ffmpeg);
  });
  ipcMain.handle('capture:modes', (event, device) => {
    authorize(event);
    // A read replaced by a newer one answers with no modes (unknown).
    return modes.read(device);
  });
  ipcMain.handle('capture:command', async (event, id, value) => {
    authorize(event);
    if (!control) throw new Error('Camera control is unavailable');
    await control.command(id, value);
  });
  ipcMain.handle('capture:start', async (event, options) => {
    authorize(event);
    stop();
    const token = generation;
    // Released by the capture once it has the device, or here when none starts.
    const release = modes.pause();
    let started = false;
    try {
      started = await startCapture(options, token, release);
    } finally {
      if (!started) release();
    }
  });
  async function startCapture(options, token, release) {
    const profile = cameraProfiles.find((p) => p.id === options?.profileId);
    // A profile mode, or an image-only mode of any size the device offers.
    const mode =
      profile && typeof options?.modeId === 'string' && findVideoMode(profile, options.modeId);
    if (!mode) throw new Error('Invalid capture selection');
    // The profile describes the camera's USB commands only for the modes it lists;
    // another mode may belong to another camera, such as a built-in one. The same
    // fact chooses the advice when the camera lacks the mode.
    const profileMode = profile.videoModes.includes(mode);
    const args = captureArgs(process.platform, options.device, mode);
    const executable = ffmpeg();
    await controlCleanup;
    if (generation !== token) return;
    // USB access can be unavailable while the OS owns UVC. Video remains usable.
    if (profileMode) {
      try {
        const opened = await openControl(
          profile,
          process.platform === 'darwin'
            ? resolve(resources ?? __dirname, 'iokit-request')
            : undefined,
        );
        if (generation !== token) {
          opened.close();
          return;
        }
        control = opened;
        await opened.read();
        if (mode.enableCommand) await opened.command(mode.enableCommand);
      } catch (error) {
        if (generation !== token) return;
        control?.close();
        control = undefined;
        if (mode.enableCommand) throw error;
        // Video goes on without control; the reason is only logged.
        console.warn('Camera control is unavailable: ' + error.message);
      }
    }
    if (generation !== token) return;
    const proc = spawn(executable, ['-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    const readPause = captureReadPause(process.platform, release);
    let log = '',
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
      if (format) readPause.opened();
      if (format && format !== 'yuyv422') sendError(pixelFormatMessage(format, mode));
    });
    const read = frameReader(size, (data) => {
      if (pending || control?.busy || format !== 'yuyv422') return;
      pending = true;
      window.webContents.send('capture:frame', {
        kind: 'yuyv',
        cameraState: control?.snapshot,
        width: mode.width,
        height: mode.height,
        timestamp: performance.now(),
        receivedAt: Date.now(),
        // A copy: the reader fills the same buffer with the next frame.
        data: new Uint8Array(data),
      });
    });
    proc.stdout.on('data', (chunk) => {
      if (child === proc) read(chunk);
    });
    proc.on('error', (error) => {
      readPause.ended();
      sendError(error.message);
    });
    proc.on('close', (code) => {
      readPause.ended();
      sendError(captureEndedMessage(code, log, mode, profileMode));
    });
    return true;
  }
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

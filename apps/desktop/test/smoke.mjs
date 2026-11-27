import {
  IrvisWriter,
  IrvisReader,
  MemoryByteSink,
  memoryByteSource,
  cameraProfiles,
} from '@irvis/core';
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const dist = resolve('../web/dist');
const video = resolve(dist, 'smoke.webm');
const audioWorklet =
  '/assets/' +
  readdirSync(resolve(dist, 'assets')).find((name) => /^audio-worklet-.*\.js$/.test(name));
const worker =
  '/assets/' + readdirSync(resolve(dist, 'assets')).find((name) => /^worker-.*\.js$/.test(name));
execFileSync(
  process.env.IRVIS_FFMPEG || 'ffmpeg',
  ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=1', '-c:v', 'libvpx', video],
  { stdio: 'ignore' },
);
const scratch = mkdtempSync(resolve(tmpdir(), 'irvis-smoke-'));
const fake = resolve(scratch, 'ffmpeg.cjs');
writeFileSync(
  fake,
  `#!/usr/bin/env node
if (process.argv.includes('-list_devices')) {
  process.stderr.write('AVFoundation video devices:\\n[0] Test camera\\n');
  process.exit(0);
}
const fs = require('node:fs');
const path = require('node:path');
const marker = name => path.join(__dirname, name);
fs.writeFileSync(marker('pid'), String(process.pid));
const data = Buffer.alloc(256 * 384 * 2);
for(let i=1;i<data.length;i+=2) data[i]=75;
const format = fs.existsSync(marker('format')) ? fs.readFileSync(marker('format'), 'utf8') : 'yuyv422';
process.stderr.write('Input #0, avfoundation:\\n  Stream #0:0: Video: rawvideo (YUY2), ' + format.slice(0, 4), () => {
  fs.writeFileSync(marker('prefix-written'), '');
});
const timer = setInterval(() => {
  if (!fs.existsSync(marker('continue'))) return;
  clearInterval(timer);
  process.stderr.write(format.slice(4) + ', 256x384\\n');
  setTimeout(() => {
    process.stdout.write(data.subarray(0, 13));
    setTimeout(() => {
      process.stdout.write(data.subarray(13));
      // Real capture continues after a startup frame is dropped.
      const next = () => {
        if (process.stdout.write(data)) setTimeout(next, 100);
        else process.stdout.once('drain', () => setTimeout(next, 100));
      };
      setTimeout(next, 100);
    }, 20);
  }, 50);
}, 10);
setInterval(() => {}, 1000);
`,
  { mode: 0o755 },
);
const app = await electron.launch({
  args: [resolve('.')],
  env: { ...process.env, IRVIS_FFMPEG: fake },
});
try {
  const page = await app.firstWindow();
  const violations = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text());
  });
  await page.reload();
  await page.waitForSelector('h1');
  assert.equal(await page.locator('h1').textContent(), 'irvis');
  const audioSamples = await page.evaluate(async (url) => {
    // Check the packaged processor and CSP without a real-time audio device.
    const context = new OfflineAudioContext(1, 2048, 48000);
    let timer;
    try {
      await context.audioWorklet.addModule(url);
      const oscillator = context.createOscillator();
      const node = new AudioWorkletNode(context, 'irvis-microphone');
      oscillator.connect(node);
      node.connect(context.destination);
      const captured = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Packaged audio worklet did not run.')), 15000);
        node.port.onmessage = ({ data }) => {
          if (data.samples) {
            clearTimeout(timer);
            node.port.postMessage('ack');
            resolve({
              length: data.samples.length,
              hasSignal: data.samples.some((value) => value !== 0),
            });
          }
        };
      });
      oscillator.start();
      const [samples] = await Promise.all([captured, context.startRendering()]);
      return samples;
    } finally {
      clearTimeout(timer);
    }
  }, audioWorklet);
  assert.equal(audioSamples.length, 2048);
  assert.equal(audioSamples.hasSignal, true);
  const storageResult = await page.evaluate(async () => {
    const storage = window.irvisDesktop.recordingStorage;
    const name = `smoke-${crypto.randomUUID()}.irvis`;
    await storage('open', name);
    await storage('append', name, new Uint8Array([1, 2, 3]));
    await storage('flush', name);
    await storage('close', name);
    const size = await storage('size', name);
    const bytes = await storage('read', name, undefined, 1, 8);
    let rejected = false;
    try {
      await storage('open', '../escape.irvis');
    } catch {
      rejected = true;
    }
    await storage('remove', name);
    const audioName = name.replace('.irvis', '.audio-v2.pcm');
    await storage('open', audioName);
    await storage('append', audioName, new Uint8Array([1]));
    await storage('close', audioName);
    const audioListed = (await storage('list')).includes(audioName);
    await storage('remove', audioName);
    return { audioListed, size, bytes: [...bytes], rejected };
  });
  assert.deepEqual(storageResult, { audioListed: true, size: 3, bytes: [2, 3], rejected: true });
  // Photos in the app's directory, and copies through the system's save dialog,
  // answered here without a person.
  const copies = [resolve(scratch, 'copy.irvis'), resolve(scratch, 'copy.png')];
  await app.evaluate(({ dialog }, paths) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: paths.shift() });
  }, copies);
  const filesResult = await page.evaluate(async () => {
    const desktop = window.irvisDesktop;
    const photo = `irvis-smoke-${crypto.randomUUID()}.png`;
    await desktop.photoStorage('save', photo, new Uint8Array([5, 6]), 1_000_000_000_000);
    const listed = (await desktop.photoStorage('list')).find((item) => item.name === photo);
    const recording = `smoke-${crypto.randomUUID()}.irvis`;
    await desktop.recordingStorage('open', recording);
    await desktop.recordingStorage('append', recording, new Uint8Array([7, 8, 9]));
    await desktop.recordingStorage('close', recording);
    const copied = await desktop.saveAs('copy.irvis', { kind: 'recordings', name: recording });
    const written = await desktop.saveAs('copy.png', new Uint8Array([1]));
    await desktop.recordingStorage('remove', recording);
    await desktop.photoStorage('remove', photo);
    const gone = !(await desktop.photoStorage('list')).some((item) => item.name === photo);
    return {
      photo: listed && { createdAt: listed.createdAt, bytes: [...listed.bytes] },
      copied,
      written,
      gone,
    };
  });
  assert.deepEqual(filesResult, {
    photo: { createdAt: 1_000_000_000_000, bytes: [5, 6] },
    copied: true,
    written: true,
    gone: true,
  });
  assert.deepEqual([...readFileSync(resolve(scratch, 'copy.irvis'))], [7, 8, 9]);
  assert.deepEqual([...readFileSync(resolve(scratch, 'copy.png'))], [1]);

  const sink = new MemoryByteSink();
  const profile = cameraProfiles[0];
  const writer = await IrvisWriter.create(sink, {
    profile,
    width: 1,
    height: 1,
    fps: 1,
    path: 'exact',
    threshold: 0,
  });
  await writer.appendFrame({
    width: 1,
    height: 1,
    raw: new Uint16Array([19000]),
    timestamp: 0,
    uncertain: null,
    conversion: profile.conversions[0].conversion,
    cameraState: { origin: 'assumed', values: {} },
  });
  await writer.flush();
  const unfinishedName = await page.evaluate(
    async (bytes) => {
      const name = `smoke-reload-${crypto.randomUUID()}.irvis`;
      await window.irvisDesktop.recordingStorage('open', name);
      await window.irvisDesktop.recordingStorage('append', name, new Uint8Array(bytes));
      return name; // Deliberately leave the sink open and without an index.
    },
    [...sink.bytes()],
  );
  await page.reload();
  await page.waitForSelector('h1');
  const recoveredBytes = await page.evaluate(async (name) => {
    const storage = window.irvisDesktop.recordingStorage;
    const size = await storage('size', name);
    return [...(await storage('read', name, undefined, 0, size))];
  }, unfinishedName);
  const recovered = await IrvisReader.open(memoryByteSource(new Uint8Array(recoveredBytes)));
  assert.equal(recovered.indexed, false);
  assert.equal((await recovered.readFrame(0)).frame.raw[0], 19000);
  await page.evaluate(async (name) => {
    await window.irvisDesktop.recordingStorage('remove', name);
    // A new document can start a new recording after recovering the old one.
    await window.irvisDesktop.recordingStorage('open', name);
    await window.irvisDesktop.recordingStorage('close', name);
    await window.irvisDesktop.recordingStorage('remove', name);
  }, unfinishedName);

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Colour bounds"]')?.textContent.includes('°C'),
  );
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Capture diagnostics' }).click();
  assert.equal(await page.evaluate(() => typeof window.irvisDesktop.start), 'function');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const prefs = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.nodeIntegration, false);
  await page.evaluate(async (workerPath) => {
    localStorage.setItem('smoke', 'ok');
    if (localStorage.getItem('smoke') !== 'ok') throw new Error('Storage failed');
    localStorage.removeItem('smoke');
    if (!(await fetch('/index.html')).ok) throw new Error('Fetch failed');
    await new Promise((resolve, reject) => {
      const w = new Worker(workerPath, { type: 'module' });
      const timer = setTimeout(() => {
        w.terminate();
        reject(new Error('Worker timeout'));
      }, 5000);
      w.onmessage = () => {
        clearTimeout(timer);
        w.terminate();
        resolve();
      };
      w.onerror = (event) => {
        clearTimeout(timer);
        w.terminate();
        reject(new Error(event.message));
      };
    });
    const video = document.createElement('video');
    video.muted = true;
    video.src = '/smoke.webm';
    document.body.append(video);
    await video.play();
    if (video.readyState < 2) throw new Error('Video not ready');
    video.remove();
  }, worker);
  assert.deepEqual(violations, []);
  if (process.platform === 'darwin') {
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
      }
    };
    async function waitUntil(predicate, message) {
      for (let tries = 0; tries < 100; tries++) {
        if (predicate()) return;
        await page.waitForTimeout(50);
      }
      assert.fail(message);
    }
    async function releaseFormat() {
      await waitUntil(
        () => existsSync(resolve(scratch, 'prefix-written')),
        'ffmpeg did not write the format prefix',
      );
      const pid = Number(readFileSync(resolve(scratch, 'pid'), 'utf8'));
      await page.waitForTimeout(200);
      assert.ok(alive(pid), 'A partial pixel-format token must not stop ffmpeg');
      writeFileSync(resolve(scratch, 'continue'), '');
      return pid;
    }

    await page.getByRole('button', { name: 'Start reference', exact: true }).click();
    const firstPid = await releaseFormat();
    await page.waitForSelector('[aria-label="Comparison metrics"]', { timeout: 15000 });
    const metrics = JSON.parse(
      await page.locator('[aria-label="Comparison metrics"]').textContent(),
    );
    assert.equal(metrics.exactMatch, 1);
    const downloadPath = resolve(scratch, 'frame-pair.json');
    await app.evaluate(({ session }, path) => {
      // Electron owns this download; Playwright's page download event is not emitted.
      globalThis.irvisSmokeDownload = new Promise((resolve) => {
        const onDownload = (_event, item) => {
          item.setSavePath(path);
          item.once('done', (_event, state) => {
            clearTimeout(timer);
            resolve(state);
          });
        };
        const timer = setTimeout(() => {
          session.defaultSession.removeListener('will-download', onDownload);
          resolve('timeout');
        }, 15000);
        session.defaultSession.once('will-download', onDownload);
      });
    }, downloadPath);
    await page.getByRole('button', { name: 'Download frame pair', exact: true }).click();
    const downloadState = await app.evaluate(async () => {
      const state = await globalThis.irvisSmokeDownload;
      delete globalThis.irvisSmokeDownload;
      return state;
    });
    assert.equal(downloadState, 'completed', 'Frame-pair download did not complete');
    const dump = JSON.parse(readFileSync(downloadPath, 'utf8'));
    assert.equal(dump.pair.metrics.exactMatch, 1);
    assert.equal(dump.reference.data.length, 256 * 384 * 2);
    await page.reload();
    await page.locator('summary').filter({ hasText: 'Capture diagnostics' }).click();
    await waitUntil(() => !alive(firstPid), 'Reload left the previous ffmpeg process running');
    assert.equal(
      await page.getByRole('button', { name: 'Start reference', exact: true }).isEnabled(),
      true,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Stop reference', exact: true }).isEnabled(),
      false,
    );
    for (const name of ['prefix-written', 'continue', 'pid']) rmSync(resolve(scratch, name));
    await page.getByRole('button', { name: 'Start reference', exact: true }).click();
    const secondPid = await releaseFormat();
    assert.notEqual(secondPid, firstPid);
    await page.waitForSelector('[aria-label="Comparison metrics"]', { timeout: 15000 });
    await page.getByRole('button', { name: 'Stop reference', exact: true }).click();
    await waitUntil(() => !alive(secondPid), 'Stop left the restarted ffmpeg process running');
    for (const name of ['prefix-written', 'continue', 'pid']) rmSync(resolve(scratch, name));
    writeFileSync(resolve(scratch, 'format'), 'nv12');
    await page.getByRole('button', { name: 'Start reference', exact: true }).click();
    const invalidPid = await releaseFormat();
    await page
      .getByText('Exact reference requires native yuyv422; received nv12', { exact: true })
      .waitFor();
    await waitUntil(() => !alive(invalidPid), 'Unsupported native format did not stop ffmpeg');
  }

  await assert.rejects(() =>
    page.evaluate(() =>
      window.irvisDesktop.start({ profileId: 'invalid', modeId: 'invalid', device: 0 }),
    ),
  );
  console.log(
    'desktop smoke: build, bridge isolation, module Worker, fetch, localStorage, video and CSP passed',
  );
} finally {
  await app.close();
  rmSync(scratch, { recursive: true, force: true });
  rmSync(video, { force: true });
}

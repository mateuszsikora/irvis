import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const dist = resolve('../web/dist');
const video = resolve(dist, 'smoke.webm');
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
    setTimeout(() => process.stdout.write(data.subarray(13)), 20);
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
      session.defaultSession.once('will-download', (_event, item) => item.setSavePath(path));
    }, downloadPath);
    await page.getByRole('button', { name: 'Download frame pair', exact: true }).click();
    for (let tries = 0; tries < 100 && !existsSync(downloadPath); tries++)
      await page.waitForTimeout(100);
    const dump = JSON.parse(readFileSync(downloadPath, 'utf8'));
    assert.equal(dump.pair.metrics.exactMatch, 1);
    assert.equal(dump.reference.data.length, 256 * 384 * 2);
    await page.reload();
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

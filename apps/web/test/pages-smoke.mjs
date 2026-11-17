// Opens the web build the way GitHub Pages serves it and checks what a static
// HTTPS host without custom headers has to give the app: every file found
// under the site's path, camera access, the module Workers, and recordings in
// OPFS. Run from the repository root:
//
//   node apps/web/test/pages-smoke.mjs [site URL, e.g. https://mateuszsikora.github.io/irvis/]
//
// Without a URL it serves apps/web/dist (npm run build --workspace @irvis/web)
// under /irvis/ on localhost, with no headers but Content-Type, as Pages
// would. The camera is Chromium's fake device, fed with grey frames of the
// first profile's first video mode (diagnostics ask for its exact size).
// Why and how: docs/features/web-app-technical.md#pages-smoke-check
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import { cameraProfiles } from '@irvis/core';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

function serve(root, base) {
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.startsWith(base)
        ? resolve(
            root,
            '.' + (path.endsWith('/') ? path + 'index.html' : path).slice(base.length - 1),
          )
        : '';
      if (!file.startsWith(root + sep)) return response.writeHead(404).end();
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((done) => server.listen(0, 'localhost', () => done(server)));
}

let url = process.argv[2];
let server;
if (!url) {
  server = await serve(resolve('apps/web/dist'), '/irvis/');
  url = `http://localhost:${server.address().port}/irvis/`;
}
const site = new URL(url);
const { width, height, fps } = cameraProfiles[0].videoModes[0];
const scratch = await mkdtemp(join(tmpdir(), 'irvis-pages-smoke-'));
const video = join(scratch, 'camera.y4m');
const frame = Buffer.concat([Buffer.from('FRAME\n'), Buffer.alloc((width * height * 3) / 2, 128)]);
await writeFile(
  video,
  Buffer.concat([
    Buffer.from(`YUV4MPEG2 W${width} H${height} F${fps}:1 Ip A1:1 C420jpeg\n`),
    ...Array(fps).fill(frame),
  ]),
);
const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`,
  ],
});
const problems = [];
try {
  const context = await browser.newContext({ permissions: ['camera'] });
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) =>
    problems.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`${response.url()}: HTTP ${response.status()}`);
  });
  await page.goto(site.href);
  await page.locator('h1').waitFor();
  assert.equal((await page.locator('h1').textContent()).trim(), 'irvis');
  assert.equal(await page.evaluate(() => globalThis.isSecureContext), true, 'not a secure context');

  // Recording storage: the OPFS path (not the memory fallback), written by
  // the storage module Worker, and listed again after the recording stops.
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByText('Demo running', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Check recording storage' }).click();
  await page.getByText(/Estimated uncompressed capacity: \d+ seconds/).waitFor();
  await page.getByRole('button', { name: 'Record .irvis', exact: true }).click();
  await page.getByText(/Recording ·/).waitFor();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).waitFor();
  const stored = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('irvis-recordings');
    const files = [];
    for await (const [name, handle] of directory.entries())
      files.push({ name, size: (await handle.getFile()).size });
    return files;
  });
  assert.ok(
    stored.some(({ name, size }) => name.endsWith('.irvis') && size > 0),
    `no recording in OPFS: ${JSON.stringify(stored)}`,
  );
  await page.getByRole('button', { name: 'Delete recording', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();

  // Camera: browser diagnostics open the fake camera and read its frames in
  // the diagnostics module Worker.
  await page.locator('summary').filter({ hasText: 'Capture diagnostics' }).click();
  await page.getByRole('button', { name: 'Start diagnostics', exact: true }).click();
  await page.getByText(/frames: [1-9]/).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Stop', exact: true }).last().click();

  assert.deepEqual(problems, []);
  console.log(
    `pages smoke (${site.href}): files, secure context, OPFS recording, module Workers and camera passed`,
  );
} catch (error) {
  // A wrong base shows up first as missing files, then as a timeout.
  if (problems.length) console.error(problems.join('\n'));
  throw error;
} finally {
  await browser.close();
  server?.close();
  await rm(scratch, { recursive: true, force: true });
}

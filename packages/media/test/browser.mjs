import { IrvisWriter, MemoryByteSink, cameraProfiles } from '@irvis/core';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const server = await createServer({
  root: resolve('apps/web'),
  server: { port: 4179, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
try {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  await context.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    globalThis.testStreams = [];
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await original(options);
      globalThis.testStreams.push(stream);
      return stream;
    };
  });
  await page.goto('http://localhost:4179');
  const sink = new MemoryByteSink();
  const correction = (offsetKelvin) => ({ emissivity: 1, reflectedCelsius: 25, offsetKelvin });
  const writer = await IrvisWriter.create(sink, {
    profile: cameraProfiles[0],
    width: 8,
    height: 1,
    fps: 1,
    path: 'exact',
    threshold: 0,
    viewState: { correction: correction(0) },
  });
  const thermal = {
    width: 8,
    height: 1,
    raw: new Uint16Array([30, 30, 30, 30, 40, 40, 40, 40]),
    uncertain: null,
    conversion: { kind: 'linear', scale: 1, offset: 0 },
    cameraState: { origin: 'assumed', values: {} },
  };
  await writer.appendFrame({ ...thermal, timestamp: 0 });
  await writer.appendViewState(1000, { correction: correction(5) });
  await writer.appendFrame({ ...thermal, timestamp: 1000 });
  await writer.close();
  const keyErrors = [];
  page.on('console', (message) => {
    if (message.text().includes('same key')) keyErrors.push(message.text());
  });
  await page.getByLabel('Open recording', { exact: true }).setInputFiles({
    name: 'correction-change.irvis',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(sink.bytes()),
  });
  await page.getByRole('button', { name: 'Play recording', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await page.getByText('Point 1: 30.0 °C', { exact: true }).waitFor();
  await page.getByLabel('Position', { exact: true }).press('End');
  await page.getByText('Point 1: 35.0 °C', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Offset (°C)', { exact: true }).inputValue(), '5');
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await page.getByLabel('x (%)', { exact: true }).fill('100');
  await page.waitForFunction(
    () =>
      globalThis.document.querySelector('[aria-label="Measurement readings"]')?.textContent ===
      'Point 1: 35.0 °C\nPoint 2: 45.0 °C',
  );
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await page.getByText('Point 1: 35.0 °C', { exact: true }).waitFor();
  await page.getByLabel('Position', { exact: true }).press('Home');
  await page.getByText('Point 1: 30.0 °C', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await page.waitForFunction(
    () =>
      globalThis.document.querySelector('[aria-label="Measurement readings"]')?.textContent ===
      'Point 1: 30.0 °C\nPoint 3: 30.0 °C',
  );
  assert.deepEqual(keyErrors, []);
  await page.reload();

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByText('Demo running', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Check recording storage' }).click();
  await page.getByRole('button', { name: 'Record .irvis', exact: true }).click();
  await page.getByText(/Recording ·/).waitFor();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Play recording', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await page.getByRole('button', { name: 'Pause recording', exact: true }).click();
  await page.evaluate(() => {
    globalThis.showSaveFilePicker = undefined;
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
  const mp4 = await download;
  assert.match(mp4.suggestedFilename(), /\.mp4$/);
  const filename = await mp4.path();
  assert.ok(filename);
  const streams = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', filename], {
      encoding: 'utf8',
    }),
  ).streams;
  assert.deepEqual(
    streams.map((stream) => stream.codec_type),
    ['video'],
  );
  await page.getByRole('button', { name: 'Delete recording', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).waitFor({ state: 'detached' });
  await page.reload();
  assert.equal(await page.getByRole('button', { name: 'Open', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByText('Demo running', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Check recording storage' }).click();
  await page.getByLabel('Microphone (Off by default)').check();
  await page.getByRole('button', { name: 'Record .irvis', exact: true }).click();
  await page.getByText(/Recording ·/).waitFor();
  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      globalThis.testStreams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')),
    ),
    true,
  );
  await page.evaluate(() => {
    globalThis.showSaveFilePicker = undefined;
  });
  const withAudio = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
  const audioFile = await (await withAudio).path();
  const audioStreams = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', audioFile], {
      encoding: 'utf8',
    }),
  ).streams;
  assert.ok(audioStreams.some((stream) => stream.codec_name === 'aac'));
  await page.getByRole('button', { name: 'Delete recording', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Capture photo', exact: true }).click();
  await page.getByRole('button', { name: /^Analyze irvis-/ }).waitFor();
  await page.getByRole('button', { name: /^Annotate irvis-/ }).click();
  await page.getByLabel('Annotation text (empty to draw)').fill('Test note');
  await page.getByLabel('Annotation canvas').click({ position: { x: 20, y: 20 } });
  await page.getByRole('button', { name: 'Undo annotation' }).click();
  await page.getByRole('button', { name: 'Redo annotation' }).click();
  const flat = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export flattened PNG' }).click();
  assert.match((await flat).suggestedFilename(), /annotated-flat\.png$/);
  await page.getByRole('button', { name: /^Analyze irvis-/ }).click();
  await page.getByText('Photo analysis', { exact: false }).first().waitFor();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByText('Demo running', { exact: true }).waitFor();
  await page.getByLabel('Microphone (Off by default)').uncheck();
  await page.getByRole('button', { name: 'Record .irvis', exact: true }).click();
  await page.getByText(/Recording ·/).waitFor();
  await page.waitForTimeout(1300);
  await page.reload();
  await page.getByRole('button', { name: 'Open', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page
    .getByText('Recovered complete frames from an unfinished recording. Download a backup.', {
      exact: true,
    })
    .waitFor();
  await page.getByRole('button', { name: 'Delete recording', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByText('Demo running', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Check recording storage' }).click();
  await page.getByLabel('Microphone (Off by default)').check();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await page.getByRole('button', { name: 'Record .irvis', exact: true }).click();
  await page.getByText(/Recording error:.*Permission denied/).waitFor();
  assert.equal(await page.getByText(/Recording ·/).count(), 0);
  console.log(
    'media browser: OPFS recording, playback, silent/audio MP4, microphone cleanup, photo annotations and deletion passed',
  );
} finally {
  await browser.close();
  await server.close();
}

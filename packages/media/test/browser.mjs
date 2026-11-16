import { IrvisWriter, MemoryByteSink, cameraProfiles } from '@irvis/core';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { resolve } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  let page = await context.newPage();
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
  // An audio pulse and a white frame at the same host timestamp must survive AAC/H.264 muxing.
  const synchronized = await page.evaluate(
    async (root) => {
      const { audioHeader, audioPacket } = await import(
        `${root}/packages/media/src/audio-sidecar.ts`
      );
      const { exportMp4 } = await import(`${root}/packages/media/src/export.ts`);
      const { IrvisWriter, MemoryByteSink, memoryByteSource, cameraProfiles } = await import(
        `${root}/packages/core/src/index.ts`
      );
      const sink = new MemoryByteSink();
      const writer = await IrvisWriter.create(sink, {
        profile: cameraProfiles[0],
        width: 1,
        height: 1,
        fps: 10,
        path: 'exact',
        threshold: 0,
      });
      for (let i = 0; i < 10; i++) {
        // Missing frame at 200 ms must not compress either stream's timeline.
        if (i === 2) continue;
        await writer.appendFrame({
          width: 1,
          height: 1,
          raw: new Uint16Array([i]),
          uncertain: null,
          timestamp: 1000 + i * 100,
          conversion: { kind: 'linear', scale: 1, offset: 0 },
          cameraState: { origin: 'assumed', values: {} },
        });
      }
      await writer.close();
      const packets = [audioHeader(48000)];
      // Microphone starts 200 ms before the first video frame; pulse begins at output 600 ms.
      for (let at = 800; at < 2200; at += 50) {
        const samples = new Float32Array(2400);
        if (at === 1600)
          for (let i = 0; i < samples.length; i++)
            samples[i] = 0.7 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
        packets.push(audioPacket(at, samples));
      }
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = canvas.height = 32;
      return Array.from(
        await exportMp4(
          memoryByteSource(sink.bytes()),
          canvas,
          (frame) => {
            const context = canvas.getContext('2d');
            context.fillStyle = frame.raw[0] === 6 ? 'white' : 'black';
            context.fillRect(0, 0, 32, 32);
          },
          new Blob(packets, { type: 'application/x-irvis-audio' }),
        ),
      );
    },
    `/@fs${resolve('.')}`,
  );
  const scratch = mkdtempSync(resolve(tmpdir(), 'irvis-sync-'));
  try {
    const file = resolve(scratch, 'sync.mp4');
    writeFileSync(file, new Uint8Array(synchronized));
    const audio = execFileSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      file,
      '-map',
      '0:a',
      '-f',
      'f32le',
      '-ac',
      '1',
      '-ar',
      '44100',
      '-',
    ]);
    let first = -1;
    let last = -1;
    for (let i = 0; i < audio.length / 4; i++)
      if (Math.abs(audio.readFloatLE(i * 4)) > 0.1) {
        if (first < 0) first = i / 44100;
        last = i / 44100;
      }
    assert.ok(Math.abs(first - 0.6) < 0.03, `AAC pulse starts at ${first}`);
    assert.ok(Math.abs(last - 0.65) < 0.03, `AAC pulse ends at ${last}`);
    const video = execFileSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      'fps=10,scale=1:1',
      '-pix_fmt',
      'gray',
      '-f',
      'rawvideo',
      '-',
    ]);
    assert.equal(
      video.findIndex((value) => value > 200),
      6,
    );
    assert.ok(
      Math.abs(audio.length / 4 / 44100 - 1) < 0.05,
      `Decoded AAC duration ${audio.length / 4 / 44100}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const workletTiming = await page.evaluate(
    async (root) => {
      const { startMicrophone } = await import(`${root}/packages/media/src/microphone.ts`);
      const { alignAudio } = await import(`${root}/packages/media/src/audio-sidecar.ts`);
      const { MemoryByteSink } = await import(`${root}/packages/core/src/index.ts`);
      const original = navigator.mediaDevices.getUserMedia;
      const generator = new globalThis.AudioContext();
      const destination = generator.createMediaStreamDestination();
      const oscillator = generator.createOscillator();
      const gain = generator.createGain();
      gain.gain.value = 0;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      await generator.resume();
      navigator.mediaDevices.getUserMedia = async () => destination.stream;
      try {
        const sink = new MemoryByteSink();
        let error;
        const recording = await startMicrophone(sink, (e) => {
          error = String(e);
        });
        const origin = performance.now();
        gain.gain.setValueAtTime(0.5, generator.currentTime + 0.3);
        gain.gain.setValueAtTime(0, generator.currentTime + 0.4);
        await new Promise((resolve) => setTimeout(resolve, 700));
        await recording.stop();
        if (error) throw new Error(error);
        const { samples, sampleRate } = alignAudio(sink.bytes(), origin, 700);
        const first = samples.findIndex((value) => Math.abs(value) > 0.1) / sampleRate;
        return {
          first,
          ended: destination.stream.getTracks().every((track) => track.readyState === 'ended'),
        };
      } finally {
        navigator.mediaDevices.getUserMedia = original;
        await generator.close();
      }
    },
    `/@fs${resolve('.')}`,
  );
  assert.ok(Math.abs(workletTiming.first - 0.3) < 0.05, `Captured pulse at ${workletTiming.first}`);
  assert.equal(workletTiming.ended, true);
  const backpressure = await page.evaluate(
    async (root) => {
      const { startMicrophone } = await import(`${root}/packages/media/src/microphone.ts`);
      let calls = 0;
      let release;
      let failed;
      const failure = new Promise((resolve) => {
        failed = resolve;
      });
      const recording = await startMicrophone(
        {
          append: () =>
            ++calls === 1
              ? Promise.resolve()
              : new Promise((resolve) => {
                  release = resolve;
                }),
          flush: () => Promise.resolve(),
          close: () => Promise.resolve(),
        },
        (error) => failed(String(error)),
      );
      const timer = setTimeout(() => failed('Timed out waiting for audio backpressure.'), 3000);
      const error = await failure;
      clearTimeout(timer);
      const ended = globalThis.testStreams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === 'ended'),
      );
      release?.();
      let stopError;
      try {
        await recording.stop();
      } catch (error) {
        stopError = String(error);
      }
      return { error, stopError, ended, calls };
    },
    `/@fs${resolve('.')}`,
  );
  assert.match(backpressure.error, /Audio storage is too slow/);
  assert.match(backpressure.stopError, /Audio storage is too slow/);
  assert.equal(backpressure.ended, true);
  assert.equal(backpressure.calls, 2); // header plus one blocked append; no growing disk queue
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
  const audioStream = audioStreams.find((stream) => stream.codec_name === 'aac');
  const videoStream = audioStreams.find((stream) => stream.codec_type === 'video');
  assert.ok(audioStream);
  assert.equal(audioStream.channels, 1);
  assert.equal(audioStream.sample_rate, '44100');
  assert.ok(Math.abs(Number(audioStream.duration) - Number(videoStream.duration)) < 0.05);
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
  const crashedAt = await page.evaluate(() => performance.now());
  const devtools = await context.newCDPSession(page);
  const crashed = page.waitForEvent('crash');
  void devtools.send('Page.crash').catch(() => {});
  await crashed;
  await page.close();
  page = await context.newPage();
  await page.goto('http://localhost:4179');
  const recoveredAt = await page.evaluate(
    async (root) => {
      const { createBrowserRecordingStorage } = await import(`${root}/packages/media/src/index.ts`);
      const { IrvisReader } = await import(`${root}/packages/core/src/index.ts`);
      const file = (await createBrowserRecordingStorage().list()).find((file) =>
        file.name.endsWith('.irvis'),
      );
      const reader = await IrvisReader.open(file.source);
      return reader.frames.at(-1).timestamp;
    },
    `/@fs${resolve('.')}`,
  );
  assert.ok(crashedAt - recoveredAt < 1000, `Crash lost ${crashedAt - recoveredAt} ms`);
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

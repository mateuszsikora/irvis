// The .irvis codec benchmark: `npm run bench:irvis`. Encodes synthetic
// or captured scenes through IrvisWriter and prints actual bytes, MB per minute,
// block modes, timing and the largest error. How to read it:
// docs/irvis-format.md#benchmark
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { profile } from '../../src/cameras/infiray-p2pro/profile.ts';
import { decodeYuyvRaw } from '../../src/yuyv.ts';
import { IrvisReader } from '../../src/irvis/reader.ts';
import { IrvisWriter } from '../../src/irvis/writer.ts';
import { MemoryByteSink, memoryByteSource } from '../../src/memory.ts';
import {
  type Scene,
  maxError,
  movingHandScene,
  staticScene,
  thermalFrame,
} from '../irvis-scenes.ts';

/** `--level <0-9>`: the deflate level, default the writer's. */
function levelArgument(): 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | undefined {
  const at = process.argv.indexOf('--level');
  if (at < 0) return undefined;
  const level = Number(process.argv[at + 1]);
  if (!Number.isInteger(level) || level < 0 || level > 9) {
    throw new Error('--level takes an integer from 0 to 9');
  }
  return level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}
const LEVEL = levelArgument();

/** Thresholds in raw units: 0, 0.125 K and 0.25 K under the P2 Pro conversion (1/64 K). */
const requestedThreshold = integerArgument('--threshold', 0);
if (requestedThreshold !== undefined && requestedThreshold > 32767) {
  throw new Error('--threshold must be at most 32767');
}
const THRESHOLDS = requestedThreshold === undefined ? [0, 8, 16] : [requestedThreshold];
/** 10 s at 25 fps, one keyframe interval. */
const FRAMES = 250;

interface Row {
  scene: string;
  threshold: number;
  bytes: number;
  frames: number;
  mbPerMinute: number;
  skip: number;
  dense: number;
  sparse: number;
  encodeMs: number;
  decodeMs: number;
  maxError: number;
}

async function measure(name: string, scene: Scene, threshold: number): Promise<Row> {
  const sink = new MemoryByteSink();
  const writer = await IrvisWriter.create(sink, {
    profile: { id: profile.id, version: profile.version, name: profile.name },
    width: scene.width,
    height: scene.height,
    fps: 25,
    path: 'exact',
    threshold,
    ...(LEVEL === undefined ? {} : { deflateLevel: LEVEL }),
  });
  const blocks = { skip: 0, dense: 0, sparse: 0 };
  let start = performance.now();
  for (let f = 0; f < scene.frames.length; f++) {
    const { stats } = await writer.appendFrame(thermalFrame(scene, f));
    blocks.skip += stats.skip;
    blocks.dense += stats.dense;
    blocks.sparse += stats.sparse;
  }
  await writer.close();
  const encodeMs = (performance.now() - start) / scene.frames.length;

  const reader = await IrvisReader.open(memoryByteSource(sink.bytes()));
  let worst = 0;
  start = performance.now();
  for (let f = 0; f < reader.frameCount; f++) {
    const { frame } = await reader.readFrame(f);
    worst = Math.max(worst, maxError(scene.frames[f] ?? new Uint16Array(0), frame.raw));
  }
  const decodeMs = (performance.now() - start) / reader.frameCount;

  if (worst > threshold)
    throw new Error(`Codec error ${String(worst)} exceeds T=${String(threshold)}`);
  const seconds = ((scene.timestamps.at(-1) ?? 0) - (scene.timestamps[0] ?? 0) + 40) / 1000;
  const total = blocks.skip + blocks.dense + blocks.sparse || 1;
  return {
    scene: name,
    threshold,
    bytes: sink.size,
    frames: scene.frames.length,
    mbPerMinute: (sink.size * (60 / seconds)) / 1e6,
    skip: blocks.skip / total,
    dense: blocks.dense / total,
    sparse: blocks.sparse / total,
    encodeMs,
    decodeMs,
    maxError: worst,
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Read the packed capture format; selection is explicit so startup is never silently removed. */
async function captureScene(dir: string, start: number, count?: number): Promise<Scene> {
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as {
    format: string;
    version: number;
    profile: string;
    pixelFormat: string;
    mode: { width: number; height: number; fps: number };
    frameBytes: number;
    trailingBytes: number;
    frames: { file: string; arrivalMs: number }[];
  };
  if (
    meta.format !== 'irvis-capture' ||
    meta.version !== 1 ||
    meta.profile !== 'infiray-p2pro' ||
    meta.pixelFormat !== 'yuyv422' ||
    meta.mode.width !== 256 ||
    meta.mode.height !== 384 ||
    meta.mode.fps !== 25 ||
    meta.frameBytes !== 196608 ||
    meta.trailingBytes !== 0 ||
    !Array.isArray(meta.frames)
  ) {
    throw new Error('Expected a complete packed infiray-p2pro 256x384 YUYV capture at 25 fps');
  }
  const end = count === undefined ? meta.frames.length : start + count;
  if (start >= meta.frames.length || end > meta.frames.length) {
    throw new Error('Requested frame range is outside the capture');
  }
  const frames: Uint16Array[] = [];
  const timestamps: number[] = [];
  for (const entry of meta.frames.slice(start, end)) {
    if (!Number.isFinite(entry.arrivalMs) || entry.arrivalMs < (timestamps.at(-1) ?? -Infinity)) {
      throw new Error('Capture arrival timestamps must be finite and nondecreasing');
    }
    const data = gunzipSync(await readFile(join(dir, entry.file)));
    frames.push(
      decodeYuyvRaw(
        { kind: 'yuyv', width: 256, height: 384, data, timestamp: entry.arrivalMs },
        { firstRow: 192, rows: 192 },
      ),
    );
    timestamps.push(entry.arrivalMs);
  }
  return { width: 256, height: 192, frames, timestamps };
}

function integerArgument(name: string, minimum: number): number | undefined {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  const value = Number(process.argv[at + 1]);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} takes an integer >= ${String(minimum)}`);
  }
  return value;
}

const captureAt = process.argv.indexOf('--capture');
const capture = captureAt < 0 ? undefined : process.argv[captureAt + 1];
if (captureAt >= 0 && (!capture || capture.startsWith('--'))) {
  throw new Error('--capture takes a capture directory');
}
const start = integerArgument('--start', 0) ?? 0;
const count = integerArgument('--count', 1);
if (!capture && (process.argv.includes('--start') || count !== undefined)) {
  throw new Error('--start and --count require --capture');
}
const scenes: [string, Scene][] = capture
  ? [[basename(capture), await captureScene(capture, start, count)]]
  : [
      ['static', staticScene({ frames: FRAMES })],
      ['moving hand', movingHandScene({ frames: FRAMES })],
    ];
const rows: Row[] = [];
for (const [name, scene] of scenes) {
  for (const threshold of THRESHOLDS) rows.push(await measure(name, scene, threshold));
}

console.log(
  capture
    ? `Capture: ${capture}; start ${String(start)}; arrival timestamps; motion compensation off; deflate level ${String(LEVEL ?? 6)}`
    : `256×192 at 25 fps, noise σ = 2.5 raw, 250 frames extrapolated to a minute; uncompressed 147.5 MB/min; deflate level ${String(LEVEL ?? 6)}`,
);
console.log('');
console.log(
  '| Scene | T (raw) | Frames | File bytes | MB/min | skip | dense | sparse | encode ms/frame | decode ms/frame | max error |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  console.log(
    `| ${r.scene} | ${String(r.threshold)} | ${String(r.frames)} | ${String(r.bytes)} | ${r.mbPerMinute.toFixed(2)} | ${percent(r.skip)} | ${percent(r.dense)} | ${percent(r.sparse)} | ${r.encodeMs.toFixed(2)} | ${r.decodeMs.toFixed(2)} | ${String(r.maxError)} |`,
  );
}

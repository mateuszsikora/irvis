// The .irvis codec benchmark: `npm run bench:irvis`. Encodes synthetic
// scenes at several thresholds through IrvisWriter and prints MB per minute,
// block modes, timing and the largest error. Synthetic data only until the
// fixtures issue (#16) adds real frames. How to read it:
// docs/irvis-format.md#benchmark
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
const THRESHOLDS = [0, 8, 16];
/** 10 s at 25 fps, one keyframe interval. */
const FRAMES = 250;

interface Row {
  scene: string;
  threshold: number;
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
    profile: { id: 'infiray-p2pro', version: 1, name: 'InfiRay P2 Pro' },
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

  const seconds = (scene.frames.length * 40) / 1000;
  const total = blocks.skip + blocks.dense + blocks.sparse || 1;
  return {
    scene: name,
    threshold,
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

const scenes: [string, Scene][] = [
  ['static', staticScene({ frames: FRAMES })],
  ['moving hand', movingHandScene({ frames: FRAMES })],
];
const rows: Row[] = [];
for (const [name, scene] of scenes) {
  for (const threshold of THRESHOLDS) rows.push(await measure(name, scene, threshold));
}

console.log(
  `256×192 at 25 fps, noise σ = 2.5 raw, 250 frames extrapolated to a minute; uncompressed 147.5 MB/min; deflate level ${String(LEVEL ?? 6)}`,
);
console.log('');
console.log(
  '| Scene | T (raw) | MB/min | skip | dense | sparse | encode ms/frame | decode ms/frame | max error |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  console.log(
    `| ${r.scene} | ${String(r.threshold)} | ${r.mbPerMinute.toFixed(2)} | ${percent(r.skip)} | ${percent(r.dense)} | ${percent(r.sparse)} | ${r.encodeMs.toFixed(2)} | ${r.decodeMs.toFixed(2)} | ${String(r.maxError)} |`,
  );
}

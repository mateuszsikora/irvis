import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { CaptureMeta } from '../src/meta.ts';
import { FRAMES_DIR, META_FILE, PACKETS_FILE, frameFile } from '../src/meta.ts';

export const WIDTH = 256;
export const ROWS = 192;
/** Raw value of a temperature with the P2 Pro's conversion, raw / 64 − 273.15. */
export const rawOf = (celsius: number): number => Math.round((celsius + 273.15) * 64);

export interface SyntheticOptions {
  readonly frames: number;
  readonly mode: '384' | '192';
  /** Frames [start, start + count) repeat frame start − 1 exactly, and the mean steps after them. */
  readonly frozen?: readonly [number, number];
  /** Kelvin added to every frame from `stepAt` on (by default, after the frozen run). */
  readonly stepKelvin?: number;
  readonly stepAt?: number;
  /** Frames [start, start + count) show a uniform 22.5 °C scene, as a closed shutter would. */
  readonly flat?: readonly [number, number];
  /** meta.json's pixelFormat; yuyv422 by default. */
  readonly pixelFormat?: string | null;
  readonly referenceCelsius?: number | null;
  /** Leave out packets.framecrc. */
  readonly noPackets?: boolean;
  /** Packet size to write instead of the frame size, for every packet. */
  readonly packetSize?: number;
}

/** A deterministic noise source: integers from −4 to 4, standard deviation √(80/12) ≈ 2.58. */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state % 9) - 4;
  };
}

/**
 * A scene at 22.5 °C with a 35 °C disc around the centre. The lower half
 * holds raw values with noise, the upper half Y rising with the raw value and
 * U = V = 128.
 */
export function syntheticFrame(index: number, offsetKelvin: number, flat = false): Uint8Array {
  const data = new Uint8Array(WIDTH * ROWS * 4);
  const next = noise(index + 1);
  const low = rawOf(20);
  const high = rawOf(40);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const hot = !flat && (x - 128) ** 2 + (y - 96) ** 2 < 30 ** 2;
      const raw = rawOf((hot ? 35 : 22.5) + offsetKelvin) + next();
      const i = y * WIDTH + x;
      const at = WIDTH * ROWS * 2 + i * 2;
      data[at] = raw & 0xff;
      data[at + 1] = raw >> 8;
      const luma = Math.max(0, Math.min(255, Math.round(((raw - low) * 255) / (high - low))));
      data[i * 2] = luma;
      data[i * 2 + 1] = 128;
    }
  }
  return data;
}

/** Writes a capture directory as `capture` would, without ffmpeg. */
export async function writeSyntheticCapture(
  dir: string,
  o: SyntheticOptions,
): Promise<CaptureMeta> {
  await mkdir(join(dir, FRAMES_DIR), { recursive: true });
  const height = o.mode === '384' ? 384 : 192;
  const frameBytes = WIDTH * height * 2;
  const frames: { file: string; arrivalMs: number }[] = [];
  let previous: Uint8Array | null = null;
  for (let i = 0; i < o.frames; i++) {
    const [start, count] = o.frozen ?? [-1, 0];
    const stepAt = o.stepAt ?? (start >= 0 ? start + count : Infinity);
    const [flatStart, flatCount] = o.flat ?? [-1, 0];
    const flat = i >= flatStart && i < flatStart + flatCount;
    let data: Uint8Array;
    if (start >= 0 && i >= start && i < start + count && previous) data = previous;
    else if (o.mode === '384')
      data = syntheticFrame(i, i >= stepAt ? (o.stepKelvin ?? 0) : 0, flat);
    else data = new Uint8Array(frameBytes).fill(128);
    previous = data;
    const file = frameFile(i);
    await writeFile(join(dir, file), gzipSync(data));
    frames.push({ file, arrivalMs: 300 + i * 40 });
  }
  if (!o.noPackets) {
    const lines = ['#software: Lavf', '#tb 0: 1/1000000', '#media_type 0: video'];
    for (let i = 0; i < o.frames; i++) {
      lines.push(
        `0, ${String(i * 40000)}, ${String(i * 40000)}, 1, ${String(o.packetSize ?? frameBytes)}, 0x00000000`,
      );
    }
    await writeFile(join(dir, PACKETS_FILE), `${lines.join('\n')}\n`);
  }
  const meta: CaptureMeta = {
    format: 'irvis-capture',
    version: 1,
    createdAt: '2026-11-13T12:00:00.000Z',
    label: null,
    referenceCelsius: o.referenceCelsius ?? null,
    device: { index: 1, name: 'USB Camera' },
    profile: 'infiray-p2pro',
    mode: { id: `yuyv-256x${String(height)}`, width: WIDTH, height, fps: 25 },
    frameBytes,
    requestedSeconds: o.frames / 25,
    pixelFormat: o.pixelFormat === undefined ? 'yuyv422' : o.pixelFormat,
    ffmpeg: {
      path: '/opt/homebrew/bin/ffmpeg',
      version: '7.1',
      args: [],
      exitCode: 0,
      signal: null,
    },
    system: {
      platform: 'darwin',
      arch: 'arm64',
      release: '25.0.0',
      macos: '26.0',
      node: 'v26.13.0',
    },
    timing: { firstFrameMs: 300, endMs: 300 + o.frames * 40, stoppedByTimeout: false },
    frames,
    trailingBytes: 0,
  };
  await writeFile(join(dir, META_FILE), JSON.stringify(meta));
  return meta;
}

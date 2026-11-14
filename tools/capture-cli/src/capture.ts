// `capture`: runs ffmpeg, cuts its stdout into frames, and writes every frame
// as frames/NNNNNN.yuyv.gz with meta.json. The directory layout:
// docs/features/capture-cli-technical.md#schema
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import type { VideoMode } from '@irvis/core';
import { CliError } from './errors.ts';
import { captureArgs, ffmpegVersion, parseInputPixelFormat } from './ffmpeg.ts';
import {
  type CaptureMeta,
  FFMPEG_LOG,
  FRAMES_DIR,
  META_FILE,
  PACKETS_FILE,
  frameFile,
} from './meta.ts';

const gzipAsync = promisify(gzip);

/** Seconds a capture may run past `--seconds` before ffmpeg is stopped. */
export const STOP_GRACE_SECONDS = 20;

/** Cuts a byte stream into frames of a fixed size. */
export class FrameSplitter {
  readonly frameBytes: number;
  #buffer: Uint8Array;
  #filled = 0;

  constructor(frameBytes: number) {
    this.frameBytes = frameBytes;
    this.#buffer = new Uint8Array(frameBytes);
  }

  /** Adds a chunk and returns every frame it completes, each a new array. */
  push(chunk: Uint8Array): Uint8Array[] {
    const frames: Uint8Array[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      const take = Math.min(this.frameBytes - this.#filled, chunk.length - offset);
      this.#buffer.set(chunk.subarray(offset, offset + take), this.#filled);
      this.#filled += take;
      offset += take;
      if (this.#filled === this.frameBytes) {
        frames.push(this.#buffer);
        this.#buffer = new Uint8Array(this.frameBytes);
        this.#filled = 0;
      }
    }
    return frames;
  }

  /** Bytes received after the last whole frame. */
  get trailingBytes(): number {
    return this.#filled;
  }
}

export interface CaptureOptions {
  readonly ffmpeg: string;
  readonly deviceIndex: number;
  readonly deviceName: string | null;
  readonly profileId: string;
  readonly mode: VideoMode;
  readonly seconds: number;
  readonly out: string;
  readonly label: string | null;
  readonly referenceCelsius: number | null;
  /** Called once per frame as it arrives. */
  readonly onFrame?: (index: number, arrivalMs: number) => void;
}

function macosVersion(): string | null {
  if (platform() !== 'darwin') return null;
  try {
    return execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** Runs one capture into `options.out` and returns what it wrote to meta.json. */
export async function capture(options: CaptureOptions): Promise<CaptureMeta> {
  const { mode, out } = options;
  await mkdir(join(out, FRAMES_DIR), { recursive: true });
  if ((await readdir(join(out, FRAMES_DIR))).length > 0) {
    throw new CliError(`${out} already holds frames; choose an empty directory`);
  }
  const version = await ffmpegVersion(options.ffmpeg);
  const args = captureArgs({
    deviceIndex: options.deviceIndex,
    width: mode.width,
    height: mode.height,
    fps: mode.fps,
    seconds: options.seconds,
    packetsPath: join(out, PACKETS_FILE),
  });
  const frameBytes = mode.width * mode.height * 2;
  const splitter = new FrameSplitter(frameBytes);
  const frames: { file: string; arrivalMs: number }[] = [];
  const writes: Promise<void>[] = [];
  let writeError: { index: number; error: unknown } | null = null;
  const log = createWriteStream(join(out, FFMPEG_LOG));

  const t0 = performance.now();
  const child = spawn(options.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.pipe(log);
  child.stdout.on('data', (chunk: Buffer) => {
    for (const frame of splitter.push(chunk)) {
      const arrivalMs = performance.now() - t0;
      const index = frames.length;
      const file = frameFile(index);
      frames.push({ file, arrivalMs });
      // Handled at once: a rejection left for Promise.all after ffmpeg exits
      // would end the process as unhandled.
      const write = gzipAsync(frame)
        .then((gz) => writeFile(join(out, file), gz))
        .catch((error: unknown) => {
          // Writes finish out of order; report the earliest frame that failed.
          const known = writeError;
          if (known === null) child.kill('SIGINT');
          if (known === null || index < known.index) writeError = { index, error };
        });
      writes.push(write);
      options.onFrame?.(index, arrivalMs);
    }
  });

  let stoppedByTimeout = false;
  const timer = setTimeout(
    () => {
      stoppedByTimeout = true;
      child.kill('SIGINT');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    },
    (options.seconds + STOP_GRACE_SECONDS) * 1000,
  );
  const [exitCode, signal] = await new Promise<[number | null, string | null]>(
    (resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, sig) => resolve([code, sig]));
    },
  ).finally(() => clearTimeout(timer));
  const endMs = performance.now() - t0;
  await Promise.all(writes);
  await new Promise<void>((resolve) => log.end(resolve));
  const failed = writeError as { index: number; error: unknown } | null;
  if (failed !== null) {
    const message = failed.error instanceof Error ? failed.error.message : String(failed.error);
    throw new CliError(`${out}: writing frame ${String(failed.index)} failed: ${message}`);
  }
  const pixelFormat = parseInputPixelFormat(await readFile(join(out, FFMPEG_LOG), 'utf8'));

  const meta: CaptureMeta = {
    format: 'irvis-capture',
    version: 1,
    createdAt: new Date().toISOString(),
    label: options.label,
    referenceCelsius: options.referenceCelsius,
    device: { index: options.deviceIndex, name: options.deviceName },
    profile: options.profileId,
    mode: { id: mode.id, width: mode.width, height: mode.height, fps: mode.fps },
    frameBytes,
    requestedSeconds: options.seconds,
    pixelFormat,
    ffmpeg: { path: options.ffmpeg, version, args, exitCode, signal },
    system: {
      platform: platform(),
      arch: arch(),
      release: release(),
      macos: macosVersion(),
      node: process.version,
    },
    timing: { firstFrameMs: frames[0]?.arrivalMs ?? null, endMs, stoppedByTimeout },
    frames,
    trailingBytes: splitter.trailingBytes,
  };
  await writeFile(join(out, META_FILE), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

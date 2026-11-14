// meta.json of a capture directory. Field by field:
// docs/features/capture-cli-technical.md#schema
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError } from './errors.ts';

export const META_FILE = 'meta.json';
export const FRAMES_DIR = 'frames';
export const PACKETS_FILE = 'packets.framecrc';
export const FFMPEG_LOG = 'ffmpeg.log';

export interface CaptureMeta {
  readonly format: 'irvis-capture';
  readonly version: 1;
  readonly createdAt: string;
  /** A short name for what was in front of the camera, for example `hand`. */
  readonly label: string | null;
  /** The Android app's centre reading at the same spot, typed in by the owner. */
  readonly referenceCelsius: number | null;
  readonly device: { readonly index: number; readonly name: string | null };
  readonly profile: string;
  readonly mode: {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly fps: number;
  };
  readonly frameBytes: number;
  readonly requestedSeconds: number;
  /**
   * The pixel format of ffmpeg's input stream, read from ffmpeg.log; capture
   * asks for `yuyv422`. Null when the log does not say.
   */
  readonly pixelFormat: string | null;
  readonly ffmpeg: {
    readonly path: string;
    readonly version: string | null;
    readonly args: readonly string[];
    readonly exitCode: number | null;
    readonly signal: string | null;
  };
  readonly system: {
    readonly platform: string;
    readonly arch: string;
    readonly release: string;
    readonly macos: string | null;
    readonly node: string;
  };
  /** Milliseconds from just before ffmpeg was started (performance.now). */
  readonly timing: {
    readonly firstFrameMs: number | null;
    readonly endMs: number;
    readonly stoppedByTimeout: boolean;
  };
  /** One entry per whole frame, in order; `file` is relative to the capture directory. */
  readonly frames: readonly { readonly file: string; readonly arrivalMs: number }[];
  /** Bytes after the last whole frame; anything but 0 means the stream was not whole frames. */
  readonly trailingBytes: number;
}

export async function readMeta(dir: string): Promise<CaptureMeta> {
  const meta = (await readMetaJson(dir)) as Partial<CaptureMeta>;
  if (meta.format !== 'irvis-capture' || meta.version !== 1) {
    throw new CliError(`${join(dir, META_FILE)} is not an irvis-capture version 1 file`);
  }
  return { ...meta, pixelFormat: meta.pixelFormat ?? null } as CaptureMeta;
}

/** meta.json of a directory as a plain object; a parse error becomes a CliError. */
export async function readMetaJson(dir: string): Promise<Record<string, unknown>> {
  const path = join(dir, META_FILE);
  const text = await readFile(path, 'utf8');
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new CliError(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Frame file name for a frame index: `frames/000042.yuyv.gz`. */
export function frameFile(index: number): string {
  return `${FRAMES_DIR}/${String(index).padStart(6, '0')}.yuyv.gz`;
}

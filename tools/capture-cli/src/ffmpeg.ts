// ffmpeg and its AVFoundation input: where the binary is, the arguments of a
// capture, and parsers for what ffmpeg prints. How the capture keeps the
// camera's bytes: docs/features/capture-cli-technical.md#data-flow
import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { CliError } from './errors.ts';

/** The ffmpeg to run: IRVIS_FFMPEG if set, else the first `ffmpeg` on PATH. */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['IRVIS_FFMPEG'];
  if (configured !== undefined && configured !== '') {
    if (!isExecutable(configured)) {
      throw new CliError(`IRVIS_FFMPEG=${configured} is not an executable file`);
    }
    return configured;
  }
  for (const dir of (env['PATH'] ?? '').split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (isExecutable(candidate)) return candidate;
  }
  throw new CliError(
    'ffmpeg not found: install it (brew install ffmpeg) or set IRVIS_FFMPEG to its path',
  );
}

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the process was stopped after `timeoutMs`. */
  readonly timedOut: boolean;
}

/**
 * Runs a program to completion, or stops it after timeoutMs. An aborted
 * `signal` kills it and rejects with Node's AbortError.
 */
export function run(
  program: string,
  args: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(signal ? { signal } : {}),
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (s: string) => (stdout += s));
    child.stderr.setEncoding('utf8').on('data', (s: string) => (stderr += s));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** The version from the first line of `ffmpeg -version`, for example `7.1.1`. */
export function parseFfmpegVersion(output: string): string | null {
  return /^ffmpeg version (\S+)/m.exec(output)?.[1] ?? null;
}

export async function ffmpegVersion(ffmpeg: string): Promise<string | null> {
  const result = await run(ffmpeg, ['-hide_banner', '-version'], 10_000);
  return parseFfmpegVersion(result.stdout);
}

/** ffmpeg log lines start with `[<component> @ 0x<address>] `. */
/** A log line without ffmpeg's context prefix, such as `[in#0 @ 0x7c5101c000] `. */
export function stripLogPrefix(line: string): string {
  return line.replace(/^\[[^\]]*@ 0x[0-9a-fA-F]+\] ?/, '');
}

export interface AvDevice {
  readonly index: number;
  readonly name: string;
}

export interface AvDeviceList {
  readonly video: readonly AvDevice[];
  readonly audio: readonly AvDevice[];
}

/** The devices in the output of `ffmpeg -f avfoundation -list_devices true -i ""`. */
export function parseDeviceList(stderr: string): AvDeviceList {
  const video: AvDevice[] = [];
  const audio: AvDevice[] = [];
  let section: AvDevice[] | null = null;
  for (const raw of stderr.split(/\r?\n/)) {
    const line = stripLogPrefix(raw);
    if (line.startsWith('AVFoundation video devices:')) section = video;
    else if (line.startsWith('AVFoundation audio devices:')) section = audio;
    else {
      const match = /^\[(\d+)\] (.+)$/.exec(line);
      if (match && section) section.push({ index: Number(match[1]), name: match[2] ?? '' });
      else if (!match) section = null;
    }
  }
  return { video, audio };
}

export interface AvMode {
  readonly width: number;
  readonly height: number;
  readonly minFps: number;
  readonly maxFps: number;
}

/** The `Supported modes:` that AVFoundation prints for a size it does not offer. */
export function parseSupportedModes(stderr: string): AvMode[] {
  const modes: AvMode[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const m = /(\d+)x(\d+)@\[([\d.]+) ([\d.]+)\]fps/.exec(line);
    if (m) {
      modes.push({
        width: Number(m[1]),
        height: Number(m[2]),
        minFps: Number(m[3]),
        maxFps: Number(m[4]),
      });
    }
  }
  return modes;
}

/**
 * The `Supported pixel formats:` that AVFoundation prints for a pixel format
 * the device does not offer, and the one it chose instead.
 */
export function parsePixelFormats(stderr: string): { supported: string[]; chosen: string | null } {
  const supported: string[] = [];
  let chosen: string | null = null;
  let inList = false;
  for (const raw of stderr.split(/\r?\n/)) {
    const line = stripLogPrefix(raw);
    const override = /Overriding selected pixel format to use (\S+) instead/.exec(line);
    if (override) chosen = override[1] ?? null;
    if (line.startsWith('Supported pixel formats:')) {
      inList = true;
      continue;
    }
    if (inList) {
      const format = /^\s+([a-z0-9_]+)\s*$/.exec(line);
      if (format) supported.push(format[1] ?? '');
      else inList = false;
    }
  }
  return { supported, chosen };
}

/** What capture asks AVFoundation for, and what the decoders expect. */
export const REQUESTED_PIXEL_FORMAT = 'yuyv422';

/**
 * The pixel format ffmpeg's input stream has, from a capture's log: the
 * format AVFoundation fell back to (`Overriding selected pixel format to use
 * <format> instead.`), else the one in the input's
 * `Stream #0:0: Video: rawvideo (<tag>), <format>, <w>x<h>` line; null when
 * the log has neither.
 */
export function parseInputPixelFormat(log: string): string | null {
  const { chosen } = parsePixelFormats(log);
  if (chosen !== null) return chosen;
  let input = false;
  for (const line of log.split(/\r?\n/)) {
    if (/^Input #0/.test(line)) input = true;
    else if (/^Output #/.test(line)) input = false;
    const stream = /Stream #0:0\S*: Video: \w+(?: \([^)]*\))?, ([a-z0-9_]+)/.exec(line);
    if (input && stream) return stream[1] ?? null;
  }
  return null;
}

export interface CaptureArgs {
  readonly deviceIndex: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly seconds: number;
  /** Where ffmpeg writes the framecrc list of packets. */
  readonly packetsPath: string;
}

/**
 * The ffmpeg arguments of a capture. Raw pixels are packed without conversion
 * to stdout, so ffmpeg never converts the bytes AVFoundation delivers; a
 * second stream copy writes a framecrc line (pts and size) for every packet.
 */
export function captureArgs(a: CaptureArgs): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'info',
    '-f',
    'avfoundation',
    '-framerate',
    String(a.fps),
    '-video_size',
    `${String(a.width)}x${String(a.height)}`,
    '-pixel_format',
    REQUESTED_PIXEL_FORMAT,
    '-t',
    String(a.seconds),
    '-i',
    `${String(a.deviceIndex)}:none`,
    '-map',
    '0:v',
    '-c:v',
    'rawvideo',
    '-pix_fmt',
    '+',
    '-fps_mode',
    'passthrough',
    '-enc_time_base',
    'demux',
    '-f',
    'rawvideo',
    'pipe:1',
    '-map',
    '0:v',
    '-c:v',
    'copy',
    '-f',
    'framecrc',
    a.packetsPath,
  ];
}

/** Arguments that make AVFoundation print the device's modes and then fail. */
export function modesProbeArgs(deviceIndex: number): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-f',
    'avfoundation',
    '-framerate',
    '1',
    '-video_size',
    '1x1',
    '-i',
    `${String(deviceIndex)}:none`,
  ];
}

/**
 * Arguments that open a mode with the pixel format `monob`, which no UVC
 * camera offers, so that AVFoundation prints the formats the device does
 * offer; then one frame is read and dropped.
 */
export function pixelFormatProbeArgs(deviceIndex: number, mode: AvMode): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-f',
    'avfoundation',
    '-framerate',
    String(mode.maxFps),
    '-video_size',
    `${String(mode.width)}x${String(mode.height)}`,
    '-pixel_format',
    'monob',
    '-i',
    `${String(deviceIndex)}:none`,
    '-frames:v',
    '1',
    '-f',
    'null',
    '-',
  ];
}

export interface Framecrc {
  /** The time base of the pts values, as numerator and denominator. */
  readonly timeBase: readonly [number, number] | null;
  readonly packets: readonly { readonly pts: number; readonly size: number }[];
}

/** Reads ffmpeg's framecrc output: `#tb 0: 1/1000000`, then `stream, dts, pts, duration, size, crc`. */
export function parseFramecrc(text: string): Framecrc {
  let timeBase: [number, number] | null = null;
  const packets: { pts: number; size: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tb = /^#tb 0: (\d+)\/(\d+)/.exec(line);
    if (tb) {
      timeBase = [Number(tb[1]), Number(tb[2])];
      continue;
    }
    if (line.startsWith('#') || line.trim() === '') continue;
    const fields = line.split(',').map((f) => f.trim());
    if (fields[0] !== '0' || fields.length < 6) continue;
    packets.push({ pts: Number(fields[2]), size: Number(fields[4]) });
  }
  return { timeBase, packets };
}

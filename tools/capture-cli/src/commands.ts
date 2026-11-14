// The commands behind the CLI and the spike, each returning what it prints.
// Usage: docs/features/capture-cli-user.md
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { type CameraProfile, type VideoMode, findProfile } from '@irvis/core';
import { capture } from './capture.ts';
import { CliError } from './errors.ts';
import {
  type AvDeviceList,
  type AvMode,
  ffmpegVersion,
  modesProbeArgs,
  parseDeviceList,
  parsePixelFormats,
  parseSupportedModes,
  pixelFormatProbeArgs,
  REQUESTED_PIXEL_FORMAT,
  run,
} from './ffmpeg.ts';
import { FFMPEG_LOG, META_FILE, readMetaJson } from './meta.ts';
import { type CaptureReport, formatSummary, reportCapture } from './report.ts';
import { probeUsb } from './usb.ts';

export const PROFILE_ID = 'infiray-p2pro';

export function profile(): CameraProfile {
  const p = findProfile(PROFILE_ID);
  if (p === undefined) throw new CliError(`profile '${PROFILE_ID}' is not registered`);
  return p;
}

/** The profile's mode with this many rows: `384` or `192` for the P2 Pro. */
export function modeByRows(rows: string): VideoMode {
  const mode = profile().videoModes.find((m) => String(m.height) === rows);
  if (mode === undefined) {
    const known = profile()
      .videoModes.map((m) => String(m.height))
      .join(' or ');
    throw new CliError(`--mode must be ${known}, not '${rows}'`);
  }
  return mode;
}

export function requireMacos(command: string): void {
  if (process.platform !== 'darwin') {
    throw new CliError(
      `capture-cli ${command} uses AVFoundation and runs only on macOS; this is ${process.platform}`,
    );
  }
}

export async function listDevices(ffmpeg: string): Promise<AvDeviceList> {
  const result = await run(
    ffmpeg,
    ['-hide_banner', '-nostdin', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
    15_000,
  );
  return parseDeviceList(result.stderr);
}

export function formatDevices(list: AvDeviceList): string {
  if (list.video.length === 0) return 'No AVFoundation video devices.\n';
  const lines = ['AVFoundation video devices:'];
  for (const d of list.video) lines.push(`  [${String(d.index)}] ${d.name}`);
  return `${lines.join('\n')}\n`;
}

/** Everything `probe` finds out about a device, as text. */
export async function probe(ffmpeg: string, deviceIndex: number): Promise<string> {
  const lines: string[] = [];
  const version = await ffmpegVersion(ffmpeg);
  lines.push(`ffmpeg: ${ffmpeg} (${version ?? 'unknown version'})`);
  const list = await listDevices(ffmpeg);
  const device = list.video.find((d) => d.index === deviceIndex);
  lines.push(`device [${String(deviceIndex)}]: ${device?.name ?? 'not in the AVFoundation list'}`);

  const modesRun = await run(ffmpeg, modesProbeArgs(deviceIndex), 15_000);
  const modes = parseSupportedModes(modesRun.stderr);
  lines.push('AVFoundation modes:');
  if (modes.length === 0) lines.push('  none reported; ffmpeg said:', ...indent(modesRun.stderr));
  for (const m of modes) {
    lines.push(
      `  ${String(m.width)}x${String(m.height)} at ${String(m.minFps)} to ${String(m.maxFps)} fps`,
    );
  }

  const target: AvMode | undefined =
    modes.find((m) => m.width === 256 && m.height === 384) ?? modes[0];
  if (target) {
    const pfRun = await run(ffmpeg, pixelFormatProbeArgs(deviceIndex, target), 15_000);
    const formats = parsePixelFormats(pfRun.stderr);
    lines.push(`pixel formats at ${String(target.width)}x${String(target.height)}:`);
    if (formats.supported.length === 0)
      lines.push('  none reported; ffmpeg said:', ...indent(pfRun.stderr));
    for (const f of formats.supported)
      lines.push(`  ${f}${f === 'yuyv422' ? ' (what capture asks for)' : ''}`);
    if (formats.chosen) lines.push(`  AVFoundation would fall back to ${formats.chosen}`);
    if (pfRun.timedOut)
      lines.push('  (stopped after 15 s; check the camera permission of the terminal)');
  }

  lines.push('USB (node-usb):');
  const ids = profile().identification.usb;
  lines.push(...(await probeUsb({ ids })).map((l) => `  ${l}`));
  return `${lines.join('\n')}\n`;
}

function indent(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(-15)
    .map((l) => `    ${l}`);
}

export interface CaptureCommand {
  readonly deviceIndex: number;
  readonly seconds: number;
  readonly mode: VideoMode;
  readonly out: string;
  readonly label: string | null;
  readonly referenceCelsius: number | null;
  readonly onFrame?: (index: number, arrivalMs: number) => void;
}

/** Runs one capture and returns a one-line summary. */
export async function captureCommand(ffmpeg: string, c: CaptureCommand): Promise<string> {
  const list = await listDevices(ffmpeg);
  const name = list.video.find((d) => d.index === c.deviceIndex)?.name ?? null;
  const meta = await capture({
    ffmpeg,
    deviceIndex: c.deviceIndex,
    deviceName: name,
    profileId: PROFILE_ID,
    mode: c.mode,
    seconds: c.seconds,
    out: c.out,
    label: c.label,
    referenceCelsius: c.referenceCelsius,
    ...(c.onFrame ? { onFrame: c.onFrame } : {}),
  });
  const exit = meta.timing.stoppedByTimeout
    ? 'ffmpeg was stopped after the time limit'
    : `ffmpeg exited with ${String(meta.ffmpeg.exitCode)}`;
  if (meta.frames.length === 0) {
    throw new CliError(`${c.out}: no frames arrived (${exit}); see ${join(c.out, FFMPEG_LOG)}`);
  }
  const first = (meta.timing.firstFrameMs ?? 0).toFixed(0);
  const line = `${c.out}: ${String(meta.frames.length)} frames, the first ${first} ms after ffmpeg started; ${exit}\n`;
  return line + formatWarning(meta.pixelFormat);
}

/** A warning line when AVFoundation did not deliver the requested format, else ''. */
export function formatWarning(pixelFormat: string | null): string {
  if (pixelFormat === REQUESTED_PIXEL_FORMAT) return '';
  if (pixelFormat === null) {
    return `warning: ffmpeg.log does not say which pixel format AVFoundation delivered\n`;
  }
  return `warning: AVFoundation delivered ${pixelFormat}, not ${REQUESTED_PIXEL_FORMAT}; the bytes are not in the camera's order\n`;
}

/** Capture directories in `dir`: itself if it has meta.json, else its subdirectories that do. */
export async function captureDirs(dir: string): Promise<string[]> {
  if (existsSync(join(dir, META_FILE))) return [dir];
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
    const code = (error as { code?: unknown }).code;
    if (code === 'ENOENT') throw new CliError(`${dir} does not exist`);
    if (code === 'ENOTDIR') throw new CliError(`${dir} is not a directory`);
    throw new CliError(
      `${dir} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const dirs = entries
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, META_FILE)))
    .map((e) => join(dir, e.name))
    .sort();
  if (dirs.length === 0)
    throw new CliError(`${dir} has no ${META_FILE} and no capture directories`);
  return dirs;
}

/** Reports every capture in `dir`; for a session, also writes `dir/report.md` with the summary. */
export async function reportCommand(
  dir: string,
  previewFrame: number | undefined,
  header = '',
): Promise<string> {
  const dirs = await captureDirs(dir);
  const options = previewFrame === undefined ? {} : { previewFrame };
  if (dirs.length === 1 && dirs[0] === dir) {
    return (await reportCapture(dir, basename(dir), options)).markdown;
  }
  const reports: { name: string; report: CaptureReport; markdown: string }[] = [];
  const failed: string[] = [];
  for (const d of dirs) {
    const name = basename(d);
    try {
      reports.push({ name, ...(await reportCapture(d, name, options)) });
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      failed.push(`#### ${name}\n\nNo report: ${error.message}\n`);
    }
  }
  const markdown = [header, formatSummary(reports), ...reports.map((r) => r.markdown), ...failed]
    .filter((s) => s !== '')
    .join('\n');
  await writeFile(join(dir, 'report.md'), markdown);
  return markdown;
}

/** Stores the Android app's centre reading in a capture's meta.json; `report` uses it. */
export async function setReference(dir: string, celsius: number): Promise<void> {
  const path = join(dir, META_FILE);
  if (!existsSync(path)) throw new CliError(`${dir} has no ${META_FILE}`);
  const meta = await readMetaJson(dir);
  meta['referenceCelsius'] = celsius;
  await writeFile(path, `${JSON.stringify(meta, null, 2)}\n`);
}

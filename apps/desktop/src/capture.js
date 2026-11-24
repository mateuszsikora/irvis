import { readdir } from 'node:fs/promises';
import { findFfmpeg, run, parseDeviceList } from '../../../tools/capture-cli/src/ffmpeg.ts';

export function inputArgs(platform, device, mode) {
  const size = ['-framerate', String(mode.fps), '-video_size', `${mode.width}x${mode.height}`];
  if (platform === 'darwin' && /^\d+$/.test(String(device)))
    return ['-f', 'avfoundation', ...size, '-pixel_format', 'yuyv422', '-i', `${device}:none`];
  if (platform === 'linux' && /^\/dev\/video\d+$/.test(device))
    return ['-f', 'v4l2', ...size, '-input_format', 'yuyv422', '-i', device];
  if (platform === 'win32' && typeof device === 'string' && device.length && !device.includes('\0'))
    return ['-f', 'dshow', ...size, '-pixel_format', 'yuyv422', '-i', `video=${device}`];
  throw new Error('Invalid capture selection');
}
/** Native bytes packed to stdout; the bundled ffmpeg is verified with exactly these. */
export function outputArgs() {
  return [
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
  ];
}
/** ffmpeg starts a log line with its context, such as `[in#0 @ 0x7c5101c000] `. */
const LOG_CONTEXT = /^\[[^\]]* @ 0x[0-9a-f]+\]\s*/i;
/**
 * What the viewer shows when ffmpeg exits: a plain explanation when the camera
 * lacks the mode (AVFoundation's wording), otherwise ffmpeg's last lines.
 */
export function captureEndedMessage(code, log, mode) {
  const lines = log
    .split(/\r?\n/)
    .map((line) => line.replace(LOG_CONTEXT, '').trim())
    .filter(Boolean);
  if (lines.some((line) => /^Selected video size \(\d+x\d+\) is not supported/.test(line))) {
    const offered = [
      ...new Set(
        lines.flatMap((line) => {
          const size = /^(\d+)x(\d+)@/.exec(line);
          return size ? [`${size[1]} × ${size[2]}`] : [];
        }),
      ),
    ];
    const list =
      offered.length > 1 ? `${offered.slice(0, -1).join(', ')} and ${offered.at(-1)}` : offered[0];
    return (
      `This camera has no ${mode.width} × ${mode.height} video mode` +
      (list ? `; it offers ${list}` : '') +
      '. It is probably not the thermal camera: choose another camera in Source.'
    );
  }
  return [`Capture ended (${code}).`, ...lines.slice(-4)].join('\n');
}
export function captureArgs(platform, device, mode) {
  return ['-hide_banner', '-nostdin', ...inputArgs(platform, device, mode), ...outputArgs()];
}
export async function listDevices(platform = process.platform, ffmpeg = findFfmpeg) {
  if (platform === 'linux')
    return (await readdir('/dev'))
      .filter((n) => /^video\d+$/.test(n))
      .sort()
      .map((n) => ({ id: `/dev/${n}`, label: n }));
  const format = platform === 'darwin' ? 'avfoundation' : platform === 'win32' ? 'dshow' : null;
  if (!format) throw new Error('Unsupported capture platform');
  const result = await run(
    ffmpeg(),
    ['-hide_banner', '-f', format, '-list_devices', 'true', '-i', ''],
    10000,
  );
  if (result.timedOut) throw new Error('Camera enumeration timed out');
  if (platform === 'darwin')
    return parseDeviceList(result.stderr).video.map((d) => ({
      id: String(d.index),
      label: d.name,
    }));
  return [...result.stderr.matchAll(/"(.+)" \(video\)/g)].map((m) => ({ id: m[1], label: m[1] }));
}

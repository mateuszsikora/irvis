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

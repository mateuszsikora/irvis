import { readdir, readFile } from 'node:fs/promises';
import {
  findFfmpeg,
  run,
  parseDeviceList,
  parseSupportedModes,
  stripLogPrefix,
  modesProbeArgs,
} from '../../../tools/capture-cli/src/ffmpeg.ts';

const isAvfoundationDevice = (device) => /^\d+$/.test(String(device));
const isV4l2Device = (device) => /^\/dev\/video\d+$/.test(device);
const isDshowDevice = (device) =>
  typeof device === 'string' && device.length > 0 && !device.includes('\0');

export function inputArgs(platform, device, mode) {
  const size = ['-framerate', String(mode.fps), '-video_size', `${mode.width}x${mode.height}`];
  if (platform === 'darwin' && isAvfoundationDevice(device))
    return ['-f', 'avfoundation', ...size, '-pixel_format', 'yuyv422', '-i', `${device}:none`];
  if (platform === 'linux' && isV4l2Device(device))
    return ['-f', 'v4l2', ...size, '-input_format', 'yuyv422', '-i', device];
  if (platform === 'win32' && isDshowDevice(device))
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
/**
 * What the viewer shows when ffmpeg exits: a plain explanation when the camera
 * lacks the mode (AVFoundation's wording), otherwise ffmpeg's last lines.
 */
export function captureEndedMessage(code, log, mode) {
  const lines = log
    .split(/\r?\n/)
    .map((line) => stripLogPrefix(line).trim())
    .filter(Boolean);
  if (lines.some((line) => /^Selected video size \(\d+x\d+\) is not supported/.test(line))) {
    const offered = [...new Set(parseSupportedModes(log).map((m) => `${m.width} × ${m.height}`))];
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
/** The USB IDs as device fields, or none when either is not an integer. */
const usbIds = (vendorId, productId) =>
  Number.isInteger(vendorId) && Number.isInteger(productId) ? { vendorId, productId } : {};
/**
 * V4L2 nodes in number order, labelled with the name the kernel gives the
 * device (`/sys/class/video4linux/<node>/name`), or the node when it has none,
 * with the USB IDs of the device the node belongs to when it is a USB device.
 * A node whose `index` is not 0 is a second node of the same device, such as a
 * UVC camera's metadata node, and is left out.
 */
async function v4l2Devices(fs) {
  const nodes = (await fs.readdir('/dev'))
    .filter((n) => /^video\d+$/.test(n))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  const read = (node, file) =>
    fs.readFile(`/sys/class/video4linux/${node}/${file}`, 'utf8').then(
      (text) => text.trim(),
      () => '',
    );
  const hex = (text) => (/^[0-9a-f]{4}$/i.test(text) ? parseInt(text, 16) : undefined);
  const devices = [];
  for (const node of nodes) {
    const [name, index, vendor, product] = await Promise.all([
      read(node, 'name'),
      read(node, 'index'),
      // `device` is the USB interface; its parent directory is the USB device.
      // A template, not path.join: the kernel must resolve `..` after following the symlink.
      read(node, 'device/../idVendor'),
      read(node, 'device/../idProduct'),
    ]);
    if (index && index !== '0') continue;
    devices.push({ id: `/dev/${node}`, label: name || node, ...usbIds(hex(vendor), hex(product)) });
  }
  return devices;
}
/**
 * USB IDs of the cameras macOS lists in `system_profiler SPCameraDataType -json`
 * (`spcamera_model-id` is `UVC Camera VendorID_<decimal> ProductID_<decimal>`
 * for a USB camera), by name. A name listed with two different pairs is left out,
 * because AVFoundation names the device only.
 */
export function parseCameraData(json) {
  const ids = new Map();
  const ambiguous = new Set();
  let cameras;
  try {
    cameras = JSON.parse(json).SPCameraDataType;
  } catch {
    return ids;
  }
  if (!Array.isArray(cameras)) return ids;
  for (const camera of cameras) {
    const name = camera?._name;
    const match = /VendorID_(\d+) ProductID_(\d+)/.exec(String(camera?.['spcamera_model-id']));
    if (typeof name !== 'string' || !match) continue;
    const pair = usbIds(Number(match[1]), Number(match[2]));
    const known = ids.get(name);
    if (known && (known.vendorId !== pair.vendorId || known.productId !== pair.productId))
      ambiguous.add(name);
    ids.set(name, pair);
  }
  for (const name of ambiguous) ids.delete(name);
  return ids;
}
/**
 * DirectShow video devices from `-list_devices true`: the name, and the USB IDs
 * from the `Alternative name` line that follows it (`@device_pnp_\\?\usb#vid_0bda&pid_5830…`).
 */
export function parseDshowDevices(log) {
  const devices = [];
  let last;
  for (const raw of log.split(/\r?\n/)) {
    // Windows prints the context's address without 0x: `[dshow @ 000001f1a2b3c4d0] `.
    const line = raw.replace(/^\[[^\]]* @ [^\]]*\] ?/, '');
    const device = /^"(.+)" \(video\)/.exec(line);
    if (device) {
      last = { id: device[1], label: device[1] };
      devices.push(last);
      continue;
    }
    const usb = /^\s*Alternative name ".*\bvid_([0-9a-f]{4})&pid_([0-9a-f]{4})/i.exec(line);
    if (usb && last) Object.assign(last, usbIds(parseInt(usb[1], 16), parseInt(usb[2], 16)));
    if (!/^\s*Alternative name/.test(line)) last = undefined;
  }
  return devices;
}
export async function listDevices(
  platform = process.platform,
  ffmpeg = findFfmpeg,
  fs = { readdir, readFile },
  exec = run,
) {
  if (platform === 'linux') return v4l2Devices(fs);
  const format = platform === 'darwin' ? 'avfoundation' : platform === 'win32' ? 'dshow' : null;
  if (!format) throw new Error('Unsupported capture platform');
  const [result, cameraData] = await Promise.all([
    exec(ffmpeg(), ['-hide_banner', '-f', format, '-list_devices', 'true', '-i', ''], 10000),
    // Without the USB IDs the devices are still listed; the profile is not chosen for them.
    platform === 'darwin'
      ? exec('/usr/sbin/system_profiler', ['SPCameraDataType', '-json'], 3000).then(
          (r) => parseCameraData(r.stdout),
          () => new Map(),
        )
      : undefined,
  ]);
  if (result.timedOut) throw new Error('Camera enumeration timed out');
  if (platform === 'darwin')
    // AVFoundation lists screens among video devices as `Capture screen <n>`; they are not cameras.
    return parseDeviceList(result.stderr)
      .video.filter((d) => !/^Capture screen \d+$/.test(d.name))
      .map((d) => ({
        id: String(d.index),
        label: d.name,
        ...cameraData.get(d.name),
      }));
  return parseDshowDevices(result.stderr);
}
/**
 * The video modes a device offers, as the platform's ffmpeg input prints them:
 * AVFoundation's `Supported modes:` (any pixel format), each at its maximum
 * frame rate only, because the input opens a format only when `-framerate` is
 * within 0.01 of that maximum (libavdevice/avfoundation.m);
 * V4L2's `-list_formats all` sizes for `yuyv422` (no frame rates), DirectShow's
 * `-list_options true` for `pixel_format=yuyv422` with one size. Sizes given as
 * a range are left out.
 */
export function parseDeviceModes(platform, log) {
  const modes = [];
  if (platform === 'darwin')
    for (const m of parseSupportedModes(log))
      modes.push({ width: m.width, height: m.height, minFps: m.maxFps, maxFps: m.maxFps });
  for (const raw of log.split(/\r?\n/)) {
    const line = stripLogPrefix(raw);
    if (platform === 'linux') {
      const sizes = /^Raw\s*:\s*yuyv422\s*:.*\s:((?:\s+\d+x\d+)+)\s*$/.exec(line);
      if (sizes)
        for (const [, width, height] of sizes[1].matchAll(/(\d+)x(\d+)/g))
          modes.push({ width: Number(width), height: Number(height) });
    }
    if (platform === 'win32') {
      const m =
        /pixel_format=yuyv422\s+min s=(\d+)x(\d+) fps=([\d.]+)\s+max s=(\d+)x(\d+) fps=([\d.]+)/.exec(
          line,
        );
      if (m && m[1] === m[4] && m[2] === m[5])
        modes.push({
          width: Number(m[1]),
          height: Number(m[2]),
          minFps: Number(m[3]),
          maxFps: Number(m[6]),
        });
    }
  }
  const seen = new Set();
  return modes.filter((m) => {
    const key = `${m.width}x${m.height}@${m.minFps}-${m.maxFps}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/** Arguments that make the platform's ffmpeg input print a device's video modes. */
export function modesArgs(platform, device) {
  if (platform === 'darwin' && isAvfoundationDevice(device)) return modesProbeArgs(Number(device));
  if (platform === 'linux' && isV4l2Device(device))
    return ['-hide_banner', '-nostdin', '-f', 'v4l2', '-list_formats', 'all', '-i', device];
  if (platform === 'win32' && isDshowDevice(device))
    return [
      '-hide_banner',
      '-nostdin',
      '-f',
      'dshow',
      '-list_options',
      'true',
      '-i',
      `video=${device}`,
    ];
  throw new Error('Invalid capture selection');
}
/** The device's video modes; an empty list when ffmpeg printed none it could read. */
export async function listModes(platform, device, ffmpeg = findFfmpeg, exec = run, signal) {
  const result = await exec(ffmpeg(), modesArgs(platform, device), 10000, signal);
  if (result.timedOut) throw new Error('Reading the camera modes timed out');
  return parseDeviceModes(platform, result.stderr);
}

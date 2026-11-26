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
 * lacks the mode (AVFoundation's wording), with advice that depends on whether
 * the mode is one of the profile's (`profileMode`), otherwise ffmpeg's last lines.
 */
export function captureEndedMessage(code, log, mode, profileMode) {
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
      // A profile mode, with temperature data or not, is offered also when the
      // camera's modes could not be read, so a camera without it is probably the
      // wrong camera; any other mode came from this camera's own list, so only
      // the mode is wrong.
      (profileMode
        ? '. It is probably not the thermal camera: choose another camera in Source.'
        : '. Choose another video mode.')
    );
  }
  return [`Capture ended (${code}).`, ...lines.slice(-4)].join('\n');
}
/**
 * Cuts ffmpeg's stdout into frames of `size` bytes. Each chunk is copied once
 * into one reused frame buffer, so a large image-only frame is not rebuilt with
 * every pipe chunk. `onFrame` gets that buffer and must copy what it keeps
 * before it returns.
 */
export function frameReader(size, onFrame) {
  const frame = Buffer.allocUnsafe(size);
  let filled = 0;
  return (chunk) => {
    for (let at = 0; at < chunk.length;) {
      // Copies only as much as the frame has room for.
      const copied = chunk.copy(frame, filled, at);
      at += copied;
      filled += copied;
      if (filled < size) return;
      filled = 0;
      onFrame(frame);
    }
  };
}
/** Where macOS keeps the camera permission, as System Settings names it. */
const cameraSettings = 'System Settings → Privacy & Security → Camera';
/**
 * Which app to allow: the packaged irvis, or in development the app that
 * started Electron, to which macOS attributes the camera. An app without a
 * camera usage description, such as an agent app, cannot be allowed at all.
 */
const cameraAccessAdvice = (packaged) =>
  packaged
    ? `allow irvis in ${cameraSettings}, then press Start again.`
    : `allow the app that started irvis, such as Terminal, in ${cameraSettings}, then press Start again. ` +
      'An app missing from that list cannot be given camera access; start irvis from Terminal instead.';
const capitalized = (text) => text[0].toUpperCase() + text.slice(1);
const reconnect = 'Choose another camera in Source or reconnect this one, then press Start again.';
/**
 * macOS's camera permission for the app (`systemPreferences.getMediaAccessStatus`):
 * `granted`, `denied`, `restricted` or `not-determined`. On Linux and Windows
 * the app does not read the system's camera setting and answers `granted`.
 */
export function cameraAccess(platform, preferences) {
  return platform === 'darwin' ? preferences.getMediaAccessStatus('camera') : 'granted';
}
/**
 * What the viewer shows instead of starting ffmpeg, or '' when ffmpeg may start.
 * Without access AVFoundation still lists the camera and ffmpeg opens it, but
 * waits for ever for a first frame. `not-determined` starts ffmpeg, which makes
 * macOS ask. `restricted` (a device management profile or Screen Time) cannot
 * be changed in System Settings, so it gets no advice to allow the app.
 */
export function cameraAccessMessage(access, packaged) {
  if (access === 'denied')
    return 'macOS does not let irvis use the camera. ' + capitalized(cameraAccessAdvice(packaged));
  if (access === 'restricted')
    return (
      'macOS does not let apps use the camera on this Mac: a device management profile or Screen Time restricts it. ' +
      "Ask the Mac's administrator."
    );
  return '';
}
/** How long a started capture waits for its first frame before it stops. */
export const firstFrameTimeout = 10000;
/**
 * What the viewer shows when no frame arrived within `firstFrameTimeout`, by
 * the camera permission at that moment (`cameraAccess`). A package with access
 * gets no advice about access. From the repository macOS attributes the camera
 * to the app that started Electron, so the advice stays even with `granted`:
 * whether Electron's status is that app's has not been checked.
 */
export function noFramesMessage(platform, access, packaged) {
  const base = `The camera sent no image within ${firstFrameTimeout / 1000} s.`;
  if (platform === 'win32')
    return (
      `${base} ${reconnect} If Windows blocks the camera, turn on ` +
      'Let desktop apps access your camera in Settings → Privacy & security → Camera.'
    );
  if (platform !== 'darwin') return `${base} ${reconnect}`;
  const refused = cameraAccessMessage(access, packaged);
  if (refused) return `${base} ${refused}`;
  if (access === 'granted' && packaged) return `${base} ${reconnect}`;
  return (
    base +
    ' macOS sends no image to an app without camera access. If macOS asks for camera access, allow it and press Start again; otherwise ' +
    cameraAccessAdvice(packaged)
  );
}
/** What the viewer shows when ffmpeg delivers another pixel format than yuyv422. */
export function pixelFormatMessage(format, mode) {
  return mode.layout
    ? 'Exact reference requires native yuyv422; received ' + format
    : `This camera sends ${format}, not YUYV, in this video mode; choose another video mode.`;
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
/**
 * The YUYV modes of `v4l2-ctl --list-formats-ext` (v4l-utils), which also
 * reports the rates that ffmpeg's V4L2 input does not: one mode for each
 * discrete rate of a size, as AVFoundation lists them, and one with the range
 * of a stepwise or continuous rate. A size whose rates are missing or not all
 * readable is one mode without a rate. A size given as a range (`Stepwise`,
 * `Continuous`) is left out, as with ffmpeg. Both the current format lines
 * (`[0]: 'YUYV'`) and the older ones (`Pixel Format: 'YUYV'`) are read.
 */
export function parseV4l2CtlModes(output) {
  const modes = [];
  let yuyv = false;
  let size;
  const close = () => {
    if (!size) return;
    const { width, height, rates } = size;
    if (rates.length && rates.every(([min, max]) => Number.isFinite(min) && Number.isFinite(max)))
      for (const [minFps, maxFps] of rates) modes.push({ width, height, minFps, maxFps });
    else modes.push({ width, height });
    size = undefined;
  };
  for (const line of output.split(/\r?\n/)) {
    const format = /^\s*(?:\[\d+\]:|Pixel Format:)\s*'([^']*)'/.exec(line);
    if (format) {
      close();
      yuyv = format[1] === 'YUYV';
      continue;
    }
    if (!yuyv) continue;
    if (/^\s*Size:/.test(line)) {
      close();
      const discrete = /^\s*Size: Discrete (\d+)x(\d+)\s*$/.exec(line);
      if (discrete) size = { width: Number(discrete[1]), height: Number(discrete[2]), rates: [] };
      continue;
    }
    if (!size || !/^\s*Interval:/.test(line)) continue;
    const range = /\(([\d.]+)-([\d.]+) fps\)/.exec(line);
    const rate = /\(([\d.]+) fps\)/.exec(line);
    if (range) size.rates.push([Number(range[1]), Number(range[2])]);
    else size.rates.push(rate ? [Number(rate[1]), Number(rate[1])] : [NaN, NaN]);
  }
  close();
  const seen = new Set();
  return modes.filter((m) => {
    const key = `${m.width}x${m.height}@${m.minFps}-${m.maxFps}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/**
 * The device's video modes; an empty list when ffmpeg printed none it could read.
 * On Linux `v4l2-ctl` is asked first, for the frame rates; without it, or when
 * it fails or lists no YUYV size, ffmpeg's sizes come without rates.
 */
export async function listModes(platform, device, ffmpeg = findFfmpeg, exec = run, signal) {
  if (platform === 'linux' && isV4l2Device(device)) {
    // v4l2-ctl answers within a fraction of a second; ffmpeg still has its 10 s.
    const result = await exec('v4l2-ctl', ['--list-formats-ext', '-d', device], 3000, signal).catch(
      (error) => {
        if (signal?.aborted) throw error;
        return undefined;
      },
    );
    const modes = result?.code === 0 ? parseV4l2CtlModes(result.stdout) : [];
    if (modes.length) return modes;
  }
  const result = await exec(ffmpeg(), modesArgs(platform, device), 10000, signal);
  if (result.timedOut) throw new Error('Reading the camera modes timed out');
  return parseDeviceModes(platform, result.stderr);
}
/**
 * One read of a device's modes at a time, kept away from a capture that opens
 * the device. A new read stops the one before, which answers with no modes.
 * `pause()` stops the read in progress and holds new ones until every pause is
 * released by the function it returns (each one once); then they read (again),
 * so a read stopped by Start still delivers the camera's modes, and the end of
 * an old capture does not release the pause of a newer one.
 */
export function modesReader(list) {
  let current;
  const pauses = new Set();
  let gate;
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };
  return {
    async read(device) {
      current?.cancel();
      const cancelled = deferred();
      const request = { attempt: undefined, cancelled: false };
      request.cancel = () => {
        request.cancelled = true;
        request.attempt?.abort();
        cancelled.resolve();
      };
      current = request;
      try {
        for (;;) {
          while (gate && !request.cancelled) await Promise.race([gate.promise, cancelled.promise]);
          if (request.cancelled) return [];
          const attempt = new AbortController();
          request.attempt = attempt;
          try {
            const modes = await list(device, attempt.signal);
            if (!attempt.signal.aborted) return modes;
          } catch (error) {
            if (!attempt.signal.aborted) throw error;
          }
          if (request.cancelled) return [];
        }
      } finally {
        if (current === request) current = undefined;
      }
    },
    pause() {
      const pause = Symbol('pause');
      pauses.add(pause);
      gate ??= deferred();
      current?.attempt?.abort();
      return () => {
        if (!pauses.delete(pause) || pauses.size) return;
        gate?.resolve();
        gate = undefined;
      };
    },
  };
}
/**
 * When a started capture releases its pause of the mode reads (`release`, from
 * `modesReader().pause()`): on macOS and Linux once ffmpeg reports the input's
 * pixel format, so it has opened the device, as AVFoundation and V4L2 let a
 * capturing device's modes be listed; on Windows, where DirectShow may not let a
 * second process open a capturing device, only when the ffmpeg process has
 * closed. Every platform releases it when the process closes or fails to start.
 */
export function captureReadPause(platform, release) {
  return {
    opened: () => {
      if (platform !== 'win32') release();
    },
    ended: release,
  };
}

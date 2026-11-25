import {
  imageOnlyMode,
  type CameraProfile,
  type DeviceVideoMode,
  type VideoMode,
} from '@irvis/core';

/** One option of the Video mode select. */
export interface VideoModeOption {
  readonly key: string;
  readonly label: string;
  /**
   * The mode Start opens: the profile's mode with temperature data, or a mode
   * that shows the image only. Absent for an option that cannot be chosen.
   */
  readonly mode?: VideoMode;
}

const size = (m: { width: number; height: number }) => `${m.width} × ${m.height}`;
/** Cameras report rates such as 30.000030; ffmpeg's AVFoundation input allows 0.01 too. */
const FPS_TOLERANCE = 0.01;
const fps = (value: number) => Number(value.toFixed(2));
function rate(m: DeviceVideoMode) {
  if (m.minFps === undefined || m.maxFps === undefined) return '';
  const [min, max] = [fps(m.minFps), fps(m.maxFps)];
  return min === max ? ` · ${max} fps` : ` · ${min}–${max} fps`;
}
const offers = (device: DeviceVideoMode, mode: VideoMode) =>
  device.width === mode.width &&
  device.height === mode.height &&
  (device.minFps === undefined ||
    device.maxFps === undefined ||
    (device.minFps - FPS_TOLERANCE < mode.fps && mode.fps < device.maxFps + FPS_TOLERANCE));
const label = (mode: VideoMode) =>
  `${size(mode)} · ${mode.fps} fps${mode.layout ? '' : ' · image only'}`;

/**
 * The Video mode options: without the device's modes, the profile's modes;
 * with them, the device's modes in its order, each the profile's mode it
 * offers, with temperature data first, or a mode of its own that shows the
 * image only. An image-only option can be chosen only where `imageOnly` is
 * true, and a device mode only when the device reports its frame rate, which
 * it then opens at the highest.
 */
export function videoModeOptions(
  profile: CameraProfile,
  deviceModes: readonly DeviceVideoMode[] | null,
  imageOnly: boolean,
): VideoModeOption[] {
  const option = (mode: VideoMode): VideoModeOption =>
    mode.layout || imageOnly
      ? { key: mode.id, label: label(mode), mode }
      : { key: mode.id, label: label(mode) };
  if (!deviceModes) return profile.videoModes.map(option);
  const options: VideoModeOption[] = [];
  for (const device of deviceModes) {
    const own =
      profile.videoModes.find((m) => m.layout && offers(device, m)) ??
      profile.videoModes.find((m) => offers(device, m));
    const image =
      own ??
      (device.maxFps === undefined
        ? undefined
        : imageOnlyMode(device.width, device.height, device.maxFps));
    const next = image
      ? option(image)
      : {
          key: `device-${device.width}x${device.height}-${device.minFps}-${device.maxFps}`,
          label: `${size(device)}${rate(device)} · image only`,
        };
    if (!options.some((o) => o.key === next.key)) options.push(next);
  }
  return options;
}

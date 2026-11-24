import type { CameraProfile, DeviceVideoMode, VideoMode } from '@irvis/core';

/** One option of the Video mode select. */
export interface VideoModeOption {
  readonly key: string;
  readonly label: string;
  /** The profile's mode with temperature data; absent for an image-only option, which is disabled. */
  readonly mode?: VideoMode;
}

const size = (m: { width: number; height: number }) => `${m.width} × ${m.height}`;
function rate(m: DeviceVideoMode) {
  if (m.minFps === undefined || m.maxFps === undefined) return '';
  return m.minFps === m.maxFps ? ` · ${m.minFps} fps` : ` · ${m.minFps}–${m.maxFps} fps`;
}
const offers = (device: DeviceVideoMode, mode: VideoMode) =>
  device.width === mode.width &&
  device.height === mode.height &&
  (device.minFps === undefined ||
    device.maxFps === undefined ||
    (device.minFps <= mode.fps && mode.fps <= device.maxFps));

/**
 * The Video mode options: without the device's modes, the profile's modes;
 * with them, the device's modes in its order, each the profile's mode with
 * temperature data that it offers, or image only.
 */
export function videoModeOptions(
  profile: CameraProfile,
  deviceModes: readonly DeviceVideoMode[] | null,
): VideoModeOption[] {
  if (!deviceModes)
    return profile.videoModes.map((m) =>
      m.layout
        ? { key: m.id, label: `${size(m)} · ${m.fps} fps`, mode: m }
        : { key: m.id, label: `${size(m)} · ${m.fps} fps · image only` },
    );
  const options: VideoModeOption[] = [];
  for (const device of deviceModes) {
    const mode = profile.videoModes.find((m) => m.layout && offers(device, m));
    const option = mode
      ? { key: mode.id, label: `${size(mode)} · ${mode.fps} fps`, mode }
      : {
          key: `device-${device.width}x${device.height}-${device.minFps}-${device.maxFps}`,
          label: `${size(device)}${rate(device)} · image only`,
        };
    if (!options.some((o) => o.key === option.key)) options.push(option);
  }
  return options;
}

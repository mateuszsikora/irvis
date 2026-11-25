// Video modes outside a camera profile: a mode the device offers without
// temperature data, which the viewer shows as an image only.
// docs/features/core-technical.md#image-only-video-modes
import type { CameraProfile, VideoMode } from './cameras/profile.ts';

const IMAGE_ONLY_ID = /^image-([1-9]\d{0,4})x([1-9]\d{0,4})@(\d{1,4}(?:\.\d{1,2})?)$/;
/** The largest width and height an image-only mode may have. */
export const IMAGE_ONLY_MAX_SIZE = 8192;
/** The highest frame rate an image-only mode may have. */
export const IMAGE_ONLY_MAX_FPS = 1000;

/**
 * A YUYV mode without temperature data, with the id `image-<width>x<height>@<fps>`
 * and the frame rate rounded to two decimals. Undefined unless the width is an even
 * integer and the height an integer, both from 1 to IMAGE_ONLY_MAX_SIZE, and the
 * rounded rate is above 0 and at most IMAGE_ONLY_MAX_FPS.
 */
export function imageOnlyMode(width: number, height: number, fps: number): VideoMode | undefined {
  const rate = Number(fps.toFixed(2));
  const size = (value: number) =>
    Number.isInteger(value) && value > 0 && value <= IMAGE_ONLY_MAX_SIZE;
  if (!size(width) || width % 2 !== 0 || !size(height)) return undefined;
  if (!(rate > 0 && rate <= IMAGE_ONLY_MAX_FPS)) return undefined;
  return {
    id: `image-${String(width)}x${String(height)}@${String(rate)}`,
    width,
    height,
    fps: rate,
    pixelFormat: 'yuyv',
    layout: null,
  };
}

/**
 * The video mode an id names: the profile's mode with that id, or the
 * image-only mode an `image-<width>x<height>@<fps>` id describes. Undefined
 * for any other id.
 */
export function findVideoMode(profile: CameraProfile, id: string): VideoMode | undefined {
  const own = profile.videoModes.find((m) => m.id === id);
  if (own) return own;
  const match = IMAGE_ONLY_ID.exec(id);
  if (!match) return undefined;
  const mode = imageOnlyMode(Number(match[1]), Number(match[2]), Number(match[3]));
  // `image-640x480@30.0` names the same mode as `image-640x480@30`; only the latter is its id.
  return mode?.id === id ? mode : undefined;
}

// A browser's 4:2:0 frame as colours for an image-only mode:
// docs/features/core-technical.md#image-only-video-modes
import { putBt601 } from './bt601.ts';
import type { Yuv420Frame } from './frames.ts';
import { checkPlanar } from './reconstruction/planar.ts';

/**
 * A whole I420 or NV12 frame as colours to look at, 4 bytes per pixel,
 * row-major, as `ImageData`: BT.601 with limited range, as `yuyvToRgba`, with
 * one U and V pair for each 2 × 2 pixels, read through the planes' offsets and
 * strides. No reading comes from the colours.
 */
export function yuv420ToRgba(frame: Yuv420Frame): Uint8ClampedArray<ArrayBuffer> {
  checkPlanar(frame);
  const { width, height, data, planes, layout } = frame;
  const luma = planes[0]!;
  // NV12 interleaves U and V in one plane; I420 has a plane for each.
  const u = planes[1]!;
  const v = layout === 'nv12' ? { offset: u.offset + 1, stride: u.stride } : planes[2]!;
  const step = layout === 'nv12' ? 2 : 1;
  const rgba = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  // checkPlanar guarantees even sizes and planes inside the buffer, so every index below exists.
  for (let row = 0, out = 0; row < height; row++) {
    const y = luma.offset + row * luma.stride;
    const uRow = u.offset + (row >> 1) * u.stride;
    const vRow = v.offset + (row >> 1) * v.stride;
    for (let x = 0; x < width; x++, out += 4) {
      const pair = (x >> 1) * step;
      putBt601(rgba, out, data[y + x]!, data[uRow + pair]!, data[vRow + pair]!);
    }
  }
  return rgba;
}

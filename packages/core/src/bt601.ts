// One pixel of limited-range BT.601 as RGBA, shared by the image-only
// conversions: docs/features/core-technical.md#image-only-video-modes

/** Writes the pixel of Y, U and V at `out`, alpha 255; the array clamps to 0–255. */
export function putBt601(rgba: Uint8ClampedArray, out: number, y: number, u: number, v: number) {
  const luma = 1.164 * (y - 16);
  const cu = u - 128;
  const cv = v - 128;
  rgba[out] = luma + 1.596 * cv;
  rgba[out + 1] = luma - 0.392 * cu - 0.813 * cv;
  rgba[out + 2] = luma + 2.017 * cu;
  rgba[out + 3] = 255;
}

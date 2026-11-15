import type { Yuv420Frame, YuyvFrame } from '../src/frames.ts';
import { random, rawOf } from './irvis-scenes.ts';
export interface ReconstructionScene {
  name: string;
  raw: Uint16Array;
  frame: YuyvFrame;
}
export function scene(
  name: string,
  width = 256,
  height = 192,
  seed = 1,
  blur = false,
  garbage = false,
): ReconstructionScene {
  const next = random(seed);
  let raw = new Uint16Array(width * height).fill(rawOf(22));
  if (name === 'hand' || name === 'tip') {
    for (let y = Math.floor(height / 4); y < (height * 3) / 4; y++)
      for (let x = Math.floor(width / 3); x < (width * 2) / 3; x++)
        raw[y * width + x] = rawOf(name === 'hand' ? 34 : 320);
  } else if (name === 'checkerboard') {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        raw[y * width + x] = rawOf((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 80 : 22);
  } else if (name === 'random') {
    for (let r = 0; r < 24; r++) {
      const left = Math.floor(next() * width),
        top = Math.floor(next() * height);
      const right = Math.min(width, left + 2 + Math.floor((next() * width) / 3));
      const bottom = Math.min(height, top + 2 + Math.floor((next() * height) / 3));
      const value = rawOf(15 + next() * 305);
      for (let y = top; y < bottom; y++) raw.fill(value, y * width + left, y * width + right);
    }
  }
  if (blur)
    for (let pass = 0; pass < 3; pass++) {
      const output = new Uint16Array(raw.length);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              sum +=
                raw[
                  Math.max(0, Math.min(height - 1, y + dy)) * width +
                    Math.max(0, Math.min(width - 1, x + dx))
                ]!;
          output[y * width + x] = Math.round(sum / 9);
        }
      raw = output;
    }
  let min = 65535,
    max = 0;
  for (const value of raw) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < raw.length; i++) {
    data[i * 2] = garbage
      ? Math.floor(next() * 256)
      : Math.round(((raw[i]! - min) * 255) / (max - min || 1));
    data[i * 2 + 1] = 128;
    data[raw.length * 2 + i * 2] = raw[i]! & 255;
    data[raw.length * 2 + i * 2 + 1] = raw[i]! >> 8;
  }
  return {
    name: `${name}-${seed}${blur ? '-blur' : ''}${garbage ? '-garbage' : ''}`,
    raw,
    frame: { kind: 'yuyv', width, height: height * 2, timestamp: 123, data },
  };
}
/** Padded NV12 with nonzero offsets exercises WebCodecs plane addressing. */
export function toNV12(frame: Yuv420Frame): Yuv420Frame {
  const stride = frame.width + 8,
    yOffset = 7,
    uvOffset = yOffset + stride * frame.height + 11;
  const data = new Uint8Array(uvOffset + (stride * frame.height) / 2);
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++)
      data[yOffset + y * stride + x] =
        frame.data[frame.planes[0]!.offset + y * frame.planes[0]!.stride + x]!;
  for (let y = 0; y < frame.height / 2; y++)
    for (let x = 0; x < frame.width; x++) {
      const plane = frame.planes[1 + (x % 2)]!;
      data[uvOffset + y * stride + x] =
        frame.data[plane.offset + y * plane.stride + Math.floor(x / 2)]!;
    }
  return {
    ...frame,
    layout: 'nv12',
    data,
    planes: [
      { offset: yOffset, stride },
      { offset: uvOffset, stride },
    ],
  };
}

import type { Yuv420Frame, YuyvFrame } from '../frames.ts';
import { checkYuyvFrame } from '../yuyv.ts';

export function checkPlanar(frame: Yuv420Frame): void {
  const { width, height, planes, layout, data } = frame;
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n % 2 === 0))
    throw new Error('planar dimensions must be positive even integers');
  if ((layout !== 'i420' && layout !== 'nv12') || planes.length !== (layout === 'i420' ? 3 : 2))
    throw new Error('invalid planar layout');
  for (let i = 0; i < planes.length; i++) {
    const { offset, stride } = planes[i]!;
    const columns = i === 0 || layout === 'nv12' ? width : width / 2;
    const rows = i === 0 ? height : height / 2;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(stride) ||
      stride < columns ||
      offset + (rows - 1) * stride + columns > data.length
    )
      throw new Error('planar plane is outside its buffer or has an invalid stride');
  }
}

export function luma(frame: Yuv420Frame, x: number, y: number): number {
  return frame.data[frame.planes[0]!.offset + y * frame.planes[0]!.stride + x]!;
}

/** The high-byte average for thermal column x, shared by two adjacent rows. */
export function chroma(frame: Yuv420Frame, x: number, y: number): number {
  const plane = frame.planes[frame.layout === 'nv12' ? 1 : 1 + (x % 2)]!;
  return frame.data[
    plane.offset +
      Math.floor(y / 2) * plane.stride +
      (frame.layout === 'nv12' ? x : Math.floor(x / 2))
  ]!;
}

/** libyuv's vertical rounded average; no colour conversion or range scaling. */
export function simulateYUYVtoI420(frame: YuyvFrame): Yuv420Frame {
  checkYuyvFrame(frame);
  const { width, height } = frame;
  if (height % 2 !== 0) throw new Error('simulation requires an even height');
  const size = width * height;
  const data = new Uint8Array((size * 3) / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = frame.data[(y * width + x) * 2]!;
      if (y % 2 === 0) {
        const at = size + ((x % 2) * size) / 4 + ((y / 2) * width) / 2 + Math.floor(x / 2);
        data[at] =
          (frame.data[(y * width + x) * 2 + 1]! + frame.data[((y + 1) * width + x) * 2 + 1]! + 1) >>
          1;
      }
    }
  }
  return {
    kind: 'yuv420',
    layout: 'i420',
    width,
    height,
    timestamp: frame.timestamp,
    data,
    planes: [
      { offset: 0, stride: width },
      { offset: size, stride: width / 2 },
      { offset: (size * 5) / 4, stride: width / 2 },
    ],
  };
}

import { describe, expect, it } from 'vitest';
import type { Yuv420Frame, YuyvFrame } from './frames.ts';
import { simulateYUYVtoI420 } from './reconstruction/planar.ts';
import { yuv420ToRgba } from './yuv420.ts';
import { yuyvToRgba } from './yuyv.ts';

// Two rows of black, white and pure red's Y, U and V, the same in both rows, so
// that 4:2:0 loses nothing against 4:2:2.
const yuyv: YuyvFrame = {
  kind: 'yuyv',
  width: 4,
  height: 2,
  data: Uint8Array.from([16, 128, 235, 128, 81, 90, 81, 240, 16, 128, 235, 128, 81, 90, 81, 240]),
  timestamp: 0,
};

describe('yuv420ToRgba', () => {
  it('gives an I420 frame the colours of the YUYV frame it came from', () => {
    expect(Array.from(yuv420ToRgba(simulateYUYVtoI420(yuyv)))).toEqual(
      Array.from(yuyvToRgba(yuyv)),
    );
  });

  it('reads NV12 through its interleaved chroma plane and row strides', () => {
    // Rows padded to 6 bytes; the padding bytes are 0 and must not be read.
    const frame: Yuv420Frame = {
      kind: 'yuv420',
      layout: 'nv12',
      width: 4,
      height: 2,
      timestamp: 0,
      data: Uint8Array.from([
        16, 235, 81, 81, 0, 0, 16, 235, 81, 81, 0, 0, 128, 128, 90, 240, 0, 0,
      ]),
      planes: [
        { offset: 0, stride: 6 },
        { offset: 12, stride: 6 },
      ],
    };
    expect(Array.from(yuv420ToRgba(frame))).toEqual(Array.from(yuyvToRgba(yuyv)));
  });

  it('throws on planes outside the buffer', () => {
    const frame = { ...simulateYUYVtoI420(yuyv), data: new Uint8Array(4) };
    expect(() => yuv420ToRgba(frame)).toThrow(
      'planar plane is outside its buffer or has an invalid stride',
    );
  });
});

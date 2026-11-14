import { describe, expect, it } from 'vitest';
import type { CameraStateSnapshot, VideoMode } from './cameras/profile.ts';
import type { YuyvFrame } from './frames.ts';
import { checkYuyvFrame, decodeThermalFrame, decodeYuyvImage, decodeYuyvRaw } from './yuyv.ts';

function frame(width: number, height: number, fill: (i: number) => number): YuyvFrame {
  const data = new Uint8Array(width * height * 2);
  for (let i = 0; i < data.length; i++) data[i] = fill(i) & 0xff;
  return { kind: 'yuyv', width, height, data, timestamp: 12.5 };
}

const mode: VideoMode = {
  id: 'yuyv-4x4',
  width: 4,
  height: 4,
  fps: 25,
  pixelFormat: 'yuyv',
  layout: {
    image: { firstRow: 0, rows: 2 },
    thermal: { firstRow: 2, rows: 2, packing: 'u16le' },
  },
};

const state: CameraStateSnapshot = { origin: 'assumed', values: {} };

describe('decodeYuyvRaw', () => {
  it('reads lo and hi bytes', () => {
    const f = frame(2, 1, (i) => [0x34, 0x12, 0xff, 0xab][i] ?? 0);
    expect([...decodeYuyvRaw(f, { firstRow: 0, rows: 1 })]).toEqual([0x1234, 0xabff]);
  });

  it('reads only the given rows', () => {
    const f = frame(4, 4, (i) => i);
    const raw = decodeYuyvRaw(f, { firstRow: 2, rows: 2 });
    expect(raw.length).toBe(8);
    // Row 2 starts at byte 2 × 4 × 2 = 16.
    expect(raw[0]).toBe(16 | (17 << 8));
    expect(raw[7]).toBe(30 | (31 << 8));
  });

  it('reads a frame that is a view into a larger buffer', () => {
    const buffer = new Uint8Array(3 + 8);
    buffer.set([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08], 3);
    const f: YuyvFrame = {
      kind: 'yuyv',
      width: 2,
      height: 2,
      data: buffer.subarray(3),
      timestamp: 0,
    };
    expect([...decodeYuyvRaw(f, { firstRow: 1, rows: 1 })]).toEqual([0x0605, 0x0807]);
  });

  it('rejects rows outside the frame', () => {
    const f = frame(4, 4, () => 0);
    expect(() => decodeYuyvRaw(f, { firstRow: 3, rows: 2 })).toThrow(
      'rows 3 to 4 are not inside the 4-row frame',
    );
    expect(() => decodeYuyvRaw(f, { firstRow: 0, rows: 0 })).toThrow(
      'rows must be a positive integer, not 0',
    );
  });
});

describe('decodeYuyvImage', () => {
  it('splits Y, U and V', () => {
    // Two rows of two pixel pairs: [Y0 U Y1 V] = [10 20 11 30], [12 21 13 31], ...
    const bytes = [10, 20, 11, 30, 12, 21, 13, 31, 14, 22, 15, 32, 16, 23, 17, 33];
    const f = frame(4, 2, (i) => bytes[i] ?? 0);
    const image = decodeYuyvImage(f, { firstRow: 0, rows: 2 });
    expect(image.width).toBe(4);
    expect(image.height).toBe(2);
    expect([...image.y]).toEqual([10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...image.u]).toEqual([20, 21, 22, 23]);
    expect([...image.v]).toEqual([30, 31, 32, 33]);
  });
});

describe('checkYuyvFrame', () => {
  it('rejects a frame with the wrong byte count', () => {
    const f: YuyvFrame = {
      kind: 'yuyv',
      width: 4,
      height: 4,
      data: new Uint8Array(31),
      timestamp: 0,
    };
    expect(() => {
      checkYuyvFrame(f);
    }).toThrow('YUYV frame has 31 bytes, expected 32 for 4×4');
  });

  it('rejects an odd width', () => {
    const f: YuyvFrame = {
      kind: 'yuyv',
      width: 3,
      height: 1,
      data: new Uint8Array(6),
      timestamp: 0,
    };
    expect(() => {
      checkYuyvFrame(f);
    }).toThrow('YUYV frame width 3 is not a positive even integer');
  });
});

describe('decodeThermalFrame', () => {
  it('decodes the thermal rows of the mode', () => {
    const f = frame(4, 4, (i) => (i < 16 ? 0xee : i % 2 === 0 ? 0x00 : 0x48));
    const conversion = { kind: 'linear', scale: 1 / 64, offset: -273.15 } as const;
    const thermal = decodeThermalFrame(f, mode, conversion, state);
    expect(thermal.width).toBe(4);
    expect(thermal.height).toBe(2);
    expect(thermal.timestamp).toBe(12.5);
    expect([...thermal.raw]).toEqual(new Array<number>(8).fill(0x4800));
    expect(thermal.conversion).toBe(conversion);
    expect(thermal.cameraState).toBe(state);
    expect(thermal.uncertain).toBeNull();
  });

  it('rejects a mode without temperature data', () => {
    const f = frame(4, 4, () => 0);
    const conversion = { kind: 'linear', scale: 1, offset: 0 } as const;
    expect(() => decodeThermalFrame(f, { ...mode, layout: null }, conversion, state)).toThrow(
      "video mode 'yuyv-4x4' carries no temperature data",
    );
  });

  it('rejects a frame of another size', () => {
    const f = frame(4, 2, () => 0);
    const conversion = { kind: 'linear', scale: 1, offset: 0 } as const;
    expect(() => decodeThermalFrame(f, mode, conversion, state)).toThrow(
      "frame is 4×2, video mode 'yuyv-4x4' is 4×4",
    );
  });
});

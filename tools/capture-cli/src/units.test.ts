import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FrameSplitter } from './capture.ts';
import { main, UsageError } from './cli.ts';
import { pgm, png, stretch } from './image.ts';
import { chooseDevice, guessDevice, parseCelsius } from './spike.ts';
import { histogram, quantile, ranks, spearman, summarize } from './stats.ts';
import { describeConfiguration, guid } from './usb.ts';
import { formatWarning } from './commands.ts';

describe('FrameSplitter', () => {
  it('cuts chunks into whole frames', () => {
    const s = new FrameSplitter(4);
    expect(s.push(new Uint8Array([1, 2, 3]))).toEqual([]);
    const frames = s.push(new Uint8Array([4, 5, 6, 7, 8, 9, 10]));
    expect(frames.map((f) => [...f])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
    expect(s.trailingBytes).toBe(2);
    // Each frame is its own array, not a view that the next chunk overwrites.
    s.push(new Uint8Array([11, 12]));
    expect([...(frames[1] ?? [])]).toEqual([5, 6, 7, 8]);
  });
});

describe('stats', () => {
  it('ranks ties by their mean rank', () => {
    expect([...ranks([10, 20, 20, 5])]).toEqual([2, 3.5, 3.5, 1]);
  });

  it('gives Spearman 1 for a monotonic relation and -1 for an inverse one', () => {
    const a = [1, 2, 3, 4, 5];
    expect(spearman(a, [1, 4, 9, 16, 25])).toBeCloseTo(1, 12);
    expect(spearman(a, [5, 4, 3, 2, 1])).toBeCloseTo(-1, 12);
    expect(spearman(a, [1, 1, 1, 1, 1])).toBeNaN();
  });

  it('summarises, takes quantiles and bins', () => {
    expect(summarize([1, 2, 3, 4])).toEqual({
      count: 4,
      mean: 2.5,
      sd: Math.sqrt(1.25),
      min: 1,
      max: 4,
    });
    expect(quantile([4, 1, 3, 2], 0.5)).toBe(2.5);
    expect(histogram([20.2, 20.9, 21.5, 23], 1)).toEqual([
      { from: 20, to: 21, count: 2 },
      { from: 21, to: 22, count: 1 },
      { from: 22, to: 23, count: 0 },
      { from: 23, to: 24, count: 1 },
    ]);
  });
});

describe('image', () => {
  it('writes 8- and 16-bit PGM', () => {
    const eight = pgm(2, 1, new Uint8Array([0, 255]));
    expect(new TextDecoder().decode(eight.subarray(0, 11))).toBe('P5\n2 1\n255\n');
    expect([...eight.subarray(11)]).toEqual([0, 255]);
    const sixteen = pgm(1, 1, new Uint16Array([0x1234]));
    expect(new TextDecoder().decode(sixteen.subarray(0, 13))).toBe('P5\n1 1\n65535\n');
    expect([...sixteen.subarray(13)]).toEqual([0x12, 0x34]);
  });

  it('writes a greyscale PNG whose rows inflate back', () => {
    const file = png(3, 2, new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect([...file.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(file.buffer, file.byteOffset);
    const ihdrLength = view.getUint32(8);
    const idatAt = 8 + 12 + ihdrLength;
    const idatLength = view.getUint32(idatAt);
    const rows = inflateSync(file.subarray(idatAt + 8, idatAt + 8 + idatLength));
    expect([...rows]).toEqual([0, 1, 2, 3, 0, 4, 5, 6]);
    expect([...stretch(new Uint16Array([100, 150, 200]))]).toEqual([0, 128, 255]);
  });
});

describe('USB descriptors', () => {
  it('formats a GUID', () => {
    const bytes = new Uint8Array([
      0x59, 0x55, 0x59, 0x32, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b,
      0x71,
    ]);
    expect(guid(bytes)).toBe('32595559-0000-0010-8000-00aa00389b71');
  });

  it('decodes UVC formats, frames and extension units', () => {
    const yuy2 = [
      0x59, 0x55, 0x59, 0x32, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b,
      0x71,
    ];
    const xu = new Array<number>(16).fill(0x11);
    const interval = 400000; // 25 fps in 100 ns units
    const le32 = (v: number): number[] => [
      v & 0xff,
      (v >> 8) & 0xff,
      (v >> 16) & 0xff,
      (v >>> 24) & 0xff,
    ];
    const bytes = new Uint8Array([
      ...[9, 0x02, 0, 0, 2, 1, 0, 0x80, 250], // configuration
      ...[9, 0x04, 0, 0, 1, 0x0e, 0x01, 0, 0], // interface 0: video control
      ...[24, 0x24, 0x06, 3, ...xu, 8, 1, 2, 0], // extension unit 3, 8 controls (bLength 24)
      ...[7, 0x05, 0x83, 0x03, 16, 0, 8], // interrupt endpoint
      ...[9, 0x04, 1, 0, 0, 0x0e, 0x02, 0, 0], // interface 1: video streaming
      ...[27, 0x24, 0x04, 1, 1, ...yuy2, 16, 1, 0, 0, 0, 0], // format 1: YUY2
      ...[
        30,
        0x24,
        0x05,
        1,
        0,
        0,
        1,
        0x80,
        1,
        ...le32(0),
        ...le32(0),
        ...le32(196608),
        ...le32(interval),
        1,
        ...le32(interval),
      ],
    ]);
    const lines = describeConfiguration(bytes);
    expect(lines).toContain(
      '  VC_EXTENSION_UNIT id 3: guid 11111111-1111-1111-1111-111111111111, 8 control(s)',
    );
    expect(lines).toContain(
      '  VS_FORMAT_UNCOMPRESSED 1: YUY2 (guid 32595559-0000-0010-8000-00aa00389b71), 16 bits per pixel, 1 frame size(s)',
    );
    expect(lines).toContain(
      '  VS_FRAME_UNCOMPRESSED 1: 256×384, buffer 196608 B, default 25.00 fps, intervals 25.00 fps',
    );
    expect(lines).toContain('  endpoint 0x83 in interrupt, max packet 16 × 1');
  });
});

describe('command line', () => {
  it('prints the usage and rejects bad arguments', async () => {
    expect(await main(['--help'])).toContain('Usage: capture-cli <command> [options]');
    await expect(main(['bogus'])).rejects.toThrow(new UsageError("unknown command 'bogus'"));
    await expect(
      main(['capture', '--device', '1', '--seconds', '5', '--out', 'x', '--mode', '200']),
    ).rejects.toThrow("--mode must be 384 or 192, not '200'");
    await expect(main(['capture', '--device=-1'])).rejects.toThrow(
      "--device must be an integer of at least 0, not '-1'",
    );
    await expect(main(['report'])).rejects.toThrow('<dir> is required');
  });

  it('rejects an empty device and a capture longer than ten hours', async () => {
    await expect(main(['probe', '--device='])).rejects.toThrow('--device is required');
    await expect(
      main(['capture', '--device', '1', '--seconds', '36001', '--mode', '384', '--out', 'x']),
    ).rejects.toThrow("--seconds must be a positive number of at most 36000, not '36001'");
  });

  it('takes a negative reference reading', async () => {
    await expect(main(['reference', '/nonexistent', '-5'])).rejects.toThrow(
      '/nonexistent has no meta.json',
    );
    await expect(main(['reference', '/nonexistent', '--', '-5'])).rejects.toThrow(
      '/nonexistent has no meta.json',
    );
    await expect(main(['reference', '/nonexistent'])).rejects.toThrow('<°C> is required');
  });

  it('warns when AVFoundation changed the pixel format', () => {
    expect(formatWarning('yuyv422')).toBe('');
    expect(formatWarning('uyvy422')).toBe(
      "warning: AVFoundation delivered uyvy422, not yuyv422; the bytes are not in the camera's order\n",
    );
  });

  it('reads a typed temperature', () => {
    expect(parseCelsius(' 23,5 ')).toBe(23.5);
    expect(parseCelsius('')).toBeNull();
    expect(() => parseCelsius('warm')).toThrow("'warm' is not a temperature");
  });
});

describe('spike device choice', () => {
  const devices = [
    { index: 0, name: 'FaceTime HD Camera' },
    { index: 1, name: 'USB Camera' },
  ];

  it('suggests the thermal camera and takes it on Enter', () => {
    expect(guessDevice(devices)).toBe(1);
    expect(chooseDevice('', 1, devices)).toBe(1);
    expect(chooseDevice(' 0 ', 1, devices)).toBe(0);
  });

  it('asks again instead of picking device 0', () => {
    expect(guessDevice([{ index: 0, name: 'FaceTime HD Camera' }])).toBeNull();
    expect(() => chooseDevice('', null, devices)).toThrow('type the index of the thermal camera');
    expect(() => chooseDevice('x', null, devices)).toThrow("'x' is not a device index");
    expect(() => chooseDevice('7', null, devices)).toThrow(
      'there is no device [7] in the list above',
    );
  });
});

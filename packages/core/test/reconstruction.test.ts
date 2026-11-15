import { describe, expect, it } from 'vitest';
import {
  compareFrames,
  reconstructPlanar,
  simulateYUYVtoI420,
} from '../src/reconstruction/index.ts';
import { scene, toNV12 } from './reconstruction-scenes.ts';
const options = { thermal: { firstRow: 48, rows: 48 }, image: { firstRow: 0, rows: 48 } };
describe('planar reconstruction', () => {
  it('preserves low bytes and models rounded chroma including extremes', () => {
    const data = new Uint8Array(4 * 4 * 2);
    for (let i = 0; i < 16; i++) {
      data[i * 2] = i * 17;
      data[i * 2 + 1] = [0, 255, 1, 254, 255, 0, 2, 253][i % 8]!;
    }
    const frame = simulateYUYVtoI420({ kind: 'yuyv', width: 4, height: 4, timestamp: 0, data });
    expect(Array.from(frame.data.subarray(0, 16))).toEqual(
      Array.from({ length: 16 }, (_, i) => i * 17),
    );
    expect(Array.from(frame.data.subarray(16))).toEqual([128, 2, 128, 2, 128, 254, 128, 254]);
  });
  it('recovers scenes without edges inside row pairs exactly', () => {
    for (const name of ['background', 'hand', 'tip', 'checkerboard']) {
      const s = scene(name, 64, 48),
        planar = simulateYUYVtoI420(s.frame);
      expect(reconstructPlanar(planar, options).raw, name).toEqual(s.raw);
      expect(reconstructPlanar(planar, { thermal: options.thermal }).raw, name).toEqual(s.raw);
    }
  });
  it('gives identical I420 and padded NV12 results', () => {
    const planar = simulateYUYVtoI420(scene('random', 64, 48, 3, true).frame);
    expect(reconstructPlanar(toNV12(planar), options)).toEqual(reconstructPlanar(planar, options));
  });
  it('disables garbage hints and enables registered monotonic hints', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const bad = reconstructPlanar(
        simulateYUYVtoI420(scene('random', 64, 48, seed, true, true).frame),
        options,
      );
      expect(bad.hint.enabled).toBe(false);
    }
    expect(
      reconstructPlanar(simulateYUYVtoI420(scene('random', 64, 48, 1).frame), options).hint.enabled,
    ).toBe(true);
  });
  it('pins synthetic regression quality and preserves the observation model', () => {
    for (let seed = 1; seed <= 20; seed++)
      for (const blur of [false, true])
        for (const garbage of [false, true]) {
          const s = scene('random', 64, 48, seed, blur, garbage),
            planar = simulateYUYVtoI420(s.frame);
          const result = reconstructPlanar(planar, options);
          const metrics = compareFrames(s.raw, result.raw, planar, options.thermal, 1 / 64, 0);
          const minimumExact = blur ? (garbage ? 0.44 : 0.918) : garbage ? 0.947 : 0.991;
          const maximumMean = blur ? (garbage ? 8.83 : 0.64) : garbage ? 4.46 : 0.036;
          expect(metrics.exactMatch).toBeGreaterThanOrEqual(minimumExact);
          expect(metrics.meanAbsoluteError).toBeLessThanOrEqual(maximumMean);
          const model = compareFrames(result.raw, result.raw, planar, options.thermal, 1 / 64, 0);
          expect(model.yMatch).toBe(1);
          expect(model.chromaModelMatch).toBe(1);
          for (let y = 0; y < 48; y += 2)
            for (let x = 0; x < 64; x++) {
              const i = y * 64 + x;
              const average = (values: Uint16Array): number =>
                ((values[i]! >> 8) + (values[i + 64]! >> 8) + 1) >> 1;
              expect(average(result.raw)).toBe(average(s.raw));
            }
          expect(result.passes).toBeLessThanOrEqual(4);
          expect(result.uncertain.every((v, i) => v === 1 - result.confident[i]!)).toBe(true);
        }
  });
  it('reports known errors in flat reference pixels', () => {
    const s = scene('background', 4, 4),
      planar = simulateYUYVtoI420(s.frame),
      raw = s.raw.slice();
    raw[0] = raw[0]! + 256;
    const m = compareFrames(s.raw, raw, planar, { firstRow: 4, rows: 4 }, 1 / 64, 12);
    expect(m).toEqual({
      yMatch: 1,
      chromaModelMatch: 1,
      exactMatch: 15 / 16,
      flatRegionMatch: 15 / 16,
      byteJumps: [0],
      meanAbsoluteError: 0.25,
      p99AbsoluteError: 4,
      maxAbsoluteError: 4,
      milliseconds: 12,
    });
  });
  it('returns no flat metric when the reference has no flat pixels', () => {
    const s = scene('background', 4, 4),
      planar = simulateYUYVtoI420(s.frame);
    const raw = Uint16Array.from({ length: 16 }, (_, i) => (i % 2 ? 20000 : 10000));
    expect(
      compareFrames(raw, raw, planar, { firstRow: 4, rows: 4 }, 1 / 64, 0).flatRegionMatch,
    ).toBeNull();
  });
  it('rejects malformed frames and unaligned thermal rows', () => {
    const planar = simulateYUYVtoI420(scene('background', 64, 48).frame);
    expect(() => reconstructPlanar({ ...planar, data: new Uint8Array(1) }, options)).toThrow(
      'planar plane',
    );
    expect(() => reconstructPlanar(planar, { thermal: { firstRow: 1, rows: 48 } })).toThrow(
      'pair-aligned',
    );
    expect(() => reconstructPlanar({ ...planar, width: 3 }, options)).toThrow('positive even');
  });
});

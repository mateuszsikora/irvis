import { describe, expect, it } from 'vitest';
import {
  type Scene,
  deadPixelScene,
  hotTipScene,
  maxError,
  movingHandScene,
  nucScene,
  staticScene,
} from '../../test/irvis-scenes.ts';
import { FrameDecoder, FrameEncoder } from './codec.ts';

/** Encodes every frame (a keyframe every `interval`), decodes it, and returns the largest error. */
function roundTrip(scene: Scene, tolerance: number, interval = 25): number {
  const encoder = new FrameEncoder(scene.width, scene.height, tolerance);
  const decoder = new FrameDecoder(scene.width, scene.height);
  let worst = 0;
  scene.frames.forEach((raw, f) => {
    const keyframe = f % interval === 0;
    const encoded = encoder.encode(raw, keyframe);
    const decoded = decoder.decode(encoded.body, keyframe, encoder.step);
    expect(decoded).toEqual(encoded.values);
    worst = Math.max(worst, maxError(raw, decoded));
  });
  return worst;
}

const small = { width: 40, height: 24, frames: 30 };
const odd = { width: 37, height: 29, frames: 12 };

describe('frame codec', () => {
  it('is lossless at tolerance 0', () => {
    expect(roundTrip(movingHandScene(small), 0)).toBe(0);
    expect(roundTrip(deadPixelScene(small), 0)).toBe(0);
  });

  it('keeps every value within the tolerance', () => {
    for (const tolerance of [1, 4, 8, 16, 100]) {
      for (const scene of [staticScene(small), movingHandScene(small), movingHandScene(odd)]) {
        expect(roundTrip(scene, tolerance)).toBeLessThanOrEqual(tolerance);
      }
    }
  });

  it('keeps the guarantee through temperature jumps, dead pixels and a NUC', () => {
    for (const tolerance of [0, 8, 16]) {
      expect(roundTrip(hotTipScene(5, small), tolerance)).toBeLessThanOrEqual(tolerance);
      expect(roundTrip(deadPixelScene(small), tolerance)).toBeLessThanOrEqual(tolerance);
      expect(roundTrip(nucScene(10, 4, 400, small), tolerance)).toBeLessThanOrEqual(tolerance);
    }
  });

  it('returns arrays that the encoder and decoder do not use again', () => {
    const scene = movingHandScene({ width: 16, height: 16, frames: 4 });
    const encoder = new FrameEncoder(16, 16, 8);
    const decoder = new FrameDecoder(16, 16);
    scene.frames.forEach((raw, f) => {
      const encoded = encoder.encode(raw, f === 0);
      const expected = encoded.values.slice();
      encoded.values.fill(0);
      const decoded = decoder.decode(encoded.body, f === 0, encoder.step);
      expect(decoded).toEqual(expected);
      decoded.fill(0);
    });
  });

  it('escapes residuals that do not fit in a byte', () => {
    const encoder = new FrameEncoder(8, 8, 0);
    const decoder = new FrameDecoder(8, 8);
    const cold = new Uint16Array(64).fill(1000);
    const hot = cold.slice();
    hot[9] = 0xffff;
    hot[10] = 0;
    for (const [raw, keyframe] of [
      [cold, true],
      [hot, false],
      [cold, false],
    ] as const) {
      const encoded = encoder.encode(raw, keyframe);
      expect(decoder.decode(encoded.body, keyframe, encoder.step)).toEqual(raw);
    }
  });

  it('skips the blocks of a static scene and sends moving ones', () => {
    const tolerance = 16;
    const quiet = new FrameEncoder(256, 192, tolerance);
    const still = staticScene({ frames: 3 });
    quiet.encode(still.frames[0] ?? new Uint16Array(0), true);
    const stats = quiet.encode(still.frames[1] ?? new Uint16Array(0), false).stats;
    expect(stats.skip).toBeGreaterThan(760);

    const moving = movingHandScene({ frames: 11 });
    const busy = new FrameEncoder(256, 192, tolerance);
    busy.encode(moving.frames[0] ?? new Uint16Array(0), true);
    const motion = busy.encode(moving.frames[10] ?? new Uint16Array(0), false).stats;
    expect(motion.dense + motion.sparse).toBeGreaterThan(20);
  });

  it('rejects a first frame that is not a keyframe and a frame of another size', () => {
    const encoder = new FrameEncoder(8, 8, 0);
    expect(() => encoder.encode(new Uint16Array(64), false)).toThrow(
      'the first frame must be a keyframe',
    );
    expect(() => encoder.encode(new Uint16Array(63), true)).toThrow(
      'frame has 63 values, expected 64 for 8×8',
    );
    expect(() => new FrameEncoder(8, 8, -1)).toThrow(
      'tolerance -1 is not an integer from 0 to 32767',
    );
  });

  it('rejects a damaged body', () => {
    const encoder = new FrameEncoder(16, 16, 0);
    const decoder = new FrameDecoder(16, 16);
    const raw = new Uint16Array(256).fill(5000);
    const key = encoder.encode(raw, true);
    const extra = new Uint8Array(key.body.length + 1);
    extra.set(key.body);
    expect(() => decoder.decode(extra, true, 1)).toThrow(
      'frame body has 1 bytes after its last value',
    );
    decoder.reset();
    expect(() => decoder.decode(Uint8Array.of(0, 0, 0, 0), false, 1)).toThrow(
      'a frame that is not a keyframe has no previous frame',
    );
    decoder.decode(key.body, true, 1);
    expect(() => decoder.decode(Uint8Array.of(0, 7, 0, 0), false, 1)).toThrow(
      'unknown block mode 7',
    );
  });
});

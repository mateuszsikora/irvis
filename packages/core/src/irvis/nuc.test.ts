import { describe, expect, it } from 'vitest';
import { CONVERSION, nucScene, staticScene } from '../../test/irvis-scenes.ts';
import { NucDetector, kelvinPerRaw } from './nuc.ts';

const options = { width: 32, height: 24, frames: 40 };

function events(frames: Uint16Array[]): [number, string][] {
  const detector = new NucDetector();
  const out: [number, string][] = [];
  frames.forEach((raw, f) => {
    const event = detector.push(raw, CONVERSION);
    if (event !== null) out.push([f, event]);
  });
  return out;
}

describe('NucDetector', () => {
  it('reports nothing in sensor noise', () => {
    expect(events(staticScene(options).frames)).toEqual([]);
  });

  it('reports the first frame after a frozen run', () => {
    expect(events(nucScene(10, 5, 0, options).frames)).toEqual([[15, 'frozen']]);
  });

  it('ignores a frame that the backend delivered twice', () => {
    const scene = staticScene(options);
    for (let f = 7; f < scene.frames.length; f += 10) {
      scene.frames[f] = (scene.frames[f - 1] ?? new Uint16Array(0)).slice();
    }
    expect(events(scene.frames)).toEqual([]);
  });

  it('reports a jump of the mean', () => {
    // 64 raw units are 1 K under the P2 Pro conversion.
    const scene = nucScene(20, 0, 64, options);
    expect(events(scene.frames)).toEqual([[20, 'step']]);
  });

  it('ignores a jump smaller than the minimum in kelvin', () => {
    expect(events(nucScene(20, 0, 16, options).frames)).toEqual([]);
  });
});

describe('kelvinPerRaw', () => {
  it('is the slope of each kind of conversion', () => {
    expect(kelvinPerRaw(CONVERSION, 18000)).toBe(1 / 64);
    expect(kelvinPerRaw({ kind: 'polynomial', coefficients: [1, 2, 3] }, 10)).toBe(62);
    expect(kelvinPerRaw({ kind: 'lut', firstRaw: 100, celsius: [20, 20.5, 21.5] }, 101)).toBe(1);
    expect(kelvinPerRaw({ kind: 'linear', scale: 0, offset: 0 }, 1)).toBeNull();
  });
});

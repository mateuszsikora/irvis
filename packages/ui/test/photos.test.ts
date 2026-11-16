import { describe, expect, it } from 'vitest';
import { orientPhoto, photoCorrection } from '../src/photos.ts';
import type { ThermalFrame } from '@irvis/core';
const frame: ThermalFrame = {
  width: 3,
  height: 2,
  timestamp: 0,
  raw: new Uint16Array([1, 2, 3, 4, 5, 6]),
  uncertain: new Uint8Array([1, 0, 0, 0, 0, 0]),
  conversion: { kind: 'linear', scale: 1, offset: 0 },
  cameraState: { origin: 'assumed', values: {} },
};
describe('photo geometry', () => {
  it('transforms thermal pixels and uncertainty with displayed mirrors and rotation', () => {
    expect([...orientPhoto(frame, 90, false, false).raw]).toEqual([4, 1, 5, 2, 6, 3]);
    expect([...orientPhoto(frame, 180, false, false).raw]).toEqual([6, 5, 4, 3, 2, 1]);
    expect([...orientPhoto(frame, 270, false, false).raw]).toEqual([3, 6, 2, 5, 1, 4]);
    const mirrored = orientPhoto(frame, 90, true, false);
    expect(mirrored.width).toBe(2);
    expect(mirrored.height).toBe(3);
    expect([...mirrored.raw]).toEqual([6, 3, 5, 2, 4, 1]);
    expect([...mirrored.uncertain!]).toEqual([0, 0, 0, 0, 0, 1]);
    expect([...orientPhoto(frame, 0, false, true).raw]).toEqual([4, 5, 6, 1, 2, 3]);
    expect(frame.raw[0]).toBe(1);
  });
  it('restores valid correction metadata without importing captured objects', () => {
    const correction = { emissivity: 0.8, reflectedCelsius: 25, offsetKelvin: 2 };
    expect(photoCorrection({ correction, objects: ['captured'] })).toEqual(correction);
    expect(photoCorrection(correction)).toEqual(correction);
    expect(photoCorrection({ correction: { ...correction, emissivity: 0 } })).toBeNull();
  });
});

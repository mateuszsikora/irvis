import { describe, it, expect } from 'vitest';
import { compare } from '@irvis/backend-electron';
import { simulateYUYVtoI420, type VideoMode, type YuyvFrame } from '@irvis/core';
describe('desktop comparison', () => {
  const mode: VideoMode = {
    id: 'test',
    width: 4,
    height: 4,
    fps: 25,
    pixelFormat: 'yuyv',
    layout: { thermal: { firstRow: 2, rows: 2, packing: 'u16le' } },
  };
  const data = new Uint8Array(32);
  for (let i = 16; i < 32; i += 2) {
    data[i] = 0;
    data[i + 1] = 75;
  }
  const frame: YuyvFrame = { kind: 'yuyv', width: 4, height: 4, data, timestamp: 0 };
  it('compares only thermal rows against the exact reference', () => {
    const result = compare(frame, mode, 1 / 64);
    expect(Array.from(result.reference)).toEqual(new Array(8).fill(19200));
    expect(result.metrics).toMatchObject({
      exactMatch: 1,
      yMatch: 1,
      chromaModelMatch: 1,
      byteJumps: [],
    });
  });
  it('does not claim bit-exact metrics for unsynchronized live frames', () => {
    const result = compare(frame, mode, 1 / 64, simulateYUYVtoI420(frame));
    expect(result.metrics).not.toHaveProperty('exactMatch');
    expect(result.metrics).not.toHaveProperty('flatRegionMatch');
  });
  it('rejects truncated references and mismatched planar dimensions', () => {
    expect(() => compare({ ...frame, data: data.slice(1) }, mode, 1 / 64)).toThrow('Reference');
    expect(() => compare(frame, mode, 1 / 64, { ...simulateYUYVtoI420(frame), width: 2 })).toThrow(
      'Planar',
    );
  });
});

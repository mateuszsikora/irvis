import { describe, it, expect } from 'vitest';
import { cameraProfiles, simulateYUYVtoI420 } from '@irvis/core';
import { analyse } from '../src/analysis.ts';
const mode = {
  ...cameraProfiles[0]!.videoModes.find((m) => m.layout)!,
  width: 2,
  height: 2,
  layout: { thermal: { firstRow: 0, rows: 2, packing: 'u16le' as const } },
};
export function fixture() {
  const frame = simulateYUYVtoI420({
    kind: 'yuyv',
    width: 2,
    height: 2,
    timestamp: 10,
    data: new Uint8Array([1, 75, 1, 75, 1, 75, 1, 75]),
  });
  const info = {
    format: 'I420' as const,
    codedWidth: 2,
    codedHeight: 2,
    timestampUs: 10000,
    colorSpace: {},
    visibleRect: null,
  };
  return { frame, info, mode };
}
describe('browser analysis', () => {
  it('reports statistics for a flat synthetic planar frame', () => {
    const { frame, info } = fixture();
    const result = analyse(frame, mode, info);
    expect(result.statistics).toMatchObject({
      minRaw: 19201,
      maxRaw: 19201,
      meanRaw: 19201,
      centerRaw: 19201,
      uncertainFraction: 0,
    });
    expect(result.statistics.highByteHistogram[75]).toBe(4);
    expect(result.statistics.highByteHistogram.reduce((a, b) => a + b, 0)).toBe(4);
    expect(result.frame).toBe(frame);
    expect(result.reconstructionMs).toBeGreaterThanOrEqual(0);
  });
});

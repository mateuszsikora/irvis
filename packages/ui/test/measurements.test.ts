import { describe, expect, it } from 'vitest';
import { analyze, geometry, initialAnalysis } from '../src/measurements.ts';

describe('viewer measurements', () => {
  it('excludes uncertain markers and reports local extrema for multiple objects', () => {
    const image = {
      width: 3,
      height: 3,
      celsius: new Float64Array([1, 2, 3, 4, 100, 6, 7, 8, 9]),
      uncertain: new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]),
    };
    const result = analyze(image, {
      ...initialAnalysis,
      tracking: { min: true, max: true, centre: true },
      objects: [
        { id: 1, kind: 'Point', x: 50, y: 50, x2: 0, y2: 0 },
        { id: 2, kind: 'Line', x: 0, y: 0, x2: 100, y2: 0 },
        { id: 3, kind: 'Area', x: 0, y: 0, x2: 100, y2: 100 },
      ],
    });
    expect(result.text).toContain('centre: –');
    expect(result.text).toContain('Point 1: –');
    expect(result.text).toContain('Line 2: min 1.0 °C, max 3.0 °C');
    expect(result.text).toContain('Area 3: min 1.0 °C, max 9.0 °C');
    expect(result.markers.every((p) => p.x !== 1 || p.y !== 1)).toBe(true);
    expect(
      analyze(
        { ...image, uncertain: new Uint8Array(9).fill(1) },
        { ...initialAnalysis, tracking: { min: true, max: true, centre: true } },
      ).markers,
    ).toHaveLength(0);
  });
  it('keeps reversed rectangle ends inside images including one pixel photos', () => {
    const object = { id: 1, kind: 'Area' as const, x: 100, y: 100, x2: 0, y2: 0 };
    expect(geometry(object, { width: 3, height: 2 }).area).toEqual({
      x: 0,
      y: 0,
      width: 3,
      height: 2,
    });
    expect(geometry(object, { width: 1, height: 1 }).area).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
});

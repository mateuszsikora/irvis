import { describe, expect, it } from 'vitest';
import {
  inIsotherm,
  isothermMask,
  isothermProblems,
  paintIsotherms,
  type Isotherm,
} from './isotherms.ts';

const hot: Isotherm = { kind: 'above', celsius: 40, color: [255, 0, 0] };
const cold: Isotherm = { kind: 'below', celsius: 10, color: [0, 0, 255] };
const skin: Isotherm = { kind: 'between', minCelsius: 30, maxCelsius: 40, color: [0, 255, 0] };

describe('isotherms', () => {
  it('include their bounds', () => {
    expect(inIsotherm(40, hot)).toBe(true);
    expect(inIsotherm(39.99, hot)).toBe(false);
    expect(inIsotherm(10, cold)).toBe(true);
    expect(inIsotherm(10.01, cold)).toBe(false);
    expect([29.99, 30, 35, 40, 40.01].map((c) => inIsotherm(c, skin))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect([hot, cold, skin].some((i) => inIsotherm(Number.NaN, i))).toBe(false);
  });

  it('never mark uncertain pixels or pixels without a temperature', () => {
    const values = Float64Array.from([45, 45, Number.NaN, 35, 5]);
    const uncertain = Uint8Array.from([0, 1, 0, 0, 0]);
    expect(Array.from(isothermMask(values, uncertain, hot))).toEqual([1, 0, 0, 0, 0]);
    expect(Array.from(isothermMask(values, null, hot))).toEqual([1, 1, 0, 0, 0]);

    const rgba = new Uint8ClampedArray(values.length * 4).fill(7);
    const counts = paintIsotherms(rgba, values, uncertain, [hot, cold, skin]);
    expect(counts).toEqual([1, 1, 1]);
    expect(Array.from(rgba)).toEqual([
      ...[255, 0, 0, 7],
      ...[7, 7, 7, 7],
      ...[7, 7, 7, 7],
      ...[0, 255, 0, 7],
      ...[0, 0, 255, 7],
    ]);

    // ±Infinity has no temperature either, as in the measurements of src/analysis/.
    const infinite = Float64Array.from([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
    expect(Array.from(isothermMask(infinite, null, hot))).toEqual([0, 0]);
    expect(Array.from(isothermMask(infinite, null, cold))).toEqual([0, 0]);
    expect(paintIsotherms(new Uint8ClampedArray(8), infinite, null, [hot, cold, skin])).toEqual([
      0, 0, 0,
    ]);
  });

  it('paint a later isotherm over an earlier one', () => {
    const values = Float64Array.from([40, 50]);
    const rgba = new Uint8Array(8);
    expect(paintIsotherms(rgba, values, null, [hot, skin])).toEqual([2, 1]);
    expect(Array.from(rgba)).toEqual([0, 255, 0, 0, 255, 0, 0, 0]);
  });

  it('reject invalid isotherms and images of another size', () => {
    expect(isothermProblems({ kind: 'above', celsius: Number.NaN, color: [0, 0, 256] })).toEqual([
      'celsius must be a finite number',
      'color must be three integers from 0 to 255',
    ]);
    expect(
      isothermProblems({ kind: 'between', minCelsius: 5, maxCelsius: 4, color: [0, 0, 0] }),
    ).toEqual(['minCelsius must not be above maxCelsius']);
    expect(
      isothermProblems({
        kind: 'between',
        minCelsius: 5,
        maxCelsius: Infinity,
        color: [0, 0.5, 0],
      }),
    ).toEqual([
      'minCelsius and maxCelsius must be finite numbers',
      'color must be three integers from 0 to 255',
    ]);
    const short = [255, 0] as unknown as Isotherm['color'];
    const long = [1, 2, 3, 4] as unknown as Isotherm['color'];
    for (const color of [short, long]) {
      expect(isothermProblems({ kind: 'below', celsius: 0, color })).toEqual([
        'color must be three integers from 0 to 255',
      ]);
    }
    const values = new Float64Array(3);
    expect(() =>
      paintIsotherms(new Uint8Array(12), values, null, [hot, { ...cold, celsius: Infinity }]),
    ).toThrow('invalid isotherm 1: celsius must be a finite number');
    expect(() => paintIsotherms(new Uint8Array(11), values, null, [hot])).toThrow(
      'RGBA image has 11 bytes, expected 12',
    );
    expect(() => isothermMask(values, new Uint8Array(4), hot)).toThrow(
      'uncertain mask has 4 values, expected 3',
    );
  });
});

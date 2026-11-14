import { describe, expect, it } from 'vitest';
import { toCelsius, toCelsiusArray } from './conversion.ts';

describe('toCelsius', () => {
  it('applies a linear conversion', () => {
    const c = { kind: 'linear', scale: 1 / 64, offset: -273.15 } as const;
    // 298.15 K × 64 = 19081.6; 19082 / 64 = 298.15625 K.
    expect(toCelsius(19082, c)).toBeCloseTo(25.00625, 10);
    expect(toCelsius(0, c)).toBe(-273.15);
  });

  it('applies a polynomial by Horner scheme', () => {
    const c = { kind: 'polynomial', coefficients: [1, 2, 3] } as const;
    expect(toCelsius(2, c)).toBe(1 + 2 * 2 + 3 * 4);
  });

  it('looks up a table and gives NaN outside it', () => {
    const c = { kind: 'lut', firstRaw: 10, celsius: [20, 21, 22] } as const;
    expect(toCelsius(11, c)).toBe(21);
    expect(toCelsius(9, c)).toBeNaN();
    expect(toCelsius(13, c)).toBeNaN();
  });

  it('converts a whole frame', () => {
    const c = { kind: 'linear', scale: 2, offset: 1 } as const;
    expect([...toCelsiusArray(new Uint16Array([0, 1, 2]), c)]).toEqual([1, 3, 5]);
  });
});

import { describe, expect, it } from 'vitest';
import type { CelsiusImage } from './image.ts';
import { paletteLut } from './palettes.ts';
import { rangeProblems } from './range.ts';
import { autoRange, paletteIndex, renderPalette } from './render.ts';

function image(values: number[], uncertain: number[] | null = null): CelsiusImage {
  return {
    width: values.length,
    height: 1,
    celsius: Float64Array.from(values),
    uncertain: uncertain ? Uint8Array.from(uncertain) : null,
  };
}

const range = { minCelsius: 20, maxCelsius: 40 };

describe('paletteIndex', () => {
  it('maps the range onto 256 entries and clamps outside it', () => {
    expect(paletteIndex(20, range)).toBe(0);
    expect(paletteIndex(40, range)).toBe(255);
    expect(paletteIndex(30, range)).toBe(128);
    expect(paletteIndex(20 + 20 / 256, range)).toBe(1);
    expect(paletteIndex(20 + 20 / 256 - 1e-9, range)).toBe(0);
    expect(paletteIndex(-100, range)).toBe(0);
    expect(paletteIndex(1000, range)).toBe(255);
    expect(paletteIndex(Number.POSITIVE_INFINITY, range)).toBe(255);
    expect(paletteIndex(Number.NEGATIVE_INFINITY, range)).toBe(0);
    expect(paletteIndex(Number.NaN, range)).toBe(-1);
  });

  it('rejects a range that is empty or not finite', () => {
    expect(rangeProblems(range)).toEqual([]);
    expect(rangeProblems({ minCelsius: 30, maxCelsius: 30 })).toEqual([
      'minCelsius must be below maxCelsius',
    ]);
    expect(rangeProblems({ minCelsius: Number.NaN, maxCelsius: 30 })).toEqual([
      'minCelsius and maxCelsius must be finite numbers',
    ]);
    expect(() => paletteIndex(25, { minCelsius: 40, maxCelsius: 20 })).toThrow(
      'invalid range: minCelsius must be below maxCelsius',
    );
  });
});

describe('autoRange', () => {
  it('spans the counted pixels only', () => {
    expect(autoRange(image([25, 90, Number.NaN, 31, -40], [0, 1, 0, 0, 1]))).toEqual({
      minCelsius: 25,
      maxCelsius: 31,
    });
    expect(autoRange(image([25, 90, 31]))).toEqual({ minCelsius: 25, maxCelsius: 90 });
  });

  it('centres 1 K on a flat frame and gives null when no pixel counts', () => {
    expect(autoRange(image([22, 22, 50], [0, 0, 1]))).toEqual({
      minCelsius: 21.5,
      maxCelsius: 22.5,
    });
    expect(autoRange(image([Number.NaN, 50], [0, 1]))).toBeNull();
  });
});

describe('renderPalette', () => {
  it('colours each reading by its palette entry, with alpha 255', () => {
    const iron = paletteLut('iron');
    const rgba = renderPalette(Float64Array.from([20, 30, 40, 50]), range, 'iron');
    expect(rgba).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(rgba)).toEqual([
      ...iron.subarray(0, 3),
      255,
      ...iron.subarray(128 * 3, 128 * 3 + 3),
      255,
      ...iron.subarray(765, 768),
      255,
      ...iron.subarray(765, 768),
      255,
    ]);
  });

  it('leaves pixels without a temperature transparent and colours uncertain ones', () => {
    const rgba = renderPalette(Float64Array.from([Number.NaN, 30]), range, 'white-hot');
    expect(Array.from(rgba)).toEqual([0, 0, 0, 0, 128, 128, 128, 255]);
  });

  it('writes into a given image and rejects one of another size', () => {
    const out = new Uint8ClampedArray(8).fill(9);
    expect(renderPalette(Float64Array.from([Number.NaN, 40]), range, 'black-hot', out)).toBe(out);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 0, 0, 255]);
    expect(() => renderPalette(Float64Array.from([1]), range, 'iron', out)).toThrow(
      'RGBA image has 8 bytes, expected 4',
    );
    expect(() =>
      renderPalette(Float64Array.from([1]), { minCelsius: 1, maxCelsius: 1 }, 'iron'),
    ).toThrow('invalid range: minCelsius must be below maxCelsius');
  });

  it('never gives a warmer reading a colder entry', () => {
    // Readings that are not exact in binary, so the mapping's rounding counts.
    const odd = { minCelsius: 20.1, maxCelsius: 38.7 };
    const values = Float64Array.from({ length: 1000 }, (_, i) => 19.9 + i * 0.0213);
    const indexes = Array.from(values, (v) => paletteIndex(v, odd));
    expect(indexes.every((v, i) => i === 0 || v >= (indexes[i - 1] ?? 0))).toBe(true);
    expect(new Set(indexes).size).toBe(256);
    const rgba = renderPalette(values, odd, 'rainbow');
    const lut = paletteLut('rainbow');
    for (const [i, index] of indexes.entries()) {
      expect(Array.from(rgba.subarray(i * 4, i * 4 + 3))).toEqual(
        Array.from(lut.subarray(index * 3, index * 3 + 3)),
      );
    }
  });
});

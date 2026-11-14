import { describe, expect, it } from 'vitest';
import type { CameraStateSnapshot, Conversion } from '../cameras/profile.ts';
import { DEFAULT_CORRECTION } from '../corrections/emissivity.ts';
import type { ThermalFrame } from '../frames.ts';
import { celsiusImage, checkImage, type CelsiusImage } from './image.ts';
import { histogram, measureArea, measureFrame, measureLine, measurePoint } from './measurements.ts';

const NaN_ = Number.NaN;

/** A width × height image whose reading at (x, y) is `f(x, y)`. */
function grid(
  width: number,
  height: number,
  f: (x: number, y: number) => number,
  uncertain: ((x: number, y: number) => boolean) | null = null,
): CelsiusImage {
  const celsius = new Float64Array(width * height);
  const mask = uncertain ? new Uint8Array(width * height) : null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      celsius[y * width + x] = f(x, y);
      if (mask && uncertain?.(x, y)) mask[y * width + x] = 1;
    }
  }
  return { width, height, celsius, uncertain: mask };
}

describe('measureFrame', () => {
  it('finds min and max with their position', () => {
    const image = grid(4, 3, (x, y) => 20 + x + y * 4);
    const stats = measureFrame(image);
    expect(stats.min).toEqual({ x: 0, y: 0, index: 0, celsius: 20 });
    expect(stats.max).toEqual({ x: 3, y: 2, index: 11, celsius: 31 });
    expect(stats.pixels).toBe(12);
    expect(stats.counted).toBe(12);
    expect(stats.mean).toBe(25.5);
  });

  it('takes the first pixel in row-major order on a tie', () => {
    const image = grid(3, 3, (x, y) => (x === 2 || y === 2 ? 50 : 10));
    const { min, max } = measureFrame(image);
    expect(min?.index).toBe(0);
    expect(max).toEqual({ x: 2, y: 0, index: 2, celsius: 50 });
  });

  it('skips uncertain pixels and pixels without a temperature', () => {
    // The hottest and coldest values sit on uncertain or NaN pixels.
    const image = grid(
      3,
      2,
      (x, y) => [90, 30, NaN_, 25, -50, 35][y * 3 + x] ?? 0,
      (x, y) => (x === 0 && y === 0) || (x === 1 && y === 1),
    );
    const stats = measureFrame(image);
    expect(stats.min).toEqual({ x: 0, y: 1, index: 3, celsius: 25 });
    expect(stats.max).toEqual({ x: 2, y: 1, index: 5, celsius: 35 });
    expect(stats.counted).toBe(3);
    expect(stats.mean).toBe(30);
  });

  it('gives no min or max when no pixel counts', () => {
    const stats = measureFrame(
      grid(
        2,
        1,
        () => 40,
        () => true,
      ),
    );
    expect(stats).toEqual({ pixels: 2, counted: 0, mean: NaN_, min: null, max: null });
  });
});

describe('measurePoint', () => {
  it('averages the 3×3 pixels around the point', () => {
    const image = grid(5, 5, (x, y) => x * 10 + y);
    const stats = measurePoint(image, { x: 2, y: 2 });
    expect(stats.pixels).toBe(9);
    expect(stats.mean).toBe(22);
    expect(stats.min).toEqual({ x: 1, y: 1, index: 6, celsius: 11 });
    expect(stats.max).toEqual({ x: 3, y: 3, index: 18, celsius: 33 });
  });

  it('takes only the neighbours inside the image at its edge', () => {
    const image = grid(5, 5, (x, y) => x * 10 + y);
    expect(measurePoint(image, { x: 0, y: 0 })).toMatchObject({ pixels: 4, mean: 5.5 });
    expect(measurePoint(image, { x: 4, y: 2 })).toMatchObject({ pixels: 6, mean: 37 });
    expect(
      measurePoint(
        grid(1, 1, () => 7),
        { x: 0, y: 0 },
      ),
    ).toMatchObject({ pixels: 1, mean: 7 });
  });

  it('skips uncertain pixels and pixels without a temperature', () => {
    const image = grid(
      3,
      3,
      (x, y) => (x === 1 && y === 1 ? 500 : x === 0 && y === 0 ? NaN_ : 20),
      (x, y) => x === 1 && y === 1,
    );
    expect(measurePoint(image, { x: 1, y: 1 })).toMatchObject({ pixels: 9, counted: 7, mean: 20 });
    const lost = grid(
      1,
      1,
      () => 30,
      () => true,
    );
    expect(measurePoint(lost, { x: 0, y: 0 }).mean).toBeNaN();
  });

  it('rejects a point outside the image or between pixels', () => {
    const image = grid(4, 3, () => 0);
    expect(() => measurePoint(image, { x: 4, y: 0 })).toThrow(
      'point (4, 0) is not a pixel of the 4×3 image',
    );
    expect(() => measurePoint(image, { x: 1.5, y: 0 })).toThrow(
      'point (1.5, 0) is not a pixel of the 4×3 image',
    );
    expect(() => measurePoint(image, { x: 0, y: -1 })).toThrow('point (0, -1)');
  });
});

describe('measureLine', () => {
  const image = grid(6, 4, (x, y) => x + y * 100);

  it('samples every pixel from start to end', () => {
    const line = measureLine(image, { x: 0, y: 0 }, { x: 5, y: 2 });
    expect(Array.from(line.x)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Array.from(line.y)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(Array.from(line.celsius)).toEqual([0, 1, 102, 103, 204, 205]);
    expect(line.stats.min?.celsius).toBe(0);
    expect(line.stats.max).toEqual({ x: 5, y: 2, index: 17, celsius: 205 });
  });

  it('runs backwards, vertically and on a single pixel', () => {
    const back = measureLine(image, { x: 3, y: 3 }, { x: 3, y: 0 });
    expect(Array.from(back.y)).toEqual([3, 2, 1, 0]);
    expect(Array.from(back.x)).toEqual([3, 3, 3, 3]);
    const one = measureLine(image, { x: 2, y: 1 }, { x: 2, y: 1 });
    expect(Array.from(one.celsius)).toEqual([102]);
  });

  it('ends at its end point in every direction', () => {
    const big = grid(9, 9, () => 0);
    for (let x = 0; x < 9; x++) {
      for (let y = 0; y < 9; y++) {
        const line = measureLine(big, { x: 4, y: 4 }, { x, y });
        const n = line.x.length;
        expect(n).toBe(Math.max(Math.abs(x - 4), Math.abs(y - 4)) + 1);
        expect([line.x[n - 1], line.y[n - 1]]).toEqual([x, y]);
        for (let i = 1; i < n; i++) {
          expect(Math.abs((line.x[i] ?? 0) - (line.x[i - 1] ?? 0))).toBeLessThanOrEqual(1);
          expect(Math.abs((line.y[i] ?? 0) - (line.y[i - 1] ?? 0))).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('marks uncertain samples and leaves them out of its statistics', () => {
    const masked = grid(
      4,
      1,
      (x) => [10, 99, NaN_, 20][x] ?? 0,
      (x) => x === 1,
    );
    const line = measureLine(masked, { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(Array.from(line.celsius)).toEqual([10, 99, NaN_, 20]);
    expect(Array.from(line.uncertain)).toEqual([0, 1, 0, 0]);
    expect(line.stats).toMatchObject({ pixels: 4, counted: 2, mean: 15 });
    expect(line.stats.max?.celsius).toBe(20);
  });

  it('rejects ends outside the image', () => {
    expect(() => measureLine(image, { x: 0, y: 0 }, { x: 6, y: 0 })).toThrow(
      'line end (6, 0) is not a pixel of the 6×4 image',
    );
    expect(() => measureLine(image, { x: -1, y: 0 }, { x: 0, y: 0 })).toThrow(
      'line start (-1, 0) is not a pixel of the 6×4 image',
    );
  });
});

describe('measureArea', () => {
  it('measures the pixels of the rectangle', () => {
    const image = grid(5, 4, (x, y) => x + y * 10);
    const stats = measureArea(image, { x: 1, y: 1, width: 3, height: 2 });
    expect(stats.pixels).toBe(6);
    expect(stats.mean).toBe(17);
    expect(stats.min).toEqual({ x: 1, y: 1, index: 6, celsius: 11 });
    expect(stats.max).toEqual({ x: 3, y: 2, index: 13, celsius: 23 });
  });

  it('skips uncertain pixels and pixels without a temperature', () => {
    const image = grid(
      3,
      1,
      (x) => [NaN_, 500, 25][x] ?? 0,
      (x) => x === 1,
    );
    const stats = measureArea(image, { x: 0, y: 0, width: 3, height: 1 });
    expect(stats).toMatchObject({ pixels: 3, counted: 1, mean: 25 });
    expect(stats.min?.index).toBe(2);
    expect(stats.max?.index).toBe(2);
  });

  it('rejects a rectangle that is empty or leaves the image', () => {
    const image = grid(5, 4, () => 0);
    expect(() => measureArea(image, { x: 3, y: 0, width: 3, height: 1 })).toThrow(
      'area 3×1 at (3, 0) is not inside the 5×4 image',
    );
    expect(() => measureArea(image, { x: 0, y: 0, width: 0, height: 1 })).toThrow('area 0×1');
    expect(() => measureArea(image, { x: 0.5, y: 0, width: 1, height: 1 })).toThrow('area 1×1');
  });
});

describe('histogram', () => {
  it('counts readings per bin, the top of the range in the last one', () => {
    const image = grid(6, 1, (x) => [20, 24.99, 25, 29.99, 30, 30][x] ?? 0);
    const h = histogram(image, { minCelsius: 20, maxCelsius: 30 }, 2);
    expect(Array.from(h.counts)).toEqual([2, 4]);
    expect(h).toMatchObject({ minCelsius: 20, maxCelsius: 30, below: 0, above: 0, skipped: 0 });
  });

  it('counts readings outside the range apart and skips uncertain ones', () => {
    const image = grid(
      6,
      1,
      (x) => [10, 21, 35, 40, NaN_, 22][x] ?? 0,
      (x) => x === 5,
    );
    const h = histogram(image, { minCelsius: 20, maxCelsius: 30 }, 10);
    expect(Array.from(h.counts)).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(h).toMatchObject({ below: 1, above: 2, skipped: 2 });
  });

  it('covers only an area when given one', () => {
    const image = grid(4, 2, (x, y) => x + y * 4);
    const h = histogram(image, { minCelsius: 0, maxCelsius: 8 }, 8, {
      x: 1,
      y: 0,
      width: 2,
      height: 2,
    });
    expect(Array.from(h.counts)).toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
  });

  it('rejects an empty range, a bad bin count and an area outside the image', () => {
    const image = grid(2, 2, () => 0);
    expect(() => histogram(image, { minCelsius: 5, maxCelsius: 5 }, 4)).toThrow(
      'invalid range: minCelsius must be below maxCelsius',
    );
    expect(() => histogram(image, { minCelsius: 0, maxCelsius: 1 }, 0)).toThrow(
      'bins must be an integer from 1 to 65536, not 0',
    );
    expect(() =>
      histogram(image, { minCelsius: 0, maxCelsius: 1 }, 4, { x: 1, y: 1, width: 2, height: 1 }),
    ).toThrow('area 2×1 at (1, 1) is not inside the 2×2 image');
  });
});

describe('celsiusImage', () => {
  it('carries the corrected readings with the frame size and mask', () => {
    const conversion: Conversion = { kind: 'linear', scale: 1 / 64, offset: -273.15 };
    const cameraState: CameraStateSnapshot = { origin: 'assumed', values: {} };
    const frame: ThermalFrame = {
      width: 2,
      height: 1,
      timestamp: 0,
      raw: Uint16Array.from([(273.15 + 20) * 64, 0]),
      conversion,
      cameraState,
      uncertain: Uint8Array.from([0, 1]),
    };
    const image = celsiusImage(frame, DEFAULT_CORRECTION);
    expect(image.width).toBe(2);
    expect(image.height).toBe(1);
    expect(image.uncertain).toBe(frame.uncertain);
    expect(image.celsius[0]).toBeCloseTo(20, 1);
    expect(image.celsius[1]).toBeNaN();
  });

  it('rejects an image whose size and arrays disagree', () => {
    const celsius = new Float64Array(6);
    expect(() => checkImage({ width: 3, height: 2, celsius, uncertain: null })).not.toThrow();
    expect(() => checkImage({ width: 4, height: 2, celsius, uncertain: null })).toThrow(
      'image has 6 readings, expected 8',
    );
    expect(() => checkImage({ width: 0, height: 2, celsius, uncertain: null })).toThrow(
      'image size 0×2 is not two positive integers',
    );
    expect(() =>
      checkImage({ width: 3, height: 2, celsius, uncertain: new Uint8Array(5) }),
    ).toThrow('uncertain mask has 5 values, expected 6');
    expect(() => measureFrame({ width: 4, height: 2, celsius, uncertain: null })).toThrow(
      'image has 6 readings, expected 8',
    );
  });
});

// Min and max with their position, point, line and area measurements on
// corrected readings. Uncertain pixels and pixels without a temperature are
// skipped: docs/decisions/architecture.md#alarms-and-isotherms-skip-uncertain-pixels
import { checkImage, counts, type CelsiusImage, type PixelReading } from './image.ts';
import { checkRange, type TemperatureRange } from './range.ts';

/** A pixel position: integer column and row inside the image. */
export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

/** A rectangle of whole pixels: its top-left pixel and its size. */
export interface PixelArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Readings of the pixels of a region (a frame, an area, a point's neighbourhood, a line). */
export interface RegionStats {
  /** Pixels in the region. */
  readonly pixels: number;
  /** Pixels that count: certain, with a temperature. The rest are skipped. */
  readonly counted: number;
  /** Mean of the counted readings in °C, summed in the region's order; NaN when none counts. */
  readonly mean: number;
  /** The coldest counted pixel, the first in the region's order on a tie; null when none counts. */
  readonly min: PixelReading | null;
  /** The hottest counted pixel, the first in the region's order on a tie; null when none counts. */
  readonly max: PixelReading | null;
}

/** The pixels a line passes through and their readings. */
export interface LineProfile {
  /** Column of each sample, from the line's start to its end. */
  readonly x: Int32Array;
  /** Row of each sample. */
  readonly y: Int32Array;
  /** The reading of each sample in °C, uncertain pixels included, NaN where none. */
  readonly celsius: Float64Array;
  /** 1 where the sample's pixel is uncertain, 0 elsewhere. */
  readonly uncertain: Uint8Array;
  /** The counted samples; `pixels` is the number of samples. */
  readonly stats: RegionStats;
}

class Accumulator {
  pixels = 0;
  counted = 0;
  private sum = 0;
  private minAt = -1;
  private maxAt = -1;
  private minValue = Number.NaN;
  private maxValue = Number.NaN;

  private readonly image: CelsiusImage;

  constructor(image: CelsiusImage) {
    this.image = image;
  }

  add(index: number): void {
    this.pixels++;
    if (!counts(this.image, index)) return;
    const value = this.image.celsius[index] ?? Number.NaN;
    this.counted++;
    this.sum += value;
    if (this.minAt < 0 || value < this.minValue) {
      this.minValue = value;
      this.minAt = index;
    }
    if (this.maxAt < 0 || value > this.maxValue) {
      this.maxValue = value;
      this.maxAt = index;
    }
  }

  stats(): RegionStats {
    return {
      pixels: this.pixels,
      counted: this.counted,
      mean: this.counted > 0 ? this.sum / this.counted : Number.NaN,
      min: this.reading(this.minAt),
      max: this.reading(this.maxAt),
    };
  }

  private reading(index: number): PixelReading | null {
    if (index < 0) return null;
    const { width } = this.image;
    const x = index % width;
    return { x, y: (index - x) / width, index, celsius: this.image.celsius[index] ?? Number.NaN };
  }
}

function checkPoint(image: CelsiusImage, point: PixelPoint, name: string): void {
  const { x, y } = point;
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= image.width ||
    y >= image.height
  ) {
    throw new Error(
      `${name} (${String(x)}, ${String(y)}) is not a pixel of the ${String(image.width)}×${String(image.height)} image`,
    );
  }
}

/** Throws unless the area is whole pixels inside the image, at least one pixel large. */
export function checkArea(image: CelsiusImage, area: PixelArea): void {
  const { x, y, width, height } = area;
  const whole = [x, y, width, height].every((v) => Number.isInteger(v));
  if (
    !whole ||
    x < 0 ||
    y < 0 ||
    width < 1 ||
    height < 1 ||
    x + width > image.width ||
    y + height > image.height
  ) {
    throw new Error(
      `area ${String(width)}×${String(height)} at (${String(x)}, ${String(y)}) is not inside the ${String(image.width)}×${String(image.height)} image`,
    );
  }
}

function areaStats(image: CelsiusImage, area: PixelArea): RegionStats {
  const acc = new Accumulator(image);
  for (let row = area.y; row < area.y + area.height; row++) {
    for (let col = area.x; col < area.x + area.width; col++) acc.add(row * image.width + col);
  }
  return acc.stats();
}

/** Min, max and mean of the whole frame, in row-major order. */
export function measureFrame(image: CelsiusImage): RegionStats {
  checkImage(image);
  return areaStats(image, { x: 0, y: 0, width: image.width, height: image.height });
}

/**
 * The reading at a pixel: the mean of the 3×3 pixels around it, of those
 * that count. At the edge of the image only the neighbours inside it are
 * taken (4 in a corner, 6 along an edge).
 */
export function measurePoint(image: CelsiusImage, point: PixelPoint): RegionStats {
  checkImage(image);
  checkPoint(image, point, 'point');
  const x0 = Math.max(0, point.x - 1);
  const y0 = Math.max(0, point.y - 1);
  const x1 = Math.min(image.width - 1, point.x + 1);
  const y1 = Math.min(image.height - 1, point.y + 1);
  return areaStats(image, { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
}

/** Min, max and mean of the pixels of an area, in row-major order. */
export function measureArea(image: CelsiusImage, area: PixelArea): RegionStats {
  checkImage(image);
  checkArea(image, area);
  return areaStats(image, area);
}

/**
 * The profile along a line from `from` to `to`, both ends included: the
 * pixels Bresenham's algorithm visits, one per column or per row, whichever
 * the line spans more of, in order from `from`.
 */
export function measureLine(image: CelsiusImage, from: PixelPoint, to: PixelPoint): LineProfile {
  checkImage(image);
  checkPoint(image, from, 'line start');
  checkPoint(image, to, 'line end');
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const sx = to.x >= from.x ? 1 : -1;
  const sy = to.y >= from.y ? 1 : -1;
  const n = Math.max(dx, dy) + 1;
  const xs = new Int32Array(n);
  const ys = new Int32Array(n);
  const celsius = new Float64Array(n);
  const uncertain = new Uint8Array(n);
  const acc = new Accumulator(image);
  let x = from.x;
  let y = from.y;
  let err = dx - dy;
  for (let i = 0; i < n; i++) {
    const index = y * image.width + x;
    xs[i] = x;
    ys[i] = y;
    celsius[i] = image.celsius[index] ?? Number.NaN;
    uncertain[i] = image.uncertain && image.uncertain[index] !== 0 ? 1 : 0;
    acc.add(index);
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return { x: xs, y: ys, celsius, uncertain, stats: acc.stats() };
}

/** Readings counted per temperature bin. */
export interface Histogram {
  /** The bounds the bins divide, in °C. */
  readonly minCelsius: number;
  readonly maxCelsius: number;
  /**
   * Pixels per bin. Bin k holds the readings from minCelsius + k × w
   * (included) to minCelsius + (k + 1) × w, with w = (max − min) / bins; the
   * last bin also holds maxCelsius.
   */
  readonly counts: Uint32Array;
  /** Counted pixels below minCelsius. */
  readonly below: number;
  /** Counted pixels above maxCelsius. */
  readonly above: number;
  /** Pixels skipped: uncertain, or without a temperature. */
  readonly skipped: number;
}

/**
 * How the counted readings of the frame, or of an area of it, spread over
 * `bins` equal bins from `minCelsius` to `maxCelsius`. A reading v goes to
 * bin floor((v − min) × bins / (max − min)).
 */
export function histogram(
  image: CelsiusImage,
  range: TemperatureRange,
  bins: number,
  area: PixelArea | null = null,
): Histogram {
  checkImage(image);
  checkRange(range);
  const { minCelsius: min, maxCelsius: max } = range;
  if (!Number.isInteger(bins) || bins < 1 || bins > 65536) {
    throw new Error(`bins must be an integer from 1 to 65536, not ${String(bins)}`);
  }
  const region = area ?? { x: 0, y: 0, width: image.width, height: image.height };
  checkArea(image, region);
  const out = new Uint32Array(bins);
  const span = max - min;
  let below = 0;
  let above = 0;
  let skipped = 0;
  for (let row = region.y; row < region.y + region.height; row++) {
    for (let col = region.x; col < region.x + region.width; col++) {
      const index = row * image.width + col;
      if (!counts(image, index)) {
        skipped++;
        continue;
      }
      const value = image.celsius[index] ?? Number.NaN;
      if (value < min) below++;
      else if (value > max) above++;
      else {
        const bin = Math.min(bins - 1, Math.floor(((value - min) * bins) / span));
        out[bin] = (out[bin] ?? 0) + 1;
      }
    }
  }
  return { minCelsius: min, maxCelsius: max, counts: out, below, above, skipped };
}

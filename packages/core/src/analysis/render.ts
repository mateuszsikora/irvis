// Readings to an RGBA image through a palette, with an automatic or a manual
// range: docs/decisions/architecture.md#palettes-are-256-colour-ramps-defined-by-stops
import type { CelsiusImage } from './image.ts';
import { measureFrame } from './measurements.ts';
import { lutOf, PALETTE_SIZE, type PaletteId } from './palettes.ts';
import { checkRange, type TemperatureRange } from './range.ts';

/** Kelvin of the range `autoRange` gives a frame whose counted pixels all read the same. */
export const FLAT_RANGE_SPAN = 1;

/**
 * The automatic range: from the coldest to the hottest pixel that counts
 * (certain, with a temperature). When they are equal, a range of
 * `FLAT_RANGE_SPAN` centred on that reading. Null when no pixel counts.
 */
export function autoRange(image: CelsiusImage): TemperatureRange | null {
  const { min, max } = measureFrame(image);
  if (!min || !max) return null;
  if (min.celsius < max.celsius) return { minCelsius: min.celsius, maxCelsius: max.celsius };
  const half = FLAT_RANGE_SPAN / 2;
  return { minCelsius: min.celsius - half, maxCelsius: max.celsius + half };
}

/**
 * The palette entry of a reading: floor((v − min) × 256 / (max − min)),
 * clamped to 0 below the range and 255 above it, so the range's top reading
 * gets 255. −1 for a reading that is not finite (NaN, ±Infinity).
 */
export function paletteIndex(celsius: number, range: TemperatureRange): number {
  checkRange(range);
  return indexIn(celsius, range.minCelsius, range.maxCelsius - range.minCelsius);
}

function indexIn(celsius: number, min: number, span: number): number {
  if (!Number.isFinite(celsius)) return -1;
  const index = Math.floor(((celsius - min) * PALETTE_SIZE) / span);
  return index < 0 ? 0 : index >= PALETTE_SIZE ? PALETTE_SIZE - 1 : index;
}

/**
 * The readings as an RGBA image (4 bytes per reading, row-major, as
 * `ImageData`), coloured by `paletteIndex` in the palette, alpha 255. A
 * reading without a temperature (NaN or ±Infinity) is transparent black
 * (0, 0, 0, 0).
 * Uncertain pixels are coloured like the others; the viewer marks them.
 * Writes into `out` when given (its length must be 4 × the readings) and
 * returns it.
 */
export function renderPalette(
  celsius: Float64Array,
  range: TemperatureRange,
  palette: PaletteId,
  out: Uint8ClampedArray<ArrayBuffer> | null = null,
): Uint8ClampedArray<ArrayBuffer> {
  checkRange(range);
  const lut = lutOf(palette);
  const rgba = out ?? new Uint8ClampedArray(celsius.length * 4);
  if (rgba.length !== celsius.length * 4) {
    throw new Error(
      `RGBA image has ${String(rgba.length)} bytes, expected ${String(celsius.length * 4)}`,
    );
  }
  const min = range.minCelsius;
  const span = range.maxCelsius - min;
  for (let i = 0; i < celsius.length; i++) {
    const index = indexIn(celsius[i] ?? Number.NaN, min, span);
    const o = i * 4;
    if (index < 0) {
      rgba[o] = 0;
      rgba[o + 1] = 0;
      rgba[o + 2] = 0;
      rgba[o + 3] = 0;
      continue;
    }
    rgba[o] = lut[index * 3] ?? 0;
    rgba[o + 1] = lut[index * 3 + 1] ?? 0;
    rgba[o + 2] = lut[index * 3 + 2] ?? 0;
    rgba[o + 3] = 255;
  }
  return rgba;
}

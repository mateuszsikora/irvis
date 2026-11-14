// Corrected readings of one frame with their size and uncertain-pixel mask,
// the input of every measurement: docs/features/core-technical.md#interfaces
import { correctFrame, type CorrectionSettings } from '../corrections/emissivity.ts';
import type { ThermalFrame } from '../frames.ts';

/** One reading per pixel, in °C, with the frame's size and uncertain mask. */
export interface CelsiusImage {
  /** Pixels per row. */
  readonly width: number;
  /** Rows. */
  readonly height: number;
  /** width × height readings in °C, row-major; NaN where a pixel has no temperature. */
  readonly celsius: Float64Array;
  /** 1 where the value is uncertain, 0 elsewhere; null when every value is exact. */
  readonly uncertain: Uint8Array | null;
}

/** A pixel and its reading. */
export interface PixelReading {
  /** Column, from 0. */
  readonly x: number;
  /** Row, from 0. */
  readonly y: number;
  /** Row-major index: y × width + x. */
  readonly index: number;
  /** The reading in °C. */
  readonly celsius: number;
}

/**
 * The corrected readings of a frame (`correctFrame`) with its width, height
 * and uncertain mask, ready for the measurements.
 */
export function celsiusImage(frame: ThermalFrame, settings: CorrectionSettings): CelsiusImage {
  return {
    width: frame.width,
    height: frame.height,
    celsius: correctFrame(frame, settings),
    uncertain: frame.uncertain,
  };
}

/** Throws unless the image's size and arrays agree. */
export function checkImage(image: CelsiusImage): void {
  const { width, height, celsius, uncertain } = image;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`image size ${String(width)}×${String(height)} is not two positive integers`);
  }
  if (celsius.length !== width * height) {
    throw new Error(
      `image has ${String(celsius.length)} readings, expected ${String(width * height)}`,
    );
  }
  if (uncertain && uncertain.length !== celsius.length) {
    throw new Error(
      `uncertain mask has ${String(uncertain.length)} values, expected ${String(celsius.length)}`,
    );
  }
}

/** The pixel counts: its `uncertain` value is 0 (or there is no mask) and it has a temperature. */
export function counts(image: CelsiusImage, index: number): boolean {
  if (image.uncertain && image.uncertain[index] !== 0) return false;
  return !Number.isNaN(image.celsius[index] ?? Number.NaN);
}

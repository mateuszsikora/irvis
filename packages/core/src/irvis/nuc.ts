// Finds the camera's automatic shutter calibration (NUC) in the data, because
// the browser cannot ask the camera and the camera calibrates on its own. The
// writer starts a chunk with a keyframe after each one. Heuristics:
// docs/irvis-format.md#chunks-and-keyframes
import type { Conversion } from '../cameras/profile.ts';

/** `frozen`: the first frame after a run of exactly repeated frames. `step`: the frame mean jumped. */
export type NucEvent = 'frozen' | 'step';

/**
 * A frozen run counts as a NUC only when at least this many frames repeat the
 * previous one exactly, so that a backend that sometimes delivers a frame
 * twice does not start a chunk each time. To be tuned on real frames in #16.
 */
export const NUC_MIN_FROZEN = 2;
/** A jump of the frame mean must be larger than this, in kelvin, … */
export const NUC_MIN_STEP_KELVIN = 0.5;
/** … and larger than this many times the median of the recent steps, to count as a NUC. */
export const NUC_STEP_FACTOR = 10;
/** How many recent frame-to-frame steps the median is taken over. */
export const NUC_HISTORY = 25;

/**
 * Kelvin per raw unit of `conversion` near `raw`: the slope of the
 * conversion. Null when the conversion is flat or undefined there.
 */
export function kelvinPerRaw(conversion: Conversion, raw: number): number | null {
  let slope: number;
  switch (conversion.kind) {
    case 'linear':
      slope = conversion.scale;
      break;
    case 'polynomial': {
      const c = conversion.coefficients;
      slope = 0;
      for (let i = c.length - 1; i >= 1; i--) slope = slope * raw + i * (c[i] ?? 0);
      break;
    }
    case 'lut': {
      const last = conversion.celsius.length - 1;
      const i = Math.min(Math.max(0, Math.round(raw) - conversion.firstRaw), last - 1);
      slope = (conversion.celsius[i + 1] ?? Number.NaN) - (conversion.celsius[i] ?? Number.NaN);
      break;
    }
  }
  const k = Math.abs(slope);
  return Number.isFinite(k) && k > 0 ? k : null;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Watches frames in order and reports the first frame after a NUC: after a
 * run of at least NUC_MIN_FROZEN frames that repeat the previous one exactly
 * (the camera holds the picture while the shutter is closed), or when the frame mean jumps by more
 * than NUC_MIN_STEP_KELVIN and NUC_STEP_FACTOR times the median recent step.
 */
export class NucDetector {
  private previous: Uint16Array | null = null;
  private previousMean: number | null = null;
  private frozen = 0;
  private readonly steps: number[] = [];

  /** Forgets everything seen so far. */
  reset(): void {
    this.previous = null;
    this.previousMean = null;
    this.frozen = 0;
    this.steps.length = 0;
  }

  /** Looks at the next frame; returns the event it ends, or null. */
  push(raw: Uint16Array, conversion: Conversion): NucEvent | null {
    const previous = this.previous;
    if (previous !== null && previous.length === raw.length && same(previous, raw)) {
      this.frozen++;
      return null;
    }
    let sum = 0;
    for (let i = 0; i < raw.length; i++) sum += raw[i] ?? 0;
    const mean = raw.length > 0 ? sum / raw.length : 0;

    let event: NucEvent | null = null;
    if (this.frozen >= NUC_MIN_FROZEN) {
      event = 'frozen';
    } else if (this.previousMean !== null) {
      const step = Math.abs(mean - this.previousMean);
      const k = kelvinPerRaw(conversion, mean);
      if (
        k !== null &&
        step * k > NUC_MIN_STEP_KELVIN &&
        step > median(this.steps) * NUC_STEP_FACTOR
      ) {
        event = 'step';
      } else {
        this.steps.push(step);
        if (this.steps.length > NUC_HISTORY) this.steps.shift();
      }
    }
    this.frozen = 0;
    this.previous = raw.slice();
    this.previousMean = mean;
    return event;
  }
}

function same(a: Uint16Array, b: Uint16Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

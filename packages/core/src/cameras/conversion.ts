// Evaluates a Conversion from the camera profile. Only +, -, * and table
// lookups, so every engine gives the same bits:
// docs/decisions/architecture.md#measurement-code-uses-only-correctly-rounded-arithmetic
import type { Conversion } from './profile.ts';

/**
 * Degrees Celsius for one raw value. NaN when a lookup table has no entry for
 * the value.
 */
export function toCelsius(raw: number, conversion: Conversion): number {
  switch (conversion.kind) {
    case 'linear':
      return raw * conversion.scale + conversion.offset;
    case 'polynomial': {
      const c = conversion.coefficients;
      let value = 0;
      for (let i = c.length - 1; i >= 0; i--) value = value * raw + (c[i] ?? 0);
      return value;
    }
    case 'lut': {
      const value = conversion.celsius[raw - conversion.firstRaw];
      return value ?? Number.NaN;
    }
  }
}

/** Degrees Celsius for every value of a raw frame, in the same order. */
export function toCelsiusArray(raw: Uint16Array, conversion: Conversion): Float64Array {
  const out = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = toCelsius(raw[i] ?? 0, conversion);
  return out;
}

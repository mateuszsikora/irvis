// Isotherms: pixels of corrected readings inside a temperature band, painted
// in one colour over the rendered image. Uncertain pixels and pixels without
// a temperature are never painted:
// docs/decisions/architecture.md#alarms-and-isotherms-skip-uncertain-pixels

/** Red, green and blue, each an integer from 0 to 255. */
export type Rgb = readonly [number, number, number];

/**
 * A band of corrected readings in °C, bounds included, with the colour its
 * pixels are painted in: at or above `celsius`, at or below it, or from
 * `minCelsius` to `maxCelsius`.
 */
export type Isotherm =
  | { readonly kind: 'above'; readonly celsius: number; readonly color: Rgb }
  | { readonly kind: 'below'; readonly celsius: number; readonly color: Rgb }
  | {
      readonly kind: 'between';
      readonly minCelsius: number;
      readonly maxCelsius: number;
      readonly color: Rgb;
    };

/** What an `Isotherm` may not hold; empty when it can be used. */
export function isothermProblems(isotherm: Isotherm): string[] {
  const out: string[] = [];
  if (isotherm.kind === 'between') {
    if (!Number.isFinite(isotherm.minCelsius) || !Number.isFinite(isotherm.maxCelsius)) {
      out.push('minCelsius and maxCelsius must be finite numbers');
    } else if (isotherm.minCelsius > isotherm.maxCelsius) {
      out.push('minCelsius must not be above maxCelsius');
    }
  } else if (!Number.isFinite(isotherm.celsius)) {
    out.push('celsius must be a finite number');
  }
  const color: readonly number[] = isotherm.color;
  if (color.length !== 3 || !color.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) {
    out.push('color must be three integers from 0 to 255');
  }
  return out;
}

/** The reading is inside the band. False for a reading that is not finite (NaN, ±Infinity). */
export function inIsotherm(celsius: number, isotherm: Isotherm): boolean {
  if (!Number.isFinite(celsius)) return false;
  switch (isotherm.kind) {
    case 'above':
      return celsius >= isotherm.celsius;
    case 'below':
      return celsius <= isotherm.celsius;
    case 'between':
      return celsius >= isotherm.minCelsius && celsius <= isotherm.maxCelsius;
  }
}

function checkInputs(
  celsius: Float64Array,
  uncertain: Uint8Array | null,
  isotherms: readonly Isotherm[],
): void {
  for (const [i, isotherm] of isotherms.entries()) {
    const problems = isothermProblems(isotherm);
    if (problems.length > 0) {
      throw new Error(`invalid isotherm ${String(i)}: ${problems.join('; ')}`);
    }
  }
  if (uncertain && uncertain.length !== celsius.length) {
    throw new Error(
      `uncertain mask has ${String(uncertain.length)} values, expected ${String(celsius.length)}`,
    );
  }
}

/**
 * 1 for every pixel inside the band whose `uncertain` value is 0 (or with no
 * mask), 0 elsewhere; one value per reading.
 */
export function isothermMask(
  celsius: Float64Array,
  uncertain: Uint8Array | null,
  isotherm: Isotherm,
): Uint8Array {
  checkInputs(celsius, uncertain, [isotherm]);
  const mask = new Uint8Array(celsius.length);
  for (let i = 0; i < celsius.length; i++) {
    if (uncertain && uncertain[i] !== 0) continue;
    if (inIsotherm(celsius[i] ?? Number.NaN, isotherm)) mask[i] = 1;
  }
  return mask;
}

/**
 * Paints the pixels of each isotherm in its colour, in place, over an RGBA
 * image with one pixel per reading (4 bytes each, row-major). Red, green and
 * blue are replaced and alpha is kept. A later isotherm paints over an earlier
 * one where they overlap. Returns, per isotherm, how many pixels are inside
 * its band.
 */
export function paintIsotherms(
  rgba: Uint8Array | Uint8ClampedArray,
  celsius: Float64Array,
  uncertain: Uint8Array | null,
  isotherms: readonly Isotherm[],
): number[] {
  checkInputs(celsius, uncertain, isotherms);
  if (rgba.length !== celsius.length * 4) {
    throw new Error(
      `RGBA image has ${String(rgba.length)} bytes, expected ${String(celsius.length * 4)}`,
    );
  }
  const counts = isotherms.map(() => 0);
  for (let i = 0; i < celsius.length; i++) {
    if (uncertain && uncertain[i] !== 0) continue;
    const value = celsius[i] ?? Number.NaN;
    for (const [k, isotherm] of isotherms.entries()) {
      if (!inIsotherm(value, isotherm)) continue;
      counts[k] = (counts[k] ?? 0) + 1;
      const [r, g, b] = isotherm.color;
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = b;
    }
  }
  return counts;
}

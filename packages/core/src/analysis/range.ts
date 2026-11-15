// A temperature range that maps readings to a palette or divides them into
// histogram bins: docs/features/core-technical.md#interfaces

/** From `minCelsius` to `maxCelsius`, in °C, min below max. */
export interface TemperatureRange {
  readonly minCelsius: number;
  readonly maxCelsius: number;
}

/** What a `TemperatureRange` may not hold; empty when it can be used. */
export function rangeProblems(range: TemperatureRange): string[] {
  const { minCelsius: min, maxCelsius: max } = range;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return ['minCelsius and maxCelsius must be finite numbers'];
  }
  if (!(min < max)) return ['minCelsius must be below maxCelsius'];
  // -1e308 to 1e308 is finite at both ends, but its span overflows to Infinity.
  return Number.isFinite(max - min)
    ? []
    : ['the span from minCelsius to maxCelsius must be finite'];
}

/** Throws on a range that `rangeProblems` rejects. */
export function checkRange(range: TemperatureRange): void {
  const problems = rangeProblems(range);
  if (problems.length > 0) throw new Error(`invalid range: ${problems.join('; ')}`);
}

export interface BrightnessHint {
  readonly enabled: boolean;
  readonly rSquared: number;
  readonly raw: Float64Array;
  readonly tolerance: Float64Array;
}
function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
}

/** Fit paired-row estimates: individual high bytes are not yet known. */
export function fitHint(samples: readonly (readonly [number, number])[]): BrightnessHint {
  const buckets = Array.from({ length: 256 }, () => [] as number[]);
  for (const [level, raw] of samples) buckets[level]!.push(raw);
  const levels: number[] = [];
  const medians: number[] = [];
  const spreads: number[] = [];
  for (let level = 0; level < 256; level++) {
    const values = buckets[level]!;
    if (values.length === 0) continue;
    levels.push(level);
    const m = median(values);
    medians.push(m);
    spreads.push(Math.max(64, median(values.map((v) => Math.abs(v - m))) * 3));
  }
  // Weighted pool-adjacent-violators isotonic regression.
  const blocks: { first: number; last: number; sum: number; weight: number }[] = [];
  for (let i = 0; i < levels.length; i++) {
    const weight = buckets[levels[i]!]!.length;
    blocks.push({ first: i, last: i, sum: medians[i]! * weight, weight });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sum / a.weight <= b.sum / b.weight) break;
      blocks.pop();
      a.last = b.last;
      a.sum += b.sum;
      a.weight += b.weight;
    }
  }
  const fitted = new Float64Array(levels.length);
  for (const block of blocks) fitted.fill(block.sum / block.weight, block.first, block.last + 1);
  const raw = new Float64Array(256);
  const tolerance = new Float64Array(256).fill(256);
  for (let level = 0, i = 0; level < 256 && levels.length; level++) {
    while (i + 1 < levels.length && levels[i + 1]! <= level) i++;
    const j = Math.min(i + 1, levels.length - 1);
    const fraction = Math.max(
      0,
      Math.min(1, (level - levels[i]!) / (levels[j]! - levels[i]! || 1)),
    );
    raw[level] = fitted[i]! + fraction * (fitted[j]! - fitted[i]!);
    tolerance[level] = Math.max(spreads[i]!, spreads[j]!);
  }
  const center = samples.length ? median(samples.map((s) => s[1])) : 0;
  const deviations = samples.map((s) => Math.abs(s[1] - center));
  const cap = Math.max(256, samples.length ? median(deviations) * 4 : 256);
  let residual = 0,
    total = 0;
  for (const [level, value] of samples) {
    const e = Math.min(cap, Math.abs(value - raw[level]!));
    const d = Math.min(cap, Math.abs(value - center));
    residual += e * e;
    total += d * d;
  }
  const rSquared = total > 0 ? 1 - residual / total : 0;
  return {
    enabled: samples.length >= 32 && levels.length >= 4 && rSquared >= 0.7,
    rSquared,
    raw,
    tolerance,
  };
}

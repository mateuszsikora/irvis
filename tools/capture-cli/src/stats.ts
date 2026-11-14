// Small statistics used by the report.

export interface Summary {
  readonly count: number;
  readonly mean: number;
  /** Population standard deviation. */
  readonly sd: number;
  readonly min: number;
  readonly max: number;
}

export function summarize(values: ArrayLike<number>): Summary {
  const n = values.length;
  if (n === 0)
    return { count: 0, mean: Number.NaN, sd: Number.NaN, min: Number.NaN, max: Number.NaN };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i] ?? 0;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += ((values[i] ?? 0) - mean) ** 2;
  return { count: n, mean, sd: Math.sqrt(sq / n), min, max };
}

/** The q-quantile (0 to 1) by linear interpolation between order statistics. */
export function quantile(values: ArrayLike<number>, q: number): number {
  const sorted = Float64Array.from(values).sort();
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? 0;
  return a + (b - a) * (pos - lo);
}

export function median(values: ArrayLike<number>): number {
  return quantile(values, 0.5);
}

/** Ranks from 1, ties sharing the mean of their ranks. */
export function ranks(values: ArrayLike<number>): Float64Array {
  const n = values.length;
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (values[a] ?? 0) - (values[b] ?? 0),
  );
  const out = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    const v = values[order[i] ?? 0] ?? 0;
    while (j + 1 < n && (values[order[j + 1] ?? 0] ?? 0) === v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k] ?? 0] = rank;
    i = j + 1;
  }
  return out;
}

/** Pearson correlation; NaN when either side is constant. */
export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] ?? 0;
    mb += b[i] ?? 0;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - ma;
    const db = (b[i] ?? 0) - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return saa === 0 || sbb === 0 ? Number.NaN : sab / Math.sqrt(saa * sbb);
}

/** Spearman rank correlation: Pearson on the ranks, ties averaged. */
export function spearman(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return pearson(ranks(a), ranks(b));
}

export interface HistogramBin {
  /** Lower edge, inclusive. */
  readonly from: number;
  /** Upper edge, exclusive (inclusive for the last bin). */
  readonly to: number;
  readonly count: number;
}

/** Bins of a fixed width from floor(min / width) × width, covering every finite value. */
export function histogram(values: ArrayLike<number>, width: number): HistogramBin[] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? Number.NaN;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return [];
  const first = Math.floor(min / width) * width;
  const bins = Math.max(1, Math.floor((max - first) / width) + 1);
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? Number.NaN;
    if (!Number.isFinite(v)) continue;
    const bin = Math.min(bins - 1, Math.floor((v - first) / width));
    counts[bin] = (counts[bin] ?? 0) + 1;
  }
  return counts.map((count, i) => ({
    from: first + i * width,
    to: first + (i + 1) * width,
    count,
  }));
}

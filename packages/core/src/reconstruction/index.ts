import type { RowRange } from '../cameras/profile.ts';
import type { Yuv420Frame } from '../frames.ts';
import { checkPlanar, chroma, luma } from './planar.ts';
import { fitHint, type BrightnessHint } from './hint.ts';
export { simulateYUYVtoI420 } from './planar.ts';
export { compareFrames } from './metrics.ts';
export type { FrameComparison } from './metrics.ts';
export type { BrightnessHint } from './hint.ts';

export interface ReconstructionOptions {
  readonly thermal: RowRange;
  /** Spatially registered image rows, same dimensions as thermal; omit to disable hints. */
  readonly image?: RowRange;
}
export interface Reconstruction {
  readonly width: number;
  readonly height: number;
  readonly timestamp: number;
  readonly raw: Uint16Array;
  readonly confident: Uint8Array;
  /** Directly usable as ThermalFrame.uncertain. */
  readonly uncertain: Uint8Array;
  readonly hint: BrightnessHint;
  readonly passes: number;
}
interface Candidate {
  a: number;
  b: number;
  cost: number;
}
const distance = (a: number, b: number): number => Math.sqrt(Math.abs(a - b));

export function reconstructPlanar(
  frame: Yuv420Frame,
  options: ReconstructionOptions,
): Reconstruction {
  checkPlanar(frame);
  const { thermal, image } = options;
  for (const range of [thermal, ...(image ? [image] : [])]) {
    if (
      !Number.isInteger(range.firstRow) ||
      range.firstRow < 0 ||
      range.firstRow % 2 !== 0 ||
      !Number.isInteger(range.rows) ||
      range.rows <= 0 ||
      range.rows % 2 !== 0 ||
      range.firstRow + range.rows > frame.height
    )
      throw new Error('reconstruction rows must be positive, pair-aligned and inside the frame');
  }
  if (image && image.rows !== thermal.rows)
    throw new Error('hint image must have the thermal dimensions');
  const w = frame.width,
    h = thermal.rows,
    pairs = h / 2;
  const estimate = (x: number, p: number): number => {
    const y = thermal.firstRow + Math.max(0, Math.min(pairs - 1, p)) * 2;
    return chroma(frame, x, y) * 256 - 64 + (luma(frame, x, y) + luma(frame, x, y + 1)) / 2;
  };
  const samples: [number, number][] = [];
  if (image)
    for (let p = 0; p < pairs; p++)
      for (let x = 0; x < w; x++) {
        const a = luma(frame, x, image.firstRow + p * 2),
          b = luma(frame, x, image.firstRow + p * 2 + 1);
        if (Math.abs(a - b) <= 2) samples.push([Math.round((a + b) / 2), estimate(x, p)]);
      }
  const hint = fitHint(samples);
  const candidates: Candidate[][] = [];
  for (let p = 0; p < pairs; p++)
    for (let x = 0; x < w; x++) {
      const y = thermal.firstRow + p * 2;
      const c = chroma(frame, x, y),
        loA = luma(frame, x, y),
        loB = luma(frame, x, y + 1);
      const list: Candidate[] = [];
      const hintCost = (raw: number, row: number): number => {
        if (!hint.enabled || !image) return 0;
        const level = luma(frame, x, image.firstRow + row);
        return Math.max(0, Math.abs(raw - hint.raw[level]!) - hint.tolerance[level]!) / 16;
      };
      const add = (high: number): void => {
        for (const sum of [2 * c, 2 * c - 1]) {
          const other = sum - high;
          if (high < 0 || high > 255 || other < 0 || other > 255 || list.length >= 32) continue;
          const a = high * 256 + loA,
            b = other * 256 + loB;
          if (!list.some((v) => v.a === a && v.b === b))
            list.push({ a, b, cost: distance(a, b) + hintCost(a, p * 2) + hintCost(b, p * 2 + 1) });
        }
      };
      // Smooth solutions, edges supported by either neighbour, and a linear gradient.
      for (const delta of [0, -1, 1, -2, 2]) add(c + delta);
      const upper = estimate(x, p - 1),
        lower = estimate(x, p + 1);
      const proposals = [upper, 2 * estimate(x, p) - lower, estimate(x, p) + (upper - lower) / 8];
      if (hint.enabled && image) proposals.push(hint.raw[luma(frame, x, image.firstRow + p * 2)]!);
      for (const value of proposals)
        for (const delta of [0, -1, 1]) add(Math.round((value - loA) / 256) + delta);
      candidates.push(list);
    }
  const selected = new Uint8Array(w * pairs);
  // Dynamic programming down each column, including the edge between pairs.
  for (let x = 0; x < w; x++) {
    let previous = new Float64Array(0);
    const back: Uint8Array[] = [];
    for (let p = 0; p < pairs; p++) {
      const list = candidates[p * w + x]!;
      const scores = new Float64Array(list.length),
        links = new Uint8Array(list.length);
      for (let j = 0; j < list.length; j++) {
        let best = p === 0 ? 0 : Infinity;
        if (p > 0)
          for (let k = 0; k < previous.length; k++) {
            const score = previous[k]! + distance(candidates[(p - 1) * w + x]![k]!.b, list[j]!.a);
            if (score < best) {
              best = score;
              links[j] = k;
            }
          }
        scores[j] = best + list[j]!.cost;
      }
      back.push(links);
      previous = scores;
    }
    let best = 0;
    for (let j = 1; j < previous.length; j++) if (previous[j]! < previous[best]!) best = j;
    for (let p = pairs - 1; p >= 0; p--) {
      selected[p * w + x] = best;
      best = back[p]![best]!;
    }
  }
  const localCost = (index: number, candidate: Candidate): number => {
    const x = index % w,
      p = Math.floor(index / w);
    let cost = candidate.cost;
    for (const dx of [-1, 1])
      if (x + dx >= 0 && x + dx < w) {
        const other = candidates[index + dx]![selected[index + dx]!]!;
        cost += distance(candidate.a, other.a) + distance(candidate.b, other.b);
      }
    if (p > 0) cost += distance(candidate.a, candidates[index - w]![selected[index - w]!]!.b);
    if (p + 1 < pairs)
      cost += distance(candidate.b, candidates[index + w]![selected[index + w]!]!.a);
    return cost;
  };
  let passes = 0;
  for (; passes < 4;) {
    let changed = false;
    for (let step = 0; step < selected.length; step++) {
      const i = passes % 2 === 0 ? step : selected.length - 1 - step;
      let best = selected[i]!,
        score = localCost(i, candidates[i]![best]!);
      for (let j = 0; j < candidates[i]!.length; j++) {
        const next = localCost(i, candidates[i]![j]!);
        if (next < score) {
          best = j;
          score = next;
        }
      }
      if (best !== selected[i]) {
        selected[i] = best;
        changed = true;
      }
    }
    passes++;
    if (!changed) break;
  }
  const raw = new Uint16Array(w * h),
    confident = new Uint8Array(w * h),
    uncertain = new Uint8Array(w * h);
  for (let i = 0; i < selected.length; i++) {
    const chosen = candidates[i]![selected[i]!]!,
      score = localCost(i, chosen);
    let alternative = Infinity;
    for (let j = 0; j < candidates[i]!.length; j++)
      if (j !== selected[i]) alternative = Math.min(alternative, localCost(i, candidates[i]![j]!));
    const at = Math.floor(i / w) * w * 2 + (i % w);
    raw[at] = chosen.a;
    raw[at + w] = chosen.b;
    confident[at] = confident[at + w] = alternative - score >= 4 ? 1 : 0;
    uncertain[at] = uncertain[at + w] = 1 - confident[at];
  }
  return {
    width: w,
    height: h,
    timestamp: frame.timestamp,
    raw,
    confident,
    uncertain,
    hint,
    passes,
  };
}

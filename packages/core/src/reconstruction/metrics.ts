import type { Yuv420Frame } from '../frames.ts';
import type { RowRange } from '../cameras/profile.ts';
import { checkPlanar, chroma, luma } from './planar.ts';
export interface FrameComparison {
  yMatch: number;
  chromaModelMatch: number;
  exactMatch: number;
  flatRegionMatch: number | null;
  byteJumps: number[];
  meanAbsoluteError: number;
  p99AbsoluteError: number;
  maxAbsoluteError: number;
  milliseconds: number;
}
/** Fractions in [0,1], errors in kelvins; time supplied by the caller's clock. */
export function compareFrames(
  reference: Uint16Array,
  reconstructed: Uint16Array,
  planar: Yuv420Frame,
  thermal: RowRange,
  kelvinsPerRaw: number,
  milliseconds: number,
): FrameComparison {
  checkPlanar(planar);
  const w = planar.width,
    h = thermal.rows;
  if (
    !Number.isInteger(h) ||
    h <= 0 ||
    h % 2 ||
    !Number.isInteger(thermal.firstRow) ||
    thermal.firstRow < 0 ||
    thermal.firstRow % 2 ||
    thermal.firstRow + h > planar.height ||
    reference.length !== w * h ||
    reconstructed.length !== reference.length ||
    !Number.isFinite(kelvinsPerRaw) ||
    kelvinsPerRaw <= 0 ||
    !Number.isFinite(milliseconds) ||
    milliseconds < 0
  )
    throw new Error('invalid comparison dimensions, scale or time');
  let yMatches = 0,
    chromaMatches = 0,
    exact = 0,
    flat = 0,
    flatExact = 0,
    total = 0;
  const errors: number[] = [],
    byteJumps: number[] = [];
  for (let i = 0; i < reference.length; i++) {
    const x = i % w,
      y = Math.floor(i / w),
      value = reference[i]!;
    if (luma(planar, x, thermal.firstRow + y) === (value & 255)) yMatches++;
    if (
      y % 2 === 0 &&
      Math.abs(
        chroma(planar, x, thermal.firstRow + y) -
          (((value >> 8) + (reference[i + w]! >> 8) + 1) >> 1),
      ) <= 1
    )
      chromaMatches++;
    const error = Math.abs(value - reconstructed[i]!) * kelvinsPerRaw;
    errors.push(error);
    total += error;
    if (error === 0) exact++;
    if (error >= 3) byteJumps.push(i);
    // Flat = every available 4-neighbour within 0.5 K of the reference pixel.
    const neighbours = [
      x > 0 ? i - 1 : i,
      x + 1 < w ? i + 1 : i,
      y > 0 ? i - w : i,
      y + 1 < h ? i + w : i,
    ];
    if (neighbours.every((n) => Math.abs(reference[n]! - value) * kelvinsPerRaw <= 0.5)) {
      flat++;
      if (error === 0) flatExact++;
    }
  }
  errors.sort((a, b) => a - b);
  return {
    yMatch: yMatches / reference.length,
    chromaModelMatch: chromaMatches / (reference.length / 2),
    exactMatch: exact / reference.length,
    flatRegionMatch: flat ? flatExact / flat : null,
    byteJumps,
    meanAbsoluteError: total / reference.length,
    p99AbsoluteError: errors[Math.ceil(errors.length * 0.99) - 1]!,
    maxAbsoluteError: errors[errors.length - 1]!,
    milliseconds,
  };
}

// The frame codec of .irvis: keyframes predicted within the frame, other
// frames predicted from the previous decoded frame in 8×8 blocks, each block
// skipped, resent towards a denoised value, or sent as a mask and the pixels
// outside the tolerance. Every stored value is within the tolerance of the
// value given to the encoder. Byte layout: docs/irvis-format.md#frame-body
import { ByteReader, ByteWriter, zigzag } from './buffer.ts';
import { IrvisError } from './errors.ts';

/** Width and height of a block, in pixels. */
export const BLOCK_SIZE = 8;

/** Block modes as stored in the frame body. */
export const BLOCK_SKIP = 0;
export const BLOCK_DENSE = 1;
export const BLOCK_SPARSE = 2;

/** A residual byte of this value is followed by a varint: the escape code. */
const ESCAPE = 255;

/** How many blocks of each mode a frame used; a keyframe has none. */
export interface BlockStats {
  skip: number;
  dense: number;
  sparse: number;
}

/** One encoded frame: the body before deflate, and what the decoder will reconstruct. */
export interface EncodedFrame {
  readonly body: Uint8Array;
  readonly values: Uint16Array;
  readonly stats: BlockStats;
}

/**
 * Encoder choices that do not change the format: a decoder needs only the
 * quantiser step. The benchmark compares settings; the defaults come from it.
 */
export interface EncoderTuning {
  /** The quantiser's half-width h as a fraction of the tolerance T, from 0 to 1. */
  readonly precision: number;
  /** How far the denoised estimate moves towards each new value, from 0 to 1. */
  readonly weight: number;
  /** A block is resent whole when that costs at most this many times sending only the pixels outside T. */
  readonly denseBias: number;
}

export const DEFAULT_TUNING: EncoderTuning = { precision: 0.25, weight: 0.25, denseBias: 1 };

function isFraction(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/** What is wrong with encoder settings, one message each; empty when they can be used. */
export function tuningProblems(tuning: EncoderTuning): string[] {
  const out: string[] = [];
  if (!isFraction(tuning.precision)) out.push('tuning.precision must be a number from 0 to 1');
  if (!isFraction(tuning.weight)) out.push('tuning.weight must be a number from 0 to 1');
  if (!Number.isFinite(tuning.denseBias) || tuning.denseBias <= 0) {
    out.push('tuning.denseBias must be a positive number');
  }
  return out;
}

/** The quantiser step for a half-width h: 2h + 1, odd, so that rounding never ties. */
export function quantiserStep(halfWidth: number): number {
  return 2 * halfWidth + 1;
}

function clamp16(value: number): number {
  return value < 0 ? 0 : value > 0xffff ? 0xffff : value;
}

/** Bits of the Elias gamma code of z + 1: a rough cost of a residual after deflate. */
function residualBits(residual: number): number {
  return 2 * (32 - Math.clz32(zigzag(residual) + 1)) - 1;
}

function writeResidual(out: ByteWriter, residual: number): void {
  const z = zigzag(residual);
  if (z < ESCAPE) {
    out.u8(z);
  } else {
    out.u8(ESCAPE);
    out.varint(z - ESCAPE);
  }
}

function readResidual(input: ByteReader): number {
  const byte = input.u8();
  const z = byte < ESCAPE ? byte : ESCAPE + input.varint();
  return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
}

/** LOCO-I median predictor from the left (a), upper (b) and upper-left (c) decoded neighbours. */
function predict(values: Uint16Array, width: number, x: number, y: number): number {
  const i = y * width + x;
  if (y === 0) return x === 0 ? 0 : (values[i - 1] ?? 0);
  if (x === 0) return values[i - width] ?? 0;
  const a = values[i - 1] ?? 0;
  const b = values[i - width] ?? 0;
  const c = values[i - width - 1] ?? 0;
  if (c >= Math.max(a, b)) return Math.min(a, b);
  if (c <= Math.min(a, b)) return Math.max(a, b);
  return a + b - c;
}

/** The quantised residual from `predicted` towards `target`. */
function quantise(target: number, predicted: number, step: number): number {
  const d = target - predicted;
  return step === 1 ? d : Math.round(d / step);
}

function blockCount(width: number, height: number): number {
  return Math.ceil(width / BLOCK_SIZE) * Math.ceil(height / BLOCK_SIZE);
}

function checkSize(width: number, height: number, length: number, what: string): void {
  if (length !== width * height) {
    throw new IrvisError(
      `${what} has ${String(length)} values, expected ${String(width * height)} for ${String(width)}×${String(height)}`,
    );
  }
}

/**
 * Encodes frames of one size with one tolerance T. Every stored value is
 * within h of a target, and the target is the per-pixel denoised estimate
 * clamped to within T − h of the input, so every stored value is within T of
 * the input. The encoder keeps the previous decoded frame and the estimates,
 * so frames go in the order they are stored.
 */
export class FrameEncoder {
  readonly width: number;
  readonly height: number;
  readonly tolerance: number;
  /** The quantiser's half-width h. */
  readonly halfWidth: number;
  /** The quantiser step 2h + 1, which the decoder needs. */
  readonly step: number;
  private readonly tuning: EncoderTuning;
  private previous: Uint16Array | null = null;
  private readonly estimate: Float64Array;
  private readonly target: Int32Array;

  constructor(
    width: number,
    height: number,
    tolerance: number,
    tuning: EncoderTuning = DEFAULT_TUNING,
  ) {
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 0x7fff) {
      throw new IrvisError(`tolerance ${String(tolerance)} is not an integer from 0 to 32767`);
    }
    const problems = tuningProblems(tuning);
    if (problems.length > 0) throw new IrvisError(`invalid encoder tuning: ${problems.join('; ')}`);
    this.width = width;
    this.height = height;
    this.tolerance = tolerance;
    this.tuning = tuning;
    this.halfWidth = Math.min(tolerance, Math.max(0, Math.floor(tolerance * tuning.precision)));
    this.step = quantiserStep(this.halfWidth);
    this.estimate = new Float64Array(width * height).fill(Number.NaN);
    this.target = new Int32Array(width * height);
  }

  /**
   * Encodes `input`; a keyframe does not depend on earlier frames. The first
   * frame must be one. `values` in the result is a copy: changing it does not
   * change what the next frame is predicted from.
   */
  encode(input: Uint16Array, keyframe: boolean): EncodedFrame {
    checkSize(this.width, this.height, input.length, 'frame');
    const previous = this.previous;
    if (!keyframe && previous === null) throw new IrvisError('the first frame must be a keyframe');
    this.updateTargets(input);
    const encoded =
      keyframe || previous === null ? this.encodeKeyframe() : this.encodeDelta(input, previous);
    this.previous = encoded.values;
    return { ...encoded, values: encoded.values.slice() };
  }

  /** Moves each estimate towards the input, or to it after a real change, and clamps it into the target. */
  private updateTargets(input: Uint16Array): void {
    const { tolerance, estimate, target } = this;
    const margin = tolerance - this.halfWidth;
    const weight = this.tuning.weight;
    for (let i = 0; i < input.length; i++) {
      const m = input[i] ?? 0;
      let e = estimate[i] ?? Number.NaN;
      e = Number.isNaN(e) || Math.abs(m - e) > tolerance ? m : e + (m - e) * weight;
      estimate[i] = e;
      const low = Math.max(0, m - margin);
      const high = Math.min(0xffff, m + margin);
      target[i] = Math.min(high, Math.max(low, Math.round(e)));
    }
  }

  private encodeKeyframe(): EncodedFrame {
    const { width, height, step, target } = this;
    const values = new Uint16Array(width * height);
    const out = new ByteWriter(width * height + 64);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const p = predict(values, width, x, y);
        const q = quantise(target[i] ?? 0, p, step);
        values[i] = clamp16(p + q * step);
        writeResidual(out, q);
      }
    }
    return { body: out.finish(), values, stats: { skip: 0, dense: 0, sparse: 0 } };
  }

  private encodeDelta(input: Uint16Array, previous: Uint16Array): EncodedFrame {
    const { width, height, tolerance, step, target } = this;
    const values = new Uint16Array(width * height);
    const blocks = blockCount(width, height);
    const modes = new Uint8Array(blocks);
    const masks = new ByteWriter(blocks);
    const residuals = new ByteWriter(width * height);
    const stats: BlockStats = { skip: 0, dense: 0, sparse: 0 };

    let block = 0;
    for (let by = 0; by < height; by += BLOCK_SIZE) {
      const rows = Math.min(BLOCK_SIZE, height - by);
      for (let bx = 0; bx < width; bx += BLOCK_SIZE) {
        const cols = Math.min(BLOCK_SIZE, width - bx);
        let outside = 0;
        let sparseBits = rows * cols;
        let denseBits = 0;
        for (let y = by; y < by + rows; y++) {
          for (let x = bx; x < bx + cols; x++) {
            const i = y * width + x;
            const p = previous[i] ?? 0;
            const bits = residualBits(quantise(target[i] ?? 0, p, step));
            denseBits += bits;
            if (Math.abs((input[i] ?? 0) - p) > tolerance) {
              outside++;
              sparseBits += bits;
            }
          }
        }

        let mode = BLOCK_SKIP;
        if (outside > 0) {
          mode = denseBits <= sparseBits * this.tuning.denseBias ? BLOCK_DENSE : BLOCK_SPARSE;
        }
        modes[block++] = mode;

        if (mode === BLOCK_SKIP) {
          stats.skip++;
          for (let y = by; y < by + rows; y++) {
            const start = y * width + bx;
            values.set(previous.subarray(start, start + cols), start);
          }
          continue;
        }
        const mask = mode === BLOCK_SPARSE ? new Uint8Array(Math.ceil((rows * cols) / 8)) : null;
        if (mode === BLOCK_DENSE) stats.dense++;
        else stats.sparse++;
        let k = 0;
        for (let y = by; y < by + rows; y++) {
          for (let x = bx; x < bx + cols; x++, k++) {
            const i = y * width + x;
            const p = previous[i] ?? 0;
            if (mask !== null && Math.abs((input[i] ?? 0) - p) <= tolerance) {
              values[i] = p;
              continue;
            }
            if (mask !== null) mask[k >> 3] = (mask[k >> 3] ?? 0) | (1 << (k & 7));
            const q = quantise(target[i] ?? 0, p, step);
            writeResidual(residuals, q);
            values[i] = clamp16(p + q * step);
          }
        }
        if (mask !== null) masks.bytes(mask);
      }
    }

    const out = new ByteWriter(blocks + masks.length + residuals.length);
    out.bytes(modes);
    out.bytes(masks.finish());
    out.bytes(residuals.finish());
    return { body: out.finish(), values, stats };
  }
}

/** Decodes the bodies FrameEncoder produced, in the same order. */
export class FrameDecoder {
  readonly width: number;
  readonly height: number;
  private previous: Uint16Array | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  /** Forgets the previous frame; the next body must be a keyframe. */
  reset(): void {
    this.previous = null;
  }

  /**
   * The decoded values of one body, as a new array that the decoder keeps no
   * reference to. `step` is the chunk's quantiser step.
   */
  decode(body: Uint8Array, keyframe: boolean, step: number): Uint16Array {
    const previous = this.previous;
    let values: Uint16Array;
    if (keyframe) {
      values = this.decodeKeyframe(body, step);
    } else {
      if (previous === null)
        throw new IrvisError('a frame that is not a keyframe has no previous frame');
      values = this.decodeDelta(body, previous, step);
    }
    this.previous = values;
    return values.slice();
  }

  /** A copy of the frame decoded last, or null after reset. */
  current(): Uint16Array | null {
    return this.previous?.slice() ?? null;
  }

  private decodeKeyframe(body: Uint8Array, step: number): Uint16Array {
    const { width, height } = this;
    const values = new Uint16Array(width * height);
    const input = new ByteReader(body);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = predict(values, width, x, y);
        values[y * width + x] = clamp16(p + readResidual(input) * step);
      }
    }
    if (input.remaining !== 0) throw trailing(input.remaining);
    return values;
  }

  private decodeDelta(body: Uint8Array, previous: Uint16Array, step: number): Uint16Array {
    const { width, height } = this;
    const values = new Uint16Array(width * height);
    const blocks = blockCount(width, height);
    if (body.length < blocks) {
      throw new IrvisError(
        `frame body has ${String(body.length)} bytes, fewer than its ${String(blocks)} blocks`,
      );
    }
    let maskBytes = 0;
    {
      let block = 0;
      for (let by = 0; by < height; by += BLOCK_SIZE) {
        const rows = Math.min(BLOCK_SIZE, height - by);
        for (let bx = 0; bx < width; bx += BLOCK_SIZE) {
          const mode = body[block++] ?? 0;
          if (mode > BLOCK_SPARSE) throw new IrvisError(`unknown block mode ${String(mode)}`);
          if (mode === BLOCK_SPARSE) {
            maskBytes += Math.ceil((rows * Math.min(BLOCK_SIZE, width - bx)) / 8);
          }
        }
      }
    }
    const masks = new ByteReader(body.subarray(0, blocks + maskBytes), blocks);
    const input = new ByteReader(body, blocks + maskBytes);

    let block = 0;
    for (let by = 0; by < height; by += BLOCK_SIZE) {
      const rows = Math.min(BLOCK_SIZE, height - by);
      for (let bx = 0; bx < width; bx += BLOCK_SIZE) {
        const cols = Math.min(BLOCK_SIZE, width - bx);
        const mode = body[block++] ?? 0;
        if (mode === BLOCK_SKIP) {
          for (let y = by; y < by + rows; y++) {
            const start = y * width + bx;
            values.set(previous.subarray(start, start + cols), start);
          }
        } else if (mode === BLOCK_DENSE) {
          for (let y = by; y < by + rows; y++) {
            for (let x = bx; x < bx + cols; x++) {
              const i = y * width + x;
              values[i] = clamp16((previous[i] ?? 0) + readResidual(input) * step);
            }
          }
        } else {
          const mask = masks.bytes(Math.ceil((rows * cols) / 8));
          let k = 0;
          for (let y = by; y < by + rows; y++) {
            for (let x = bx; x < bx + cols; x++, k++) {
              const i = y * width + x;
              const p = previous[i] ?? 0;
              values[i] =
                ((mask[k >> 3] ?? 0) >> (k & 7)) & 1 ? clamp16(p + readResidual(input) * step) : p;
            }
          }
        }
      }
    }
    if (input.remaining !== 0) throw trailing(input.remaining);
    return values;
  }
}

function trailing(bytes: number): IrvisError {
  return new IrvisError(`frame body has ${String(bytes)} bytes after its last value`);
}

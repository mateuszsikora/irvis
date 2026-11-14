// Writes a .irvis recording to a ByteSink, frame by frame: one record per
// frame, so a crash loses only what the sink had not flushed.
// Specification: docs/irvis-format.md
import { deflateSync } from 'fflate';
import type { ByteSink } from '../bytes.ts';
import type { CameraStateSnapshot, Conversion } from '../cameras/profile.ts';
import type { ThermalFrame } from '../frames.ts';
import { ByteWriter } from './buffer.ts';
import {
  type BlockStats,
  DEFAULT_TUNING,
  type EncoderTuning,
  FrameEncoder,
  tuningProblems,
} from './codec.ts';
import { IrvisError } from './errors.ts';
import {
  type ChunkReason,
  FRAME_KEYFRAME,
  FRAME_UNCERTAIN,
  type FrameFieldId,
  type FrameFields,
  IRVIS_SIGNATURE,
  IRVIS_VERSION,
  type IndexedFrame,
  type IrvisChunk,
  type IrvisHeader,
  type IrvisProfileRef,
  RECORD_CHUNK,
  RECORD_FRAME,
  RECORD_HEADER,
  RECORD_INDEX,
  RECORD_VIEW,
  type RecordingPath,
  type ViewStateValues,
  encodeChunk,
  encodeHeader,
  encodeIndex,
  encodeRecord,
  encodeTrailer,
  encodeViewState,
  frameTimestamp,
  frozenCopy,
  headerProblems,
} from './format.ts';
import { NucDetector } from './nuc.ts';

/** A keyframe at least this often, in milliseconds of frame time. */
export const DEFAULT_KEYFRAME_INTERVAL_MS = 10_000;
/** The sink is flushed at least this often, in milliseconds of frame time. */
export const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
/** fflate's deflate level for frame bodies and the index. */
export const DEFAULT_DEFLATE_LEVEL = 6;

type DeflateLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface IrvisWriterOptions {
  readonly profile: IrvisProfileRef;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly path: RecordingPath;
  /** T in raw units: the guarantee the header states. */
  readonly threshold: number;
  /** Thresholds of earlier encodings, oldest first. Default none. */
  readonly thresholdHistory?: readonly number[];
  /**
   * How far a stored value may be from the value given to appendFrame, in raw
   * units, at most `threshold`. Default `threshold`; re-encoding sets T2 − T1.
   */
  readonly tolerance?: number;
  /** Fields every frame carries. Default none. */
  readonly frameFields?: readonly FrameFieldId[];
  /** View settings at the start. Default `{}`. */
  readonly viewState?: ViewStateValues;
  /** A keyframe at least this often; `Infinity` for none but the required ones. Default 10 000 ms. */
  readonly keyframeIntervalMs?: number;
  /** Flush the sink at least this often. Default 1 000 ms. */
  readonly flushIntervalMs?: number;
  /** Start a chunk after a NUC the data show. Default true. */
  readonly detectNuc?: boolean;
  /** Default 6. */
  readonly deflateLevel?: DeflateLevel;
  /** Encoder settings that a reader does not need. Default DEFAULT_TUNING. */
  readonly tuning?: EncoderTuning;
}

export interface AppendFrameOptions {
  /** Values of the header's frame fields; a missing one is stored as NaN. */
  readonly fields?: FrameFields;
  /** Start a chunk with this reason at this frame, whatever the writer would decide. */
  readonly chunk?: ChunkReason;
}

/** What appendFrame did with a frame. */
export interface AppendedFrame {
  /** Frame number in the file, from 0. */
  readonly index: number;
  /** The reason of the chunk this frame starts, or null when it continues one. */
  readonly chunk: ChunkReason | null;
  /** The values a reader will get back, as a copy the writer does not use again. */
  readonly values: Uint16Array;
  /** The frame's timestamp as stored: keyframes exactly, other frames to the microsecond. */
  readonly timestamp: number;
  readonly stats: BlockStats;
  /** Bytes of the frame record. */
  readonly bytes: number;
}

// Numbers compare with ===, so -0 equals the 0 that a JSON copy turns it into.
function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Every number in a conversion. */
function conversionNumbers(c: Conversion): readonly number[] {
  switch (c.kind) {
    case 'linear':
      return [c.scale, c.offset];
    case 'polynomial':
      return c.coefficients;
    case 'lut':
      return [c.firstRaw, ...c.celsius];
  }
}

/** Whether two conversions give the same temperatures, without serialising them. */
function sameConversion(a: Conversion, b: Conversion): boolean {
  if (a === b) return true;
  switch (a.kind) {
    case 'linear':
      return b.kind === 'linear' && a.scale === b.scale && a.offset === b.offset;
    case 'polynomial':
      return b.kind === 'polynomial' && sameNumbers(a.coefficients, b.coefficients);
    case 'lut':
      return b.kind === 'lut' && a.firstRaw === b.firstRaw && sameNumbers(a.celsius, b.celsius);
  }
}

function sameState(a: CameraStateSnapshot, b: CameraStateSnapshot): boolean {
  if (a.origin !== b.origin) return false;
  const keys = Object.keys(a.values);
  if (keys.length !== Object.keys(b.values).length) return false;
  return keys.every((k) => Object.hasOwn(b.values, k) && a.values[k] === b.values[k]);
}

function gainOf(state: CameraStateSnapshot): string | null {
  const gain = state.values['gain'];
  return typeof gain === 'string' ? gain : null;
}

function packMask(mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(mask.length / 8));
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) out[i >> 3] = (out[i >> 3] ?? 0) | (1 << (i & 7));
  }
  return out;
}

/**
 * Writes one .irvis file. Await each call before the next one; a call while
 * another is pending throws. close() writes the index and closes the sink.
 * A call that is rejected before it changes anything (a frame of the wrong
 * size, a timestamp that goes back) leaves the writer usable; when the sink
 * rejects, or a frame fails after encoding started, the writer refuses every
 * later call, close() included, and the file reads up to its last whole record.
 */
export class IrvisWriter {
  readonly header: IrvisHeader;
  private readonly sink: ByteSink;
  private readonly encoder: FrameEncoder;
  private readonly nuc: NucDetector | null;
  private readonly keyframeIntervalMs: number;
  private readonly flushIntervalMs: number;
  private readonly level: DeflateLevel;
  private offset = 0;
  private chunk: IrvisChunk | null = null;
  private chunkStart = 0;
  /** The previous frame's timestamp as stored, to the microsecond. */
  private lastTimestamp = 0;
  /** The previous frame's timestamp as given, which the next one may not precede. */
  private lastInput = Number.NEGATIVE_INFINITY;
  private lastFlush: number | null = null;
  private readonly chunks: number[] = [];
  private readonly frames: IndexedFrame[] = [];
  private readonly views: number[] = [];
  private busy = false;
  private closed = false;
  /** Why the writer stopped accepting calls, after the sink rejected or a write failed half-way. */
  private failure: string | null = null;

  private constructor(sink: ByteSink, header: IrvisHeader, options: IrvisWriterOptions) {
    this.sink = sink;
    this.header = header;
    this.encoder = new FrameEncoder(
      header.width,
      header.height,
      options.tolerance ?? header.threshold,
      options.tuning ?? DEFAULT_TUNING,
    );
    this.nuc = (options.detectNuc ?? true) ? new NucDetector() : null;
    this.keyframeIntervalMs = options.keyframeIntervalMs ?? DEFAULT_KEYFRAME_INTERVAL_MS;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.level = options.deflateLevel ?? DEFAULT_DEFLATE_LEVEL;
  }

  /** Checks the options, writes the signature and the header, and returns the writer. */
  static async create(sink: ByteSink, options: IrvisWriterOptions): Promise<IrvisWriter> {
    const header: IrvisHeader = {
      version: IRVIS_VERSION,
      profile: {
        id: options.profile.id,
        version: options.profile.version,
        name: options.profile.name,
      },
      width: options.width,
      height: options.height,
      fps: options.fps,
      bitDepth: 16,
      path: options.path,
      threshold: options.threshold,
      thresholdHistory: [...(options.thresholdHistory ?? [])],
      frameFields: [...(options.frameFields ?? [])],
      viewState: frozenCopy(options.viewState ?? {}),
    };
    const problems = headerProblems(header);
    const tolerance = options.tolerance ?? options.threshold;
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > options.threshold) {
      problems.push('tolerance must be an integer from 0 to the threshold');
    }
    for (const name of ['keyframeIntervalMs', 'flushIntervalMs'] as const) {
      const value = options[name];
      if (value !== undefined && !(value > 0)) {
        problems.push(`${name} must be a positive number or Infinity`);
      }
    }
    const level = options.deflateLevel;
    if (level !== undefined && !(Number.isInteger(level) && level >= 0 && level <= 9)) {
      problems.push('deflateLevel must be an integer from 0 to 9');
    }
    problems.push(...tuningProblems(options.tuning ?? DEFAULT_TUNING));
    if (problems.length > 0) throw new IrvisError(`invalid .irvis options: ${problems.join('; ')}`);
    const writer = new IrvisWriter(sink, header, options);
    const start = new ByteWriter(64);
    start.bytes(IRVIS_SIGNATURE);
    start.bytes(encodeRecord(RECORD_HEADER, encodeHeader(header)));
    await writer.write(start.finish());
    return writer;
  }

  /** Frames written so far. */
  get frameCount(): number {
    return this.frames.length;
  }

  /** Bytes written so far. */
  get size(): number {
    return this.offset;
  }

  /**
   * Appends bytes and only then counts them. A rejected append leaves the
   * sink's contents unknown, so the caller marks the writer failed.
   */
  private async write(bytes: Uint8Array): Promise<void> {
    await this.sink.append(bytes);
    this.offset += bytes.length;
  }

  /** Runs a step that changes the writer's state; any error makes the writer refuse every later call. */
  private async guarded<T>(step: () => Promise<T>): Promise<T> {
    try {
      return await step();
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private enter(): void {
    if (this.failure !== null) {
      throw new IrvisError(`the writer stopped after an earlier error: ${this.failure}`);
    }
    if (this.closed) throw new IrvisError('the writer is closed');
    if (this.busy) throw new IrvisError('wait for the previous call to the writer to settle');
    this.busy = true;
  }

  private chunkReason(
    frame: ThermalFrame,
    forced: ChunkReason | undefined,
    nuc: boolean,
  ): ChunkReason | null {
    const chunk = this.chunk;
    if (chunk === null) return forced ?? 'start';
    if (forced !== undefined) return forced;
    if (gainOf(frame.cameraState) !== chunk.gain) return 'gain';
    if (!sameState(frame.cameraState, chunk.cameraState)) return 'camera-state';
    if (!sameConversion(frame.conversion, chunk.conversion)) return 'conversion';
    if (nuc) return 'nuc';
    if (frame.timestamp - this.chunkStart >= this.keyframeIntervalMs) return 'interval';
    return null;
  }

  /** Encodes and appends one frame. */
  async appendFrame(frame: ThermalFrame, options: AppendFrameOptions = {}): Promise<AppendedFrame> {
    this.enter();
    try {
      const { width, height, frameFields } = this.header;
      if (frame.width !== width || frame.height !== height) {
        throw new IrvisError(
          `frame is ${String(frame.width)}×${String(frame.height)}, the recording is ${String(width)}×${String(height)}`,
        );
      }
      if (frame.raw.length !== width * height) {
        throw new IrvisError(
          `frame has ${String(frame.raw.length)} raw values, expected ${String(width * height)}`,
        );
      }
      if (frame.uncertain !== null && frame.uncertain.length !== width * height) {
        throw new IrvisError(
          `uncertain mask has ${String(frame.uncertain.length)} values, expected ${String(width * height)}`,
        );
      }
      if (!Number.isFinite(frame.timestamp)) throw new IrvisError('frame timestamp is not finite');
      if (this.chunk !== null) {
        if (frame.timestamp < this.lastInput) {
          throw new IrvisError(
            `frame timestamp ${String(frame.timestamp)} is before the previous frame's ${String(this.lastInput)}`,
          );
        }
        if (!Number.isSafeInteger(Math.round((frame.timestamp - this.lastTimestamp) * 1000))) {
          throw new IrvisError('frame timestamp is too far from the previous one');
        }
      }
      // JSON, which chunk records use, turns NaN and ±Infinity into null.
      if (!conversionNumbers(frame.conversion).every(Number.isFinite)) {
        throw new IrvisError('frame conversion has a number that is not finite');
      }
      for (const [id, value] of Object.entries(frame.cameraState.values)) {
        if (typeof value === 'number' && !Number.isFinite(value)) {
          throw new IrvisError(`camera state value '${id}' is not a finite number`);
        }
      }
      const fields = options.fields ?? {};
      for (const key of Object.keys(fields)) {
        if (!(frameFields as readonly string[]).includes(key)) {
          throw new IrvisError(`frame field '${key}' is not declared in the header`);
        }
      }

      // Nothing above changed the writer. From here on the detector and the
      // encoder move on, so a failure leaves the writer refusing every call.
      return await this.guarded(() => this.encodeAndAppend(frame, fields, options.chunk));
    } finally {
      this.busy = false;
    }
  }

  private async encodeAndAppend(
    frame: ThermalFrame,
    fields: FrameFields,
    forced: ChunkReason | undefined,
  ): Promise<AppendedFrame> {
    const { frameFields } = this.header;
    const nuc = this.nuc?.push(frame.raw, frame.conversion) ?? null;
    const reason = this.chunkReason(frame, forced, nuc !== null);
    const keyframe = reason !== null;
    const out = new ByteWriter(64);
    let chunk = this.chunk;
    if (reason !== null) {
      chunk = frozenCopy<IrvisChunk>({
        reason,
        step: this.encoder.step,
        conversion: frame.conversion,
        gain: gainOf(frame.cameraState),
        cameraState: { origin: frame.cameraState.origin, values: frame.cameraState.values },
      });
      out.bytes(encodeRecord(RECORD_CHUNK, encodeChunk(chunk)));
    }

    const encoded = this.encoder.encode(frame.raw, keyframe);
    const flags =
      (keyframe ? FRAME_KEYFRAME : 0) | (frame.uncertain !== null ? FRAME_UNCERTAIN : 0);
    const time = keyframe
      ? frame.timestamp
      : // At least 0: the input never goes back, and the stored previous
        // timestamp is at most 0.5 µs after the given one.
        Math.max(0, Math.round((frame.timestamp - this.lastTimestamp) * 1000));
    const timestamp = frameTimestamp(flags, time, this.lastTimestamp);

    const payload = new ByteWriter(encoded.body.length + 64);
    payload.u8(flags);
    if (keyframe) payload.f64(time);
    else payload.svarint(time);
    for (const id of frameFields) payload.f64(fields[id] ?? Number.NaN);
    let body = encoded.body;
    if (frame.uncertain !== null) {
      const mask = packMask(frame.uncertain);
      const joined = new Uint8Array(mask.length + body.length);
      joined.set(mask);
      joined.set(body, mask.length);
      body = joined;
    }
    payload.bytes(deflateSync(body, { level: this.level }));
    const record = encodeRecord(RECORD_FRAME, payload.finish());
    out.bytes(record);

    const start = this.offset;
    await this.write(out.finish());
    // The bytes are in the sink: only now does the writer's state move on.
    if (reason !== null) {
      this.chunk = chunk;
      this.chunkStart = frame.timestamp;
      this.chunks.push(start);
    }
    const index = this.frames.length;
    this.frames.push({ offset: this.offset - record.length, flags, time });
    this.lastTimestamp = timestamp;
    this.lastInput = frame.timestamp;
    if (this.lastFlush === null || timestamp - this.lastFlush >= this.flushIntervalMs) {
      this.lastFlush = timestamp;
      await this.sink.flush();
    }
    return {
      index,
      chunk: reason,
      values: encoded.values,
      timestamp,
      stats: encoded.stats,
      bytes: record.length,
    };
  }

  /** Records a change of the view settings; `values` holds only what changed. */
  async appendViewState(timestamp: number, values: ViewStateValues): Promise<void> {
    this.enter();
    try {
      if (!Number.isFinite(timestamp)) throw new IrvisError('view-state timestamp is not finite');
      const record = encodeRecord(RECORD_VIEW, encodeViewState({ timestamp, values }));
      await this.guarded(async () => {
        const start = this.offset;
        await this.write(record);
        this.views.push(start);
      });
    } finally {
      this.busy = false;
    }
  }

  /** Flushes the sink now. */
  async flush(): Promise<void> {
    this.enter();
    try {
      await this.guarded(() => this.sink.flush());
    } finally {
      this.busy = false;
    }
  }

  /** Writes the index and the trailer, then closes the sink. */
  async close(): Promise<void> {
    this.enter();
    try {
      const indexOffset = this.offset;
      const index = encodeIndex({ chunks: this.chunks, frames: this.frames, views: this.views });
      const out = new ByteWriter(index.length + 64);
      out.bytes(encodeRecord(RECORD_INDEX, deflateSync(index, { level: this.level })));
      out.bytes(encodeTrailer(indexOffset));
      await this.guarded(async () => {
        await this.write(out.finish());
        this.closed = true;
        await this.sink.close();
      });
    } finally {
      this.busy = false;
    }
  }
}

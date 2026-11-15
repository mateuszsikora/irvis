// Reads a .irvis file from a ByteSource: through the index at its end, or,
// when the file was cut short or damaged, by scanning the records up to the
// last valid one. Specification: docs/irvis-format.md
import { inflateSync } from 'fflate';
import { extractPngSnapshot, isPng } from '../export/png-container.ts';
import { memoryByteSource } from '../memory.ts';
import type { ByteSource } from '../bytes.ts';
import type { ThermalFrame } from '../frames.ts';
import { FrameDecoder } from './codec.ts';
import { IrvisError } from './errors.ts';
import {
  FRAME_KEYFRAME,
  FRAME_UNCERTAIN,
  type FrameFields,
  IRVIS_SIGNATURE,
  type IndexedFrame,
  type IrvisChunk,
  type IrvisHeader,
  type ParsedRecord,
  RECORD_CHUNK,
  RECORD_FRAME,
  RECORD_HEADER,
  RECORD_INDEX,
  RECORD_OVERHEAD,
  RECORD_VIEW,
  TRAILER_BYTES,
  type ViewStateChange,
  decodeChunk,
  decodeFramePrefix,
  decodeHeader,
  decodeIndex,
  decodeTrailer,
  decodeViewState,
  frameTimestamp,
  hasSignature,
  parseRecord,
} from './format.ts';

/** Bytes read from the source at a time while scanning. */
const WINDOW = 1 << 20;

/** Where a frame is and when it was taken. */
export interface IrvisFrameInfo {
  /** File offset of the frame record. */
  readonly offset: number;
  /** Milliseconds, as stored. */
  readonly timestamp: number;
  readonly keyframe: boolean;
  /** Number of the chunk the frame belongs to, from 0. */
  readonly chunk: number;
}

/** A decoded frame with what the file says about it. */
export interface IrvisFrame {
  readonly index: number;
  readonly keyframe: boolean;
  readonly frame: ThermalFrame;
  readonly fields: FrameFields;
  readonly chunk: IrvisChunk;
}

/** Where reading stopped in a file that was cut short or damaged, and why. */
export interface IrvisDamage {
  readonly offset: number;
  readonly reason: string;
}

/**
 * Reads records from a ByteSource: through a 1 MiB window while scanning, and
 * exactly the record's bytes for the random reads of the index path.
 */
class RecordScanner {
  private readonly source: ByteSource;
  private readonly size: number;
  private start = 0;
  private data: Uint8Array = new Uint8Array(0);

  constructor(source: ByteSource, size: number) {
    this.source = source;
    this.size = size;
  }

  /** Makes bytes [offset, offset + length) available; false when the source has fewer. */
  private async load(offset: number, length: number, windowed: boolean): Promise<boolean> {
    if (offset >= this.start && offset + length <= this.start + this.data.length) return true;
    const want = Math.min(windowed ? Math.max(length, WINDOW) : length, this.size - offset);
    this.data = await this.source.read(offset, want);
    this.start = offset;
    return this.data.length >= length;
  }

  async record(offset: number, windowed = true): Promise<ParsedRecord | string> {
    if (!Number.isSafeInteger(offset) || offset < 0) return 'a record offset is outside the file';
    if (offset + 5 > this.size) return 'the file ends inside a record header';
    if (!(await this.load(offset, 5, windowed)))
      return 'the source returned fewer bytes than its size';
    const local = offset - this.start;
    const view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    const length = view.getUint32(local + 1, true) + RECORD_OVERHEAD;
    if (offset + length > this.size) return 'the file ends inside a record';
    if (!(await this.load(offset, length, windowed))) {
      return 'the source returned fewer bytes than its size';
    }
    return parseRecord(this.data, offset - this.start);
  }
}

function inflate(data: Uint8Array, what: string): Uint8Array {
  try {
    return inflateSync(data);
  } catch {
    throw new IrvisError(`${what} does not inflate`);
  }
}

function unpackMask(bits: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = ((bits[i >> 3] ?? 0) >> (i & 7)) & 1;
  return out;
}

interface Cursor {
  readonly chunk: number;
  readonly frame: number;
  readonly start: number;
  readonly data: Uint8Array;
  readonly decoder: FrameDecoder;
  readonly meta: IrvisChunk;
  /** The frame decoded last, which `frame` numbers. */
  readonly last: IrvisFrame | null;
}

/** An open .irvis file. Open it with IrvisReader.open. */
export class IrvisReader {
  readonly header: IrvisHeader;
  /** Every frame, in order. */
  readonly frames: readonly IrvisFrameInfo[];
  /** Every view-state change, in the order written. */
  readonly viewStates: readonly ViewStateChange[];
  /** True when the index at the end of the file was read; false when the records were scanned. */
  readonly indexed: boolean;
  /** Where scanning stopped before the end of the data, or null when nothing is missing. */
  readonly damage: IrvisDamage | null;
  private readonly source: ByteSource;
  private readonly chunkOffsets: readonly number[];
  private readonly chunkFirstFrame: readonly number[];
  /** Where the records of the last chunk end. */
  private readonly dataEnd: number;
  private cursor: Cursor | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(init: {
    source: ByteSource;
    header: IrvisHeader;
    frames: IrvisFrameInfo[];
    viewStates: ViewStateChange[];
    chunkOffsets: number[];
    indexed: boolean;
    damage: IrvisDamage | null;
    dataEnd: number;
  }) {
    this.source = init.source;
    this.header = init.header;
    this.frames = init.frames;
    this.viewStates = init.viewStates;
    this.chunkOffsets = init.chunkOffsets;
    this.indexed = init.indexed;
    this.damage = init.damage;
    this.dataEnd = init.dataEnd;
    const first: number[] = [];
    init.frames.forEach((f, i) => {
      first[f.chunk] ??= i;
    });
    this.chunkFirstFrame = first;
  }

  /** Reads the header and the frame table, from the index or by scanning. */
  static async open(source: ByteSource): Promise<IrvisReader> {
    const size = await source.size();
    const signature = await source.read(0, IRVIS_SIGNATURE.length);
    if (isPng(signature)) {
      const png = extractPngSnapshot(await source.read(0, size));
      if (!hasSignature(png.bytes))
        throw new IrvisError('invalid thermal PNG: irVs is not an .irvis file');
      const reader = await IrvisReader.open(memoryByteSource(png.bytes));
      if (!reader.indexed) {
        throw new IrvisError('invalid thermal PNG: snapshot index is missing or damaged');
      }
      if (
        reader.frameCount !== 1 ||
        reader.header.width !== png.width ||
        reader.header.height !== png.height
      ) {
        throw new IrvisError('invalid thermal PNG: expected one frame matching IHDR dimensions');
      }
      await reader.readFrame(0);
      return reader;
    }
    if (!hasSignature(signature))
      throw new IrvisError('not an .irvis file: the signature is missing');
    const scanner = new RecordScanner(source, size);
    // Exactly the header: a file read through its index needs no window here.
    const first = await scanner.record(IRVIS_SIGNATURE.length, false);
    if (typeof first === 'string' || first.type !== RECORD_HEADER) {
      throw new IrvisError(
        `the header record is damaged: ${typeof first === 'string' ? first : 'another record comes first'}`,
      );
    }
    const header = decodeHeader(first.payload);
    const afterHeader = IRVIS_SIGNATURE.length + first.length;
    return (
      (await IrvisReader.fromIndex(source, size, header, scanner)) ??
      IrvisReader.scan(source, size, header, scanner, afterHeader)
    );
  }

  private static async fromIndex(
    source: ByteSource,
    size: number,
    header: IrvisHeader,
    scanner: RecordScanner,
  ): Promise<IrvisReader | null> {
    if (size < IRVIS_SIGNATURE.length + TRAILER_BYTES) return null;
    const indexOffset = decodeTrailer(await source.read(size - TRAILER_BYTES, TRAILER_BYTES));
    if (indexOffset === null || indexOffset >= size - TRAILER_BYTES) return null;
    const record = await scanner.record(indexOffset, false);
    if (typeof record === 'string' || record.type !== RECORD_INDEX) return null;
    if (indexOffset + record.length !== size - TRAILER_BYTES) return null;
    let index;
    try {
      index = decodeIndex(inflate(record.payload, 'the index'));
    } catch {
      return null;
    }
    const frames = framesFromIndex(index.frames, index.chunks, indexOffset);
    if (frames === null) return null;
    const viewStates: ViewStateChange[] = [];
    for (const offset of index.views) {
      const view = await scanner.record(offset, false);
      if (typeof view === 'string' || view.type !== RECORD_VIEW) return null;
      try {
        viewStates.push(decodeViewState(view.payload));
      } catch {
        return null;
      }
    }
    return new IrvisReader({
      source,
      header,
      frames,
      viewStates,
      chunkOffsets: [...index.chunks],
      indexed: true,
      damage: null,
      dataEnd: indexOffset,
    });
  }

  private static async scan(
    source: ByteSource,
    size: number,
    header: IrvisHeader,
    scanner: RecordScanner,
    start: number,
  ): Promise<IrvisReader> {
    const frames: IrvisFrameInfo[] = [];
    const viewStates: ViewStateChange[] = [];
    const chunkOffsets: number[] = [];
    let damage: IrvisDamage | null = null;
    let offset = start;
    let expectKeyframe = false;
    let last = 0;
    while (offset < size) {
      const record = await scanner.record(offset);
      if (typeof record === 'string') {
        damage = { offset, reason: record };
        break;
      }
      let problem: string | null = null;
      try {
        if (record.type === RECORD_CHUNK && expectKeyframe) {
          problem = 'a chunk does not start with a keyframe';
        } else if (record.type === RECORD_CHUNK) {
          decodeChunk(record.payload);
          chunkOffsets.push(offset);
          expectKeyframe = true;
        } else if (record.type === RECORD_FRAME) {
          const prefix = decodeFramePrefix(record.payload, header.frameFields.length);
          const keyframe = (prefix.flags & FRAME_KEYFRAME) !== 0;
          if (chunkOffsets.length === 0) problem = 'a frame comes before the first chunk';
          else if (keyframe !== expectKeyframe) {
            problem = keyframe
              ? 'a keyframe does not start a chunk'
              : 'a chunk does not start with a keyframe';
          } else {
            last = frameTimestamp(prefix.flags, prefix.time, last);
            frames.push({ offset, timestamp: last, keyframe, chunk: chunkOffsets.length - 1 });
            expectKeyframe = false;
          }
        } else if (record.type === RECORD_VIEW) {
          viewStates.push(decodeViewState(record.payload));
        } else if (record.type === RECORD_INDEX) {
          break;
        } else {
          problem = `unknown record type ${String(record.type)}`;
        }
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
      if (problem !== null) {
        damage = { offset, reason: problem };
        break;
      }
      offset += record.length;
    }
    // A chunk record without its keyframe is dropped with the rest.
    if (expectKeyframe) {
      const dangling = chunkOffsets.pop() ?? offset;
      damage ??= { offset: dangling, reason: 'the file ends after a chunk record' };
      offset = dangling;
    }
    return new IrvisReader({
      source,
      header,
      frames,
      viewStates,
      chunkOffsets,
      indexed: false,
      damage,
      dataEnd: offset,
    });
  }

  /** Number of frames. */
  get frameCount(): number {
    return this.frames.length;
  }

  /** Number of chunks; each starts with a keyframe. */
  get chunkCount(): number {
    return this.chunkOffsets.length;
  }

  /** Milliseconds from the first frame to the last; 0 for one frame or none. */
  get duration(): number {
    const first = this.frames[0];
    const last = this.frames[this.frames.length - 1];
    return first && last ? last.timestamp - first.timestamp : 0;
  }

  /** The index of the last frame taken at or before `timestamp`, or 0 before the first frame. */
  frameAt(timestamp: number): number {
    let low = 0;
    let high = this.frames.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.frames[mid]?.timestamp ?? 0) <= timestamp) low = mid;
      else high = mid - 1;
    }
    return Math.max(0, low);
  }

  /**
   * Decodes frame `index`. Reading the frames in order decodes each once;
   * any other frame decodes its chunk from the keyframe. Calls run one after
   * another.
   */
  readFrame(index: number): Promise<IrvisFrame> {
    const result = this.queue.then(() => this.decodeFrame(index));
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Every frame in order. */
  async *frameIterator(): AsyncGenerator<IrvisFrame> {
    for (let i = 0; i < this.frames.length; i++) yield await this.readFrame(i);
  }

  private async loadChunk(chunk: number): Promise<Cursor> {
    const start = this.chunkOffsets[chunk] ?? 0;
    const end = this.chunkOffsets[chunk + 1] ?? this.dataEnd;
    const data = await this.source.read(start, end - start);
    if (data.length !== end - start)
      throw new IrvisError(`chunk ${String(chunk)} is shorter than its records`);
    const record = parseRecord(data, 0);
    if (typeof record === 'string' || record.type !== RECORD_CHUNK) {
      throw new IrvisError(
        `chunk ${String(chunk)} at byte ${String(start)} is damaged: ${typeof record === 'string' ? record : 'no chunk record'}`,
      );
    }
    const meta = decodeChunk(record.payload);
    return {
      chunk,
      frame: -1,
      start,
      data,
      decoder: new FrameDecoder(this.header.width, this.header.height),
      meta,
      last: null,
    };
  }

  private async decodeFrame(index: number): Promise<IrvisFrame> {
    const info = this.frames[index];
    if (info === undefined || !Number.isInteger(index)) {
      throw new IrvisError(
        `frame ${String(index)} is not in the file (it has ${String(this.frames.length)})`,
      );
    }
    let cursor = this.cursor;
    if (cursor?.frame === index && cursor.last !== null) return copyFrame(cursor.last);
    if (cursor === null || cursor.chunk !== info.chunk || cursor.frame > index) {
      cursor = await this.loadChunk(info.chunk);
    }
    this.cursor = null;
    const firstFrame = this.chunkFirstFrame[info.chunk] ?? 0;
    let last: IrvisFrame | null = null;
    for (let i = Math.max(firstFrame, cursor.frame + 1); i <= index; i++) {
      last = this.decodeOne(i, cursor);
      cursor = { ...cursor, frame: i, last };
    }
    if (last === null) throw new IrvisError(`frame ${String(index)} could not be decoded`);
    this.cursor = cursor;
    return copyFrame(last);
  }

  private decodeOne(i: number, cursor: Cursor): IrvisFrame {
    const info = this.frames[i];
    if (info === undefined) throw new IrvisError(`frame ${String(i)} is not in the file`);
    const { width, height, frameFields } = this.header;
    const record = parseRecord(cursor.data, info.offset - cursor.start);
    if (typeof record === 'string' || record.type !== RECORD_FRAME) {
      throw new IrvisError(
        `frame ${String(i)} at byte ${String(info.offset)} is damaged: ${typeof record === 'string' ? record : 'not a frame record'}`,
      );
    }
    const prefix = decodeFramePrefix(record.payload, frameFields.length);
    let body = inflate(record.payload.subarray(prefix.bodyOffset), `frame ${String(i)}`);
    let uncertain: Uint8Array | null = null;
    if (prefix.flags & FRAME_UNCERTAIN) {
      const maskBytes = Math.ceil((width * height) / 8);
      if (body.length < maskBytes)
        throw new IrvisError(`frame ${String(i)} is shorter than its uncertain mask`);
      uncertain = unpackMask(body.subarray(0, maskBytes), width * height);
      body = body.subarray(maskBytes);
    }
    const raw = cursor.decoder.decode(body, info.keyframe, cursor.meta.step);
    const fields: Partial<Record<string, number>> = {};
    frameFields.forEach((id, k) => {
      fields[id] = prefix.fields[k] ?? Number.NaN;
    });
    return {
      index: i,
      keyframe: info.keyframe,
      chunk: cursor.meta,
      fields,
      frame: {
        width,
        height,
        timestamp: info.timestamp,
        raw,
        conversion: cursor.meta.conversion,
        cameraState: cursor.meta.cameraState,
        uncertain,
      },
    };
  }
}

/**
 * A copy of a decoded frame that the caller may change: the reader keeps the
 * original for a repeated read. The chunk is frozen and shared.
 */
function copyFrame(f: IrvisFrame): IrvisFrame {
  return {
    ...f,
    fields: { ...f.fields },
    frame: { ...f.frame, raw: f.frame.raw.slice(), uncertain: f.frame.uncertain?.slice() ?? null },
  };
}

/** The frame table from the index entries, or null when they do not fit together. */
function framesFromIndex(
  entries: readonly IndexedFrame[],
  chunks: readonly number[],
  indexOffset: number,
): IrvisFrameInfo[] | null {
  const frames: IrvisFrameInfo[] = [];
  let chunk = -1;
  let last = 0;
  let previousOffset = 0;
  for (const entry of entries) {
    const keyframe = (entry.flags & FRAME_KEYFRAME) !== 0;
    if (keyframe) chunk++;
    const chunkOffset = chunks[chunk];
    if (chunkOffset === undefined || entry.offset <= chunkOffset || entry.offset <= previousOffset)
      return null;
    if (entry.offset >= indexOffset) return null;
    last = frameTimestamp(entry.flags, entry.time, last);
    frames.push({ offset: entry.offset, timestamp: last, keyframe, chunk });
    previousOffset = entry.offset;
  }
  if (chunk + 1 !== chunks.length) return null;
  return frames;
}

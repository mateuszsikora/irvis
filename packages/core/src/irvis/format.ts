// The .irvis container: signature, records, header, chunk and view-state
// records, the index and the trailer. Specification: docs/irvis-format.md
import type { CameraStateSnapshot, Conversion } from '../cameras/profile.ts';
import { ByteReader, ByteWriter } from './buffer.ts';
import { crc32 } from './crc32.ts';
import { IrvisError } from './errors.ts';

/** The format version this code writes and the only one it reads. */
export const IRVIS_VERSION = 1;

/** The first 8 bytes of every .irvis file: 0x89, `IRVIS`, CR, LF. */
export const IRVIS_SIGNATURE = Uint8Array.of(0x89, 0x49, 0x52, 0x56, 0x49, 0x53, 0x0d, 0x0a);

/** The last 8 bytes of a complete file, after the offset of its index record. */
export const IRVIS_TRAILER_MAGIC = Uint8Array.of(0x49, 0x52, 0x56, 0x49, 0x53, 0x49, 0x44, 0x58);

/** Bytes of the trailer: the index offset as two u32 and the magic. */
export const TRAILER_BYTES = 16;

/** Bytes a record adds around its payload: type, length and CRC-32. */
export const RECORD_OVERHEAD = 9;

/** Record types. */
export const RECORD_HEADER = 1;
export const RECORD_CHUNK = 2;
export const RECORD_FRAME = 3;
export const RECORD_VIEW = 4;
export const RECORD_INDEX = 5;

/** Frame flags. */
export const FRAME_KEYFRAME = 1;
export const FRAME_UNCERTAIN = 2;

/** Where the raw values of a recording come from: the camera's bytes, or a reconstruction from 4:2:0 frames. */
export type RecordingPath = 'exact' | 'reconstructed';

/**
 * Values a frame may carry besides its pixels, such as conversion parameters
 * that change every frame. A new field needs a new format version.
 */
export type FrameFieldId = 'sensor-temperature';
export const FRAME_FIELDS: readonly FrameFieldId[] = ['sensor-temperature'];

/** Values of the declared frame fields; a field without a value is stored as NaN. */
export type FrameFields = Readonly<Partial<Record<FrameFieldId, number>>>;

/** A value that JSON can hold. */
export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * View settings by name: `palette`, `range`, `measurements`, `units`,
 * `emissivity`, `reflectedTemperature`, `offset` (draft names, see the
 * specification). A change lists only the settings that changed.
 */
export type ViewStateValues = Readonly<Record<string, JsonValue>>;

/** A change of the view settings at a time on the frames' clock. */
export interface ViewStateChange {
  /** Milliseconds, on the same clock as the frame timestamps. */
  readonly timestamp: number;
  readonly values: ViewStateValues;
}

/** The camera profile a recording was made with. */
export interface IrvisProfileRef {
  readonly id: string;
  readonly version: number;
  readonly name: string;
}

/** The header of a .irvis file. */
export interface IrvisHeader {
  readonly version: number;
  readonly profile: IrvisProfileRef;
  /** Thermal pixels per row. */
  readonly width: number;
  /** Thermal rows. */
  readonly height: number;
  /** Nominal frames per second; the frame timestamps say when each frame was taken. */
  readonly fps: number;
  /** Bits per raw value; 16 in version 1. */
  readonly bitDepth: number;
  readonly path: RecordingPath;
  /** T in raw units: every stored value is within T of the measured one. 0 is lossless. */
  readonly threshold: number;
  /** The thresholds of earlier encodings, oldest first; empty for a file never re-encoded. */
  readonly thresholdHistory: readonly number[];
  /** The fields every frame carries, in their stored order. */
  readonly frameFields: readonly FrameFieldId[];
  /** The view settings at the start of the recording. */
  readonly viewState: ViewStateValues;
}

/** Why a chunk, and so a keyframe, starts. */
export type ChunkReason = 'start' | 'interval' | 'gain' | 'camera-state' | 'conversion' | 'nuc';
const CHUNK_REASONS: readonly string[] = [
  'start',
  'interval',
  'gain',
  'camera-state',
  'conversion',
  'nuc',
];

/** What the frames of one chunk share. */
export interface IrvisChunk {
  readonly reason: ChunkReason;
  /** The quantiser step of the chunk's frames: 2 × tolerance + 1. */
  readonly step: number;
  readonly conversion: Conversion;
  /** The `gain` value of the camera state, or null when the state has none. */
  readonly gain: string | null;
  /** The camera state, as read from the camera, declared by the user, or assumed. */
  readonly cameraState: CameraStateSnapshot;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** A record: type, payload length, payload, and the CRC-32 of the three. */
export function encodeRecord(type: number, payload: Uint8Array): Uint8Array {
  const out = new ByteWriter(payload.length + RECORD_OVERHEAD);
  out.u8(type);
  out.u32(payload.length);
  out.bytes(payload);
  const body = out.finish();
  out.u32(crc32(body));
  return out.finish();
}

/** A record found in a byte array. */
export interface ParsedRecord {
  readonly type: number;
  readonly payload: Uint8Array;
  /** Bytes the record takes, overhead included. */
  readonly length: number;
}

/**
 * The record at `offset` in `data`, or a reason why there is none: the bytes
 * end inside it, or its CRC does not match.
 */
export function parseRecord(data: Uint8Array, offset: number): ParsedRecord | string {
  if (!Number.isSafeInteger(offset) || offset < 0) return 'a record offset is outside the file';
  if (offset + 5 > data.length) return 'the file ends inside a record header';
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = data[offset] ?? 0;
  const size = view.getUint32(offset + 1, true);
  const length = size + RECORD_OVERHEAD;
  if (offset + length > data.length) return 'the file ends inside a record';
  const stored = view.getUint32(offset + 5 + size, true);
  if (crc32(data.subarray(offset, offset + 5 + size)) !== stored) return 'CRC-32 mismatch';
  return { type, payload: data.subarray(offset + 5, offset + 5 + size), length };
}

export function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

/** Freezes a parsed JSON value and everything in it, so that readers can share it safely. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** A parsed and deeply frozen JSON value. */
export function decodeJson(payload: Uint8Array, what: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(payload));
  } catch {
    throw new IrvisError(`${what} is not valid JSON`);
  }
  return deepFreeze(value);
}

/** A deep copy of a JSON value, frozen, so that later changes to the original do not reach it. */
export function frozenCopy<T>(value: T): T {
  return deepFreeze(JSON.parse(JSON.stringify(value)) as T);
}

/** An object whose named fields are not checked yet. */
type Loose<K extends string> = { readonly [P in K]?: unknown };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asLoose<K extends string>(value: unknown): Loose<K> | null {
  return isObject(value) ? (value as Loose<K>) : null;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0x7fff;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'number' && Number.isFinite(v));
}

type HeaderKey =
  | 'version'
  | 'profile'
  | 'width'
  | 'height'
  | 'fps'
  | 'bitDepth'
  | 'path'
  | 'threshold'
  | 'thresholdHistory'
  | 'frameFields'
  | 'viewState';

/** Problems with header values, one message each; empty when they are consistent. */
export function headerProblems(h: Loose<HeaderKey>): string[] {
  const out: string[] = [];
  const profile = asLoose<'id' | 'version' | 'name'>(h.profile);
  if (
    profile === null ||
    typeof profile.id !== 'string' ||
    profile.id === '' ||
    !isPositiveInt(profile.version) ||
    typeof profile.name !== 'string'
  ) {
    out.push('profile needs an id, a positive integer version and a name');
  }
  if (!isPositiveInt(h.width) || !isPositiveInt(h.height)) {
    out.push('width and height must be positive integers');
  }
  if (typeof h.fps !== 'number' || !Number.isFinite(h.fps) || h.fps <= 0) {
    out.push('fps must be a positive number');
  }
  if (h.bitDepth !== 16) out.push('bitDepth must be 16');
  if (h.path !== 'exact' && h.path !== 'reconstructed') {
    out.push("path must be 'exact' or 'reconstructed'");
  }
  const threshold = h.threshold;
  if (!isThreshold(threshold)) out.push('threshold must be an integer from 0 to 32767');
  const history = h.thresholdHistory;
  if (!Array.isArray(history) || !history.every(isThreshold)) {
    out.push('thresholdHistory must be a list of thresholds');
  } else if (isThreshold(threshold) && history.some((t) => t > threshold)) {
    out.push('thresholdHistory may not hold a threshold above the current one');
  }
  const fields = h.frameFields;
  if (
    !Array.isArray(fields) ||
    !fields.every((f) => (FRAME_FIELDS as readonly unknown[]).includes(f)) ||
    new Set(fields).size !== fields.length
  ) {
    out.push(`frameFields must list distinct fields from: ${FRAME_FIELDS.join(', ')}`);
  }
  if (!isObject(h.viewState)) out.push('viewState must be an object');
  return out;
}

export function encodeHeader(header: IrvisHeader): Uint8Array {
  return encodeJson(header);
}

export function decodeHeader(payload: Uint8Array): IrvisHeader {
  const h = asLoose<HeaderKey>(decodeJson(payload, 'the header'));
  if (h === null) throw new IrvisError('the header is not a JSON object');
  if (h.version !== IRVIS_VERSION) {
    throw new IrvisError(
      `.irvis version ${JSON.stringify(h.version) ?? 'undefined'} is not supported; this reader reads version ${String(IRVIS_VERSION)}`,
    );
  }
  const problems = headerProblems(h);
  if (problems.length > 0) throw new IrvisError(`invalid header: ${problems.join('; ')}`);
  return h as IrvisHeader;
}

function isConversion(value: unknown): value is Conversion {
  const c = asLoose<'kind' | 'scale' | 'offset' | 'coefficients' | 'firstRaw' | 'celsius'>(value);
  if (c === null) return false;
  switch (c.kind) {
    case 'linear':
      return typeof c.scale === 'number' && typeof c.offset === 'number';
    case 'polynomial':
      return isNumberArray(c.coefficients) && c.coefficients.length >= 2;
    case 'lut':
      return typeof c.firstRaw === 'number' && isNumberArray(c.celsius);
    default:
      return false;
  }
}

function isCameraState(value: unknown): value is CameraStateSnapshot {
  const s = asLoose<'origin' | 'values'>(value);
  return (
    s !== null &&
    (s.origin === 'camera' || s.origin === 'declared' || s.origin === 'assumed') &&
    isObject(s.values) &&
    Object.values(s.values).every((v) => typeof v === 'string' || typeof v === 'number')
  );
}

export function encodeChunk(chunk: IrvisChunk): Uint8Array {
  return encodeJson(chunk);
}

export function decodeChunk(payload: Uint8Array): IrvisChunk {
  const c = asLoose<'reason' | 'step' | 'conversion' | 'gain' | 'cameraState'>(
    decodeJson(payload, 'a chunk record'),
  );
  if (
    c === null ||
    typeof c.reason !== 'string' ||
    !CHUNK_REASONS.includes(c.reason) ||
    !isPositiveInt(c.step) ||
    c.step % 2 !== 1 ||
    !isConversion(c.conversion) ||
    !(c.gain === null || typeof c.gain === 'string') ||
    !isCameraState(c.cameraState)
  ) {
    throw new IrvisError('invalid chunk record');
  }
  return c as IrvisChunk;
}

export function encodeViewState(change: ViewStateChange): Uint8Array {
  return encodeJson(change);
}

export function decodeViewState(payload: Uint8Array): ViewStateChange {
  const v = asLoose<'timestamp' | 'values'>(decodeJson(payload, 'a view-state record'));
  if (
    v === null ||
    typeof v.timestamp !== 'number' ||
    !Number.isFinite(v.timestamp) ||
    !isObject(v.values)
  ) {
    throw new IrvisError('invalid view-state record');
  }
  return v as ViewStateChange;
}

/** The start of a frame record's payload: everything but the deflated body. */
export interface FramePrefix {
  readonly flags: number;
  /** Absolute milliseconds for a keyframe; microseconds since the previous frame otherwise. */
  readonly time: number;
  readonly fields: readonly number[];
  /** Where the deflated body starts in the payload. */
  readonly bodyOffset: number;
}

export function decodeFramePrefix(payload: Uint8Array, fieldCount: number): FramePrefix {
  const input = new ByteReader(payload);
  const flags = input.u8();
  if (flags > (FRAME_KEYFRAME | FRAME_UNCERTAIN)) {
    throw new IrvisError(`unknown frame flags ${String(flags)}`);
  }
  const time = flags & FRAME_KEYFRAME ? input.f64() : input.svarint();
  if (!Number.isFinite(time)) throw new IrvisError('frame timestamp is not finite');
  const fields: number[] = [];
  for (let i = 0; i < fieldCount; i++) fields.push(input.f64());
  return { flags, time, fields, bodyOffset: input.position };
}

/**
 * The timestamp of a frame from its stored time: a keyframe stores
 * milliseconds, any other frame whole microseconds since the previous frame.
 * Writer and reader both compute it this way, so they agree to the bit.
 */
export function frameTimestamp(flags: number, time: number, previous: number): number {
  return flags & FRAME_KEYFRAME ? time : previous + time / 1000;
}

/** One frame in the index. */
export interface IndexedFrame {
  /** File offset of the frame record. */
  readonly offset: number;
  readonly flags: number;
  readonly time: number;
}

/** What the index record lists. */
export interface IrvisIndex {
  /** File offsets of the chunk records, in order. */
  readonly chunks: readonly number[];
  readonly frames: readonly IndexedFrame[];
  /** File offsets of the view-state records, in order. */
  readonly views: readonly number[];
}

function offsets(out: ByteWriter, list: readonly number[]): void {
  out.varint(list.length);
  let previous = 0;
  for (const offset of list) {
    out.varint(offset - previous);
    previous = offset;
  }
}

function readOffsets(input: ByteReader): number[] {
  const count = input.varint();
  const list: number[] = [];
  let previous = 0;
  for (let i = 0; i < count; i++) {
    previous += input.varint();
    list.push(previous);
  }
  return list;
}

/** The index payload before deflate. */
export function encodeIndex(index: IrvisIndex): Uint8Array {
  const out = new ByteWriter(16 + index.frames.length * 4);
  offsets(out, index.chunks);
  out.varint(index.frames.length);
  let previous = 0;
  for (const frame of index.frames) {
    out.varint(frame.offset - previous);
    previous = frame.offset;
    out.u8(frame.flags);
    if (frame.flags & FRAME_KEYFRAME) out.f64(frame.time);
    else out.svarint(frame.time);
  }
  offsets(out, index.views);
  return out.finish();
}

export function decodeIndex(data: Uint8Array): IrvisIndex {
  const input = new ByteReader(data);
  const chunks = readOffsets(input);
  const count = input.varint();
  const frames: IndexedFrame[] = [];
  let previous = 0;
  for (let i = 0; i < count; i++) {
    previous += input.varint();
    const flags = input.u8();
    const time = flags & FRAME_KEYFRAME ? input.f64() : input.svarint();
    frames.push({ offset: previous, flags, time });
  }
  const views = readOffsets(input);
  if (input.remaining !== 0) throw new IrvisError('the index has bytes after its end');
  return { chunks, frames, views };
}

/** The trailer after the index record: its offset and the magic. */
export function encodeTrailer(indexOffset: number): Uint8Array {
  const out = new ByteWriter(TRAILER_BYTES);
  out.u32(indexOffset % 0x100000000);
  out.u32(Math.floor(indexOffset / 0x100000000));
  out.bytes(IRVIS_TRAILER_MAGIC);
  return out.finish();
}

/** The index offset a trailer holds, or null when the bytes are not a trailer. */
export function decodeTrailer(data: Uint8Array): number | null {
  if (data.length !== TRAILER_BYTES) return null;
  for (let i = 0; i < 8; i++) if (data[8 + i] !== IRVIS_TRAILER_MAGIC[i]) return null;
  const input = new ByteReader(data);
  const low = input.u32();
  const high = input.u32();
  return high * 0x100000000 + low;
}

export function hasSignature(data: Uint8Array): boolean {
  if (data.length < IRVIS_SIGNATURE.length) return false;
  for (let i = 0; i < IRVIS_SIGNATURE.length; i++) {
    if (data[i] !== IRVIS_SIGNATURE[i]) return false;
  }
  return true;
}

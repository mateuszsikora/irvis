// Little-endian byte writing and reading for the .irvis format:
// docs/irvis-format.md#encoding-conventions
import { IrvisError } from './errors.ts';

const MAX_VARINT_BYTES = 8;

/** Zigzag mapping of a safe integer to a non-negative one: 0, -1, 1, -2, … → 0, 1, 2, 3, … */
export function zigzag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

/** The inverse of zigzag. */
export function unzigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

/** A growable buffer that appends little-endian values. */
export class ByteWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private used = 0;

  constructor(capacity = 1024) {
    this.buffer = new Uint8Array(Math.max(16, capacity));
    this.view = new DataView(this.buffer.buffer);
  }

  get length(): number {
    return this.used;
  }

  private reserve(bytes: number): void {
    if (this.used + bytes <= this.buffer.length) return;
    let capacity = this.buffer.length * 2;
    while (capacity < this.used + bytes) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buffer.subarray(0, this.used));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }

  u8(value: number): void {
    this.reserve(1);
    this.buffer[this.used++] = value;
  }

  u32(value: number): void {
    this.reserve(4);
    this.view.setUint32(this.used, value, true);
    this.used += 4;
  }

  f64(value: number): void {
    this.reserve(8);
    this.view.setFloat64(this.used, value, true);
    this.used += 8;
  }

  bytes(data: Uint8Array): void {
    this.reserve(data.length);
    this.buffer.set(data, this.used);
    this.used += data.length;
  }

  /** An unsigned LEB128 integer: 7 bits per byte, low bits first, at most 2^53 − 1. */
  varint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new IrvisError(`varint ${String(value)} is not a non-negative safe integer`);
    }
    let v = value;
    while (v >= 0x80) {
      this.u8((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.u8(v);
  }

  /** A signed integer as the varint of its zigzag mapping. */
  svarint(value: number): void {
    this.varint(zigzag(value));
  }

  /** The bytes written so far, as a new array. */
  finish(): Uint8Array {
    return this.buffer.slice(0, this.used);
  }
}

/** Reads little-endian values from a byte array; throws IrvisError past its end. */
export class ByteReader {
  private readonly data: Uint8Array;
  private readonly view: DataView;
  position: number;

  constructor(data: Uint8Array, position = 0) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.position = position;
  }

  get remaining(): number {
    return this.data.length - this.position;
  }

  private need(bytes: number): void {
    if (this.position + bytes > this.data.length) {
      throw new IrvisError(`unexpected end of data at byte ${String(this.position)}`);
    }
  }

  u8(): number {
    this.need(1);
    return this.data[this.position++] ?? 0;
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.position, true);
    this.position += 4;
    return value;
  }

  f64(): number {
    this.need(8);
    const value = this.view.getFloat64(this.position, true);
    this.position += 8;
    return value;
  }

  bytes(length: number): Uint8Array {
    this.need(length);
    const out = this.data.subarray(this.position, this.position + length);
    this.position += length;
    return out;
  }

  varint(): number {
    let value = 0;
    let factor = 1;
    for (let i = 0; i < MAX_VARINT_BYTES; i++) {
      const byte = this.u8();
      value += (byte & 0x7f) * factor;
      if (byte < 0x80) {
        if (!Number.isSafeInteger(value)) break;
        return value;
      }
      factor *= 0x80;
    }
    throw new IrvisError(`varint at byte ${String(this.position)} is too long`);
  }

  svarint(): number {
    return unzigzag(this.varint());
  }
}

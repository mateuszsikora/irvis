// ByteSink and ByteSource in memory: for tests, and for a one-frame .irvis
// that goes into a PNG photo instead of a file.
import type { ByteSink, ByteSource } from './bytes.ts';

/** A ByteSink that keeps every appended byte in memory. */
export class MemoryByteSink implements ByteSink {
  private readonly parts: Uint8Array[] = [];
  private total = 0;
  private closed = false;

  /** Bytes appended so far. */
  get size(): number {
    return this.total;
  }

  append(chunk: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error('MemoryByteSink is closed'));
    this.parts.push(chunk.slice());
    this.total += chunk.length;
    return Promise.resolve();
  }

  flush(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('MemoryByteSink is closed'));
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  /** Every appended byte, in order, as one new array. */
  bytes(): Uint8Array {
    const out = new Uint8Array(this.total);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

/** A ByteSource over bytes in memory. The array is not copied. */
export function memoryByteSource(bytes: Uint8Array): ByteSource {
  return {
    size: () => Promise.resolve(bytes.length),
    read: (offset, length) => {
      const start = Math.min(Math.max(0, offset), bytes.length);
      const end = Math.min(bytes.length, start + Math.max(0, length));
      return Promise.resolve(bytes.subarray(start, end));
    },
  };
}

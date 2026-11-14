import { describe, expect, it } from 'vitest';
import { ByteReader, ByteWriter, unzigzag, zigzag } from './buffer.ts';

describe('varint', () => {
  it('round-trips integers up to 2^53 - 1 and signed ones up to 2^52', () => {
    const values = [
      0,
      1,
      127,
      128,
      255,
      16383,
      16384,
      0xffffffff,
      0x100000000,
      Number.MAX_SAFE_INTEGER,
    ];
    const out = new ByteWriter(4);
    for (const v of values) out.varint(v);
    const signed = [0, -1, 63, -64, 0x10000000000, -0x10000000000000];
    for (const v of signed) out.svarint(v);
    const input = new ByteReader(out.finish());
    expect(values.map(() => input.varint())).toEqual(values);
    expect(signed.map(() => input.svarint())).toEqual(signed);
    expect(input.remaining).toBe(0);
  });

  it('maps signed values by zigzag', () => {
    expect([0, -1, 1, -2, 2].map(zigzag)).toEqual([0, 1, 2, 3, 4]);
    expect([0, 1, 2, 3, 4].map(unzigzag)).toEqual([0, -1, 1, -2, 2]);
  });

  it('rejects data that ends early or never ends', () => {
    expect(() => new ByteReader(Uint8Array.of(0x80)).varint()).toThrow(
      'unexpected end of data at byte 1',
    );
    expect(() => new ByteReader(new Uint8Array(9).fill(0xff)).varint()).toThrow('is too long');
    expect(() => new ByteWriter().varint(-1)).toThrow(
      'varint -1 is not a non-negative safe integer',
    );
  });
});

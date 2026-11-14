import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32.ts';

describe('crc32', () => {
  it('matches the check value of CRC-32/ISO-HDLC', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('continues over a second part', () => {
    const data = new TextEncoder().encode('thermal camera');
    expect(crc32(data.subarray(5), crc32(data.subarray(0, 5)))).toBe(crc32(data));
  });
});

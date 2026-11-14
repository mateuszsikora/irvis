// CRC-32 (IEEE 802.3, the one of zlib and PNG), our own code because core has
// no crypto or zlib: docs/decisions/architecture.md#core-uses-only-apis-that-browsers-and-node-share

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * The CRC-32 of `data`. Pass the result of an earlier call as `crc` to
 * continue over a second part: crc32(b, crc32(a)) equals crc32(a + b).
 */
export function crc32(data: Uint8Array, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) {
    c = (TABLE[(c ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

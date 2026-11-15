// PNG framing and private thermal chunk: docs/irvis-format.md#png-photos
import { zlibSync } from 'fflate';
import { crc32 } from '../irvis/crc32.ts';
import { IrvisError } from '../irvis/errors.ts';

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
export function isPng(bytes: Uint8Array): boolean {
  return SIGNATURE.every((v, i) => bytes[i] === v);
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}

export function encodePng(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  snapshot: Uint8Array,
): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const scanlines = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++)
    scanlines.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const parts = [
    SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlibSync(scanlines)),
    pngChunk('irVs', snapshot),
    pngChunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Checks framing and CRCs, without inflating or interpreting the visible image. */
export function extractPngSnapshot(bytes: Uint8Array): {
  bytes: Uint8Array;
  width: number;
  height: number;
} {
  const fail = (reason: string): never => {
    throw new IrvisError(`invalid thermal PNG: ${reason}`);
  };
  if (!isPng(bytes)) fail('signature is missing');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let snapshot: Uint8Array | null = null;
  let image = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) fail('truncated chunk');
    const length = view.getUint32(offset);
    if (length > 0x7fffffff || length > bytes.length - offset - 12) fail('invalid chunk length');
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) fail('invalid chunk type');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)
    )
      fail('CRC mismatch');
    if (offset === 8 && type !== 'IHDR') fail('IHDR must be first');
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) fail('invalid IHDR');
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (!width || !height || width > 0x7fffffff || height > 0x7fffffff)
        fail('invalid dimensions');
    } else if (type === 'IDAT') image = true;
    else if (type === 'irVs') {
      if (snapshot !== null) fail('duplicate irVs chunk');
      snapshot = data;
    } else if (type === 'IEND') {
      if (length !== 0 || offset + 12 !== bytes.length) fail('invalid IEND');
      if (!image) fail('IDAT is missing');
      if (snapshot === null) return fail('irVs chunk is missing');
      return { bytes: snapshot, width, height };
    } else if (type !== 'PLTE' && /^[A-Z]/.test(type)) fail('unknown critical chunk');
    offset += length + 12;
  }
  return fail('IEND is missing');
}

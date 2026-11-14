// Greyscale preview files: PGM (8 or 16 bits) and PNG (8 bits), with Node's
// zlib for the PNG deflate stream and CRC.
import { crc32, deflateSync } from 'node:zlib';

/** Binary PGM (P5). 16-bit samples are big-endian, as the format requires. */
export function pgm(width: number, height: number, pixels: Uint8Array | Uint16Array): Uint8Array {
  const maxval = pixels instanceof Uint16Array ? 65535 : 255;
  const header = new TextEncoder().encode(
    `P5\n${String(width)} ${String(height)}\n${String(maxval)}\n`,
  );
  const bytesPerSample = maxval === 255 ? 1 : 2;
  const out = new Uint8Array(header.length + width * height * bytesPerSample);
  out.set(header);
  if (bytesPerSample === 1) {
    out.set(pixels, header.length);
  } else {
    const view = new DataView(out.buffer, header.length);
    for (let i = 0; i < width * height; i++) view.setUint16(i * 2, pixels[i] ?? 0, false);
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An 8-bit greyscale PNG. */
export function png(width: number, height: number, grey: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 0, 0, 0, 0], 8); // bit depth 8, colour type 0 (grey), deflate, no filter, no interlace
  const rows = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0; // filter type None
    rows.set(grey.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Raw values stretched linearly from their minimum (0) to their maximum (255). */
export function stretch(values: Uint16Array): Uint8Array {
  let min = 65535;
  let max = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    out[i] = Math.round((((values[i] ?? 0) - min) * 255) / span);
  }
  return out;
}

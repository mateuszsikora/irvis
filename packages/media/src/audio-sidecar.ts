/** Version 2 PCM sidecar; all timestamps use the renderer's performance clock. */
const magic = new TextEncoder().encode('IRVAUD02');
export function audioHeader(sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(12);
  bytes.set(magic);
  new DataView(bytes.buffer).setUint32(8, sampleRate, true);
  return bytes;
}
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}
export function audioPacket(timestamp: number, samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(16 + samples.length * 4);
  const view = new DataView(bytes.buffer);
  view.setFloat64(0, timestamp, true);
  view.setUint32(8, samples.length, true);
  samples.forEach((sample, i) => view.setFloat32(12 + i * 4, sample, true));
  view.setUint32(bytes.length - 4, crc(bytes.subarray(0, -4)), true);
  return bytes;
}
/** Recover complete CRC-checked packets, crop pre-roll, and pad gaps with silence. */
export function alignAudio(bytes: Uint8Array, origin: number, durationMs: number) {
  if (bytes.length < 12 || !magic.every((byte, i) => bytes[i] === byte))
    throw new Error('Invalid audio sidecar header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = view.getUint32(8, true);
  if (sampleRate < 8000 || sampleRate > 192000) throw new Error('Invalid audio sample rate.');
  const samples = new Float32Array(Math.ceil((durationMs * sampleRate) / 1000));
  let previous = -Infinity;
  for (let at = 12; at + 16 <= bytes.length;) {
    const timestamp = view.getFloat64(at, true);
    const count = view.getUint32(at + 8, true);
    const end = at + 16 + count * 4;
    if (
      !Number.isFinite(timestamp) ||
      timestamp < previous ||
      !count ||
      count > 4096 ||
      end > bytes.length
    )
      break;
    if (crc(bytes.subarray(at, end - 4)) !== view.getUint32(end - 4, true)) break;
    const start = Math.round(((timestamp - origin) * sampleRate) / 1000);
    for (let i = Math.max(0, -start); i < count && start + i < samples.length; i++) {
      const value = view.getFloat32(at + 12 + i * 4, true);
      samples[start + i] = Number.isFinite(value) ? value : 0;
    }
    previous = timestamp;
    at = end;
  }
  return { sampleRate, samples };
}

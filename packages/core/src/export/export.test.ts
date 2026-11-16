import { describe, expect, it } from 'vitest';
import { unzlibSync } from 'fflate';
import {
  exportCsv,
  exportPng,
  exportRenderedPng,
  exportSnapshot,
  IrvisReader,
  memoryByteSource,
  renderPalette,
  celsiusImage,
  DEFAULT_CORRECTION,
  crc32,
} from '../index.ts';
import { staticScene, thermalFrame } from '../../test/irvis-scenes.ts';
import { extractPngSnapshot, pngChunk } from './png-container.ts';

const options = {
  profile: { id: 'test', name: 'Test', version: 1 },
  path: 'exact' as const,
  fps: 25,
};
const frame = () =>
  thermalFrame(staticScene({ width: 3, height: 2, frames: 1 }), 0, {
    uncertain: Uint8Array.of(0, 1, 0, 0, 0, 0),
  });
function chunks(bytes: Uint8Array) {
  const result: { type: string; data: Uint8Array; offset: number }[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let o = 8; o < bytes.length;) {
    const n = view.getUint32(o);
    result.push({
      type: new TextDecoder().decode(bytes.subarray(o + 4, o + 8)),
      data: bytes.subarray(o + 8, o + 8 + n),
      offset: o,
    });
    expect(view.getUint32(o + 8 + n)).toBe(crc32(bytes.subarray(o + 4, o + 8 + n)));
    o += n + 12;
  }
  return result;
}
describe('photo export', () => {
  it('preserves supplied overlay pixels and independent lossless temperatures', async () => {
    const input = frame();
    const raw = input.raw.slice();
    const rgba = new Uint8ClampedArray(input.width * input.height * 4).fill(123);
    const pending = exportRenderedPng(input, rgba, options);
    rgba.fill(0);
    input.raw.fill(0);
    const bytes = await pending;
    const pixels = unzlibSync(chunks(bytes).find((p) => p.type === 'IDAT')!.data);
    expect([...pixels]).toEqual([
      0,
      ...new Array<number>(12).fill(123),
      0,
      ...new Array<number>(12).fill(123),
    ]);
    const reader = await IrvisReader.open(memoryByteSource(bytes));
    expect((await reader.readFrame(0)).frame.raw).toEqual(raw);
    await expect(exportRenderedPng(input, new Uint8ClampedArray(1), options)).rejects.toThrow(
      'dimensions must match',
    );
  });
  it('round trips a lossless snapshot with metadata and captures reused buffers', async () => {
    const input = frame();
    const original = input.raw.slice();
    const pending = exportSnapshot(input, {
      ...options,
      path: 'reconstructed',
      frameFields: ['sensor-temperature'],
      fields: { 'sensor-temperature': 30 },
      viewState: { units: 'fahrenheit' },
    });
    input.raw.fill(0);
    const reader = await IrvisReader.open(memoryByteSource(await pending));
    expect(reader.frameCount).toBe(1);
    expect(reader.header.threshold).toBe(0);
    expect(reader.header.path).toBe('reconstructed');
    expect(reader.header.viewState).toEqual({ units: 'fahrenheit' });
    const decoded = await reader.readFrame(0);
    expect(decoded.frame).toEqual({ ...input, raw: original });
    expect(decoded.fields).toEqual({ 'sensor-temperature': 30 });
  });
  it('writes a standard RGBA PNG and opens its embedded frame through IrvisReader', async () => {
    const input = frame();
    const range = { minCelsius: 0, maxCelsius: 100 };
    const correction = { ...DEFAULT_CORRECTION, offsetKelvin: 5 };
    const bytes = await exportPng(input, { ...options, palette: 'white-hot', range, correction });
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = chunks(bytes);
    expect(parts.map((p) => p.type)).toEqual(['IHDR', 'IDAT', 'irVs', 'IEND']);
    expect([...parts[0]!.data]).toEqual([0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
    const pixels = renderPalette(celsiusImage(input, correction).celsius, range, 'white-hot');
    const scanlines = unzlibSync(parts[1]!.data);
    expect([...scanlines]).toEqual([0, ...pixels.subarray(0, 12), 0, ...pixels.subarray(12)]);
    const reader = await IrvisReader.open(memoryByteSource(bytes));
    expect((await reader.readFrame(0)).frame).toEqual(input);
    expect(reader.header.viewState).toEqual({ ...correction, palette: 'white-hot', range });
    expect(extractPngSnapshot(bytes).bytes).toEqual(
      await exportSnapshot(input, { ...options, viewState: reader.header.viewState }),
    );
  });
  it('rejects damaged, truncated, missing and duplicate thermal chunks', async () => {
    const bytes = await exportPng(frame(), options);
    const thermal = chunks(bytes)[2]!;
    const bad = bytes.slice();
    bad[thermal.offset + 8] = (bad[thermal.offset + 8] ?? 0) ^ 1;
    await expect(IrvisReader.open(memoryByteSource(bad))).rejects.toThrow('CRC mismatch');
    for (const end of [9, bytes.length - 1, bytes.length - 12]) {
      await expect(IrvisReader.open(memoryByteSource(bytes.subarray(0, end)))).rejects.toThrow(
        'invalid thermal PNG',
      );
    }
    const without = new Uint8Array([
      ...bytes.subarray(0, thermal.offset),
      ...pngChunk('IEND', new Uint8Array()),
    ]);
    await expect(IrvisReader.open(memoryByteSource(without))).rejects.toThrow(
      'irVs chunk is missing',
    );
    const duplicate = new Uint8Array([
      ...bytes.subarray(0, bytes.length - 12),
      ...pngChunk('irVs', thermal.data),
      ...bytes.subarray(bytes.length - 12),
    ]);
    await expect(IrvisReader.open(memoryByteSource(duplicate))).rejects.toThrow('duplicate irVs');
    const mismatch = bytes.slice();
    mismatch.set(pngChunk('IHDR', Uint8Array.of(0, 0, 0, 4, 0, 0, 0, 2, 8, 6, 0, 0, 0)), 8);
    await expect(IrvisReader.open(memoryByteSource(mismatch))).rejects.toThrow('matching IHDR');
  });
  it('rejects incomplete snapshots and nested PNG payloads', async () => {
    const bytes = await exportPng(frame(), options);
    const parts = chunks(bytes);
    const thermal = parts[2]!;
    const wrap = (payload: Uint8Array) =>
      new Uint8Array([
        ...bytes.subarray(0, thermal.offset),
        ...pngChunk('irVs', payload),
        ...pngChunk('IEND', new Uint8Array()),
      ]);
    await expect(IrvisReader.open(memoryByteSource(wrap(bytes)))).rejects.toThrow(
      'irVs is not an .irvis file',
    );
    await expect(
      IrvisReader.open(memoryByteSource(wrap(thermal.data.subarray(0, thermal.data.length - 16)))),
    ).rejects.toThrow('snapshot index is missing or damaged');
  });
  it('exports row-major Celsius without rounding and marks uncertain or missing readings', () => {
    expect(
      exportCsv({
        width: 2,
        height: 2,
        celsius: Float64Array.of(-1.23456789, NaN, Infinity, 20),
        uncertain: Uint8Array.of(0, 1, 0, 1),
      }),
    ).toBe('x,y,celsius,uncertain\r\n0,0,-1.23456789,0\r\n1,0,,1\r\n0,1,,0\r\n1,1,20,1\r\n');
    expect(() =>
      exportCsv({ width: 2, height: 2, celsius: new Float64Array(1), uncertain: null }),
    ).toThrow('expected 4');
  });
  it('uses a fallback range when every pixel is uncertain and rejects invalid ranges', async () => {
    const input = frame();
    input.uncertain!.fill(1);
    const reader = await IrvisReader.open(memoryByteSource(await exportPng(input, options)));
    expect(reader.header.viewState['range']).toEqual({ minCelsius: 0, maxCelsius: 1 });
    await expect(
      exportPng(input, { ...options, range: { minCelsius: 1, maxCelsius: 0 } }),
    ).rejects.toThrow();
  });
});

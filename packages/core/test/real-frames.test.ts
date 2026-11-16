import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { profile } from '../src/cameras/infiray-p2pro/profile.ts';
import { decodeThermalFrame } from '../src/yuyv.ts';
import { IrvisReader } from '../src/irvis/reader.ts';
import { IrvisWriter } from '../src/irvis/writer.ts';
import { MemoryByteSink, memoryByteSource } from '../src/memory.ts';

const root = new URL('../../../fixtures/infiray-p2pro/static-wall/', import.meta.url);
interface Entry {
  file: string;
  timestamp: number;
  sha256: string;
  minRaw: number;
  maxRaw: number;
  centreRaw: number;
}
async function load() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8')) as {
    frames: Entry[];
  };
  const mode = profile.videoModes[0];
  const conversion = profile.conversions[0];
  if (!mode || !conversion) throw new Error('Missing camera mode or conversion');
  return Promise.all(
    manifest.frames.map(async (entry) => {
      const data = gunzipSync(await readFile(new URL(entry.file, root)));
      const frame = decodeThermalFrame(
        { kind: 'yuyv', width: 256, height: 384, data, timestamp: entry.timestamp },
        mode,
        conversion.conversion,
        { origin: 'assumed', values: {} },
      );
      return { entry, data, frame };
    }),
  );
}

describe('real camera frames', () => {
  it('preserves packed capture bytes and thermal decoding', async () => {
    const frames = await load();
    expect(frames).toHaveLength(10);
    for (const { entry, data, frame } of frames) {
      expect(data.byteLength).toBe(196608);
      expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);
      expect(Math.min(...frame.raw)).toBe(entry.minRaw);
      expect(Math.max(...frame.raw)).toBe(entry.maxRaw);
      expect(frame.raw[96 * 256 + 128]).toBe(entry.centreRaw);
      for (let i = 0; i < frame.raw.length; i++) {
        expect(frame.raw[i]).toBe(data.readUInt16LE(98304 + i * 2));
      }
    }
  });

  it('reads the frozen v1 recording exactly in reverse order', async () => {
    const frames = await load();
    const reader = await IrvisReader.open(
      memoryByteSource(await readFile(new URL('lossless-v1.irvis', root))),
    );
    expect(reader.frameCount).toBe(frames.length);
    expect(reader.header.threshold).toBe(0);
    for (let i = frames.length - 1; i >= 0; i--) {
      const expected = frames[i]?.frame;
      const { frame } = await reader.readFrame(i);
      expect(frame.raw).toEqual(expected?.raw);
      expect(frame.conversion).toEqual(expected?.conversion);
      expect(frame.timestamp).toBeCloseTo(expected?.timestamp ?? NaN, 3);
    }
  });

  it('bounds every real pixel through lossless and lossy recording', async () => {
    const frames = await load();
    const defaultThreshold = profile.conversions[0]?.recordingThreshold;
    expect(defaultThreshold).toBeDefined();
    for (const threshold of new Set([0, 8, 16, defaultThreshold ?? 0])) {
      const sink = new MemoryByteSink();
      const writer = await IrvisWriter.create(sink, {
        profile: { id: profile.id, version: profile.version, name: profile.name },
        width: 256,
        height: 192,
        fps: 25,
        path: 'exact',
        threshold,
      });
      for (const { frame } of frames) await writer.appendFrame(frame);
      await writer.close();
      const reader = await IrvisReader.open(memoryByteSource(sink.bytes()));
      expect(reader.frameCount).toBe(frames.length);
      for (let i = 0; i < frames.length; i++) {
        const expected = frames[i]?.frame;
        if (!expected) throw new Error('Missing fixture frame');
        const { frame } = await reader.readFrame(i);
        let worst = 0;
        for (let p = 0; p < frame.raw.length; p++) {
          worst = Math.max(worst, Math.abs((frame.raw[p] ?? 0) - (expected.raw[p] ?? 0)));
        }
        expect(worst).toBeLessThanOrEqual(threshold);
      }
    }
  });
});

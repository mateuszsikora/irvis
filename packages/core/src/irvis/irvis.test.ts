import { describe, expect, it } from 'vitest';
import {
  CONVERSION,
  type Scene,
  maxError,
  movingHandScene,
  nucScene,
  staticScene,
  thermalFrame,
} from '../../test/irvis-scenes.ts';
import type { ByteSink, ByteSource } from '../bytes.ts';
import type { CameraStateSnapshot } from '../cameras/profile.ts';
import { MemoryByteSink, memoryByteSource } from '../memory.ts';
import {
  type ChunkReason,
  IRVIS_SIGNATURE,
  RECORD_CHUNK,
  RECORD_HEADER,
  encodeJson,
  encodeRecord,
} from './format.ts';
import { IrvisReader } from './reader.ts';
import { reencodeIrvis } from './reencode.ts';
import { IrvisWriter, type IrvisWriterOptions } from './writer.ts';

/** A sink whose append rejects from the `failAt`-th call on (1 is the first). */
function failingSink(failAt: number): { sink: ByteSink; memory: MemoryByteSink } {
  const memory = new MemoryByteSink();
  let calls = 0;
  const sink: ByteSink = {
    append: (chunk) =>
      ++calls >= failAt ? Promise.reject(new Error('QuotaExceededError')) : memory.append(chunk),
    flush: () => memory.flush(),
    close: () => memory.close(),
  };
  return { sink, memory };
}

/** A source that counts the bytes read from it. */
function countingSource(bytes: Uint8Array): { source: ByteSource; read: () => number } {
  const inner = memoryByteSource(bytes);
  let total = 0;
  return {
    source: {
      size: () => inner.size(),
      read: async (offset, length) => {
        const data = await inner.read(offset, length);
        total += data.length;
        return data;
      },
    },
    read: () => total,
  };
}

const PROFILE = { id: 'infiray-p2pro', version: 1, name: 'InfiRay P2 Pro' };

function options(
  scene: Scene,
  threshold: number,
  more: Partial<IrvisWriterOptions> = {},
): IrvisWriterOptions {
  return {
    profile: PROFILE,
    width: scene.width,
    height: scene.height,
    fps: 25,
    path: 'exact',
    threshold,
    ...more,
  };
}

async function record(
  scene: Scene,
  threshold: number,
  more: Partial<IrvisWriterOptions> = {},
): Promise<{ bytes: Uint8Array; chunks: (ChunkReason | null)[] }> {
  const sink = new MemoryByteSink();
  const writer = await IrvisWriter.create(sink, options(scene, threshold, more));
  const chunks: (ChunkReason | null)[] = [];
  for (let f = 0; f < scene.frames.length; f++) {
    chunks.push((await writer.appendFrame(thermalFrame(scene, f))).chunk);
  }
  await writer.close();
  return { bytes: sink.bytes(), chunks };
}

async function readAll(reader: IrvisReader): Promise<Uint16Array[]> {
  const out: Uint16Array[] = [];
  for await (const { frame } of reader.frameIterator()) out.push(frame.raw);
  return out;
}

const small = { width: 40, height: 24, frames: 60 };

describe('irvis round trip', () => {
  it('reads back every frame within the threshold, with its metadata', async () => {
    const scene = movingHandScene(small);
    const sink = new MemoryByteSink();
    const writer = await IrvisWriter.create(
      sink,
      options(scene, 8, {
        path: 'reconstructed',
        frameFields: ['sensor-temperature'],
        viewState: { palette: 'iron', units: 'C' },
      }),
    );
    const mask = new Uint8Array(scene.width * scene.height);
    mask[3] = 1;
    mask[mask.length - 1] = 1;
    await writer.appendViewState(1000, { palette: 'rainbow' });
    for (let f = 0; f < scene.frames.length; f++) {
      const frame = thermalFrame(scene, f, { uncertain: f % 2 === 0 ? mask : null });
      await writer.appendFrame(
        frame,
        f < 30 ? { fields: { 'sensor-temperature': 30 + f / 10 } } : {},
      );
      if (f === 40) await writer.appendViewState(frame.timestamp, { range: { min: 20, max: 40 } });
    }
    await writer.close();

    const reader = await IrvisReader.open(memoryByteSource(sink.bytes()));
    expect(reader.indexed).toBe(true);
    expect(reader.damage).toBeNull();
    expect(reader.header).toEqual({
      version: 1,
      profile: PROFILE,
      width: 40,
      height: 24,
      fps: 25,
      bitDepth: 16,
      path: 'reconstructed',
      threshold: 8,
      thresholdHistory: [],
      frameFields: ['sensor-temperature'],
      viewState: { palette: 'iron', units: 'C' },
    });
    expect(reader.frameCount).toBe(60);
    expect(reader.viewStates).toEqual([
      { timestamp: 1000, values: { palette: 'rainbow' } },
      { timestamp: 2600, values: { range: { min: 20, max: 40 } } },
    ]);
    for (let f = 0; f < scene.frames.length; f++) {
      const { frame, fields } = await reader.readFrame(f);
      expect(maxError(frame.raw, scene.frames[f] ?? new Uint16Array(0))).toBeLessThanOrEqual(8);
      expect(frame.timestamp).toBe(scene.timestamps[f]);
      expect(frame.conversion).toEqual(CONVERSION);
      expect(frame.cameraState).toEqual({ origin: 'assumed', values: {} });
      expect(frame.uncertain).toEqual(f % 2 === 0 ? mask : null);
      expect(fields['sensor-temperature']).toBe(f < 30 ? 30 + f / 10 : Number.NaN);
    }
  });

  it('is lossless at threshold 0', async () => {
    const scene = movingHandScene(small);
    const reader = await IrvisReader.open(memoryByteSource((await record(scene, 0)).bytes));
    expect(await readAll(reader)).toEqual(scene.frames);
  });

  it('keeps the time of every frame, so dropped frames do not shift time', async () => {
    const base = staticScene({ width: 16, height: 8, frames: 6 });
    const timestamps = [5000.25, 5040.25, 5200.25, 5240.5, 5240.5, 9000];
    const scene = { ...base, timestamps };
    const reader = await IrvisReader.open(memoryByteSource((await record(scene, 4)).bytes));
    expect(reader.frames.map((f) => f.timestamp)).toEqual(timestamps);
    expect(reader.duration).toBe(9000 - 5000.25);
    expect(reader.frameAt(5239)).toBe(2);
    expect(reader.frameAt(5240.5)).toBe(4);
    expect(reader.frameAt(0)).toBe(0);
    expect(reader.frameAt(1e9)).toBe(5);
  });

  it('starts a keyframe after commands even when the recorded gain is unchanged', async () => {
    const scene = staticScene({ width: 16, height: 8, frames: 2 });
    const sink = new MemoryByteSink();
    const writer = await IrvisWriter.create(sink, options(scene, 8));
    await writer.appendFrame(
      thermalFrame(scene, 0, {
        cameraState: { origin: 'camera', values: { gain: 'high' } },
      }),
    );
    const result = await writer.appendFrame(
      thermalFrame(scene, 1, {
        cameraState: { origin: 'camera', values: { gain: 'high', 'command-generation': 2 } },
      }),
    );
    expect(result.chunk).toBe('camera-state');
    await writer.close();
  });

  it('starts a chunk at the start, every interval, after a gain, camera-state or conversion change and after a NUC', async () => {
    const scene = nucScene(30, 3, 200, small);
    const high: CameraStateSnapshot = {
      origin: 'camera',
      values: { gain: 'high', emissivity: 0.95 },
    };
    const low: CameraStateSnapshot = {
      origin: 'camera',
      values: { gain: 'low', emissivity: 0.95 },
    };
    const matte: CameraStateSnapshot = {
      origin: 'camera',
      values: { gain: 'low', emissivity: 0.9 },
    };
    const other = { kind: 'linear', scale: 1 / 16, offset: -273.15 } as const;
    const sink = new MemoryByteSink();
    const writer = await IrvisWriter.create(sink, options(scene, 8, { keyframeIntervalMs: 800 }));
    const reasons: [number, ChunkReason][] = [];
    for (let f = 0; f < scene.frames.length; f++) {
      const cameraState = f < 5 ? high : f < 8 ? low : matte;
      const conversion = f < 12 ? CONVERSION : other;
      const appended = await writer.appendFrame(
        thermalFrame(scene, f, { cameraState, conversion }),
      );
      if (appended.chunk !== null) reasons.push([f, appended.chunk]);
    }
    await writer.close();
    expect(reasons).toEqual([
      [0, 'start'],
      [5, 'gain'],
      [8, 'camera-state'],
      [12, 'conversion'],
      [32, 'interval'],
      [33, 'nuc'],
      [53, 'interval'],
    ]);

    const reader = await IrvisReader.open(memoryByteSource(sink.bytes()));
    expect(reader.chunkCount).toBe(7);
    expect(reader.frames.filter((f) => f.keyframe).map((f) => reader.frames.indexOf(f))).toEqual(
      reasons.map(([f]) => f),
    );
    const sixth = await reader.readFrame(6);
    expect(sixth.chunk.gain).toBe('low');
    expect(sixth.frame.cameraState).toEqual(low);
    expect((await reader.readFrame(20)).frame.conversion).toEqual(other);
  });

  it('decodes any frame in any order', async () => {
    const scene = movingHandScene(small);
    const { bytes } = await record(scene, 8, { keyframeIntervalMs: 400 });
    const sequential = await readAll(await IrvisReader.open(memoryByteSource(bytes)));
    const reader = await IrvisReader.open(memoryByteSource(bytes));
    for (const f of [59, 3, 3, 47, 10, 0, 58, 59, 11]) {
      expect((await reader.readFrame(f)).frame.raw).toEqual(sequential[f]);
    }
    await expect(reader.readFrame(60)).rejects.toThrow('frame 60 is not in the file (it has 60)');
  });

  it('flushes the sink about every second of frames', async () => {
    let flushes = 0;
    const memory = new MemoryByteSink();
    const sink: ByteSink = {
      append: (chunk) => memory.append(chunk),
      flush: () => {
        flushes++;
        return memory.flush();
      },
      close: () => memory.close(),
    };
    const scene = staticScene({ width: 16, height: 8, frames: 60 });
    const writer = await IrvisWriter.create(sink, options(scene, 8));
    for (let f = 0; f < 60; f++) await writer.appendFrame(thermalFrame(scene, f));
    expect(flushes).toBe(3);
    await writer.close();
  });
});

describe('irvis recovery', () => {
  it('reads a file cut at any byte up to its last valid record', async () => {
    const scene = movingHandScene({ width: 16, height: 16, frames: 30 });
    const { bytes } = await record(scene, 4, { keyframeIntervalMs: 200 });
    const full = await IrvisReader.open(memoryByteSource(bytes));
    const frames = await readAll(full);
    const headerEnd = full.frames[0]?.offset ?? 0;
    for (let cut = headerEnd; cut < bytes.length; cut += 7) {
      const reader = await IrvisReader.open(memoryByteSource(bytes.subarray(0, cut)));
      expect(reader.indexed).toBe(false);
      // Every frame whose record ends before the cut is read; none that starts after it.
      const whole = full.frames.filter(
        (_, i) => (full.frames[i + 1]?.offset ?? bytes.length) <= cut,
      );
      const started = full.frames.filter((f) => f.offset < cut);
      expect(reader.frameCount).toBeGreaterThanOrEqual(whole.length);
      expect(reader.frameCount).toBeLessThanOrEqual(started.length);
      expect(reader.frames).toEqual(full.frames.slice(0, reader.frameCount));
      expect(await readAll(reader)).toEqual(frames.slice(0, reader.frameCount));
    }
  });

  it('rebuilds the frame table that the index holds', async () => {
    const scene = movingHandScene(small);
    const { bytes } = await record(scene, 8, { keyframeIntervalMs: 400 });
    const indexed = await IrvisReader.open(memoryByteSource(bytes));
    const scanned = await IrvisReader.open(memoryByteSource(bytes.subarray(0, bytes.length - 1)));
    expect(indexed.indexed).toBe(true);
    expect(scanned.indexed).toBe(false);
    expect(scanned.damage).toBeNull();
    expect(scanned.frames).toEqual(indexed.frames);
    expect(scanned.chunkCount).toBe(indexed.chunkCount);
  });

  it('stops at a damaged record', async () => {
    const scene = movingHandScene(small);
    const { bytes } = await record(scene, 8);
    const full = await IrvisReader.open(memoryByteSource(bytes));
    const target = full.frames[30]?.offset ?? 0;
    const damaged = bytes.slice();
    damaged[target + 12] = (damaged[target + 12] ?? 0) ^ 0xff;

    const withIndex = await IrvisReader.open(memoryByteSource(damaged));
    expect(withIndex.indexed).toBe(true);
    await expect(withIndex.readFrame(30)).rejects.toThrow(
      `frame 30 at byte ${String(target)} is damaged: CRC-32 mismatch`,
    );

    const withoutIndex = await IrvisReader.open(
      memoryByteSource(damaged.subarray(0, damaged.length - 16)),
    );
    expect(withoutIndex.frameCount).toBe(30);
    expect(withoutIndex.damage).toEqual({ offset: target, reason: 'CRC-32 mismatch' });
  });

  it('stops at a chunk record that another chunk record follows', async () => {
    const scene = staticScene({ width: 16, height: 8, frames: 5 });
    const { bytes } = await record(scene, 8);
    const full = await IrvisReader.open(memoryByteSource(bytes));
    const keyframe = full.frames[0]?.offset ?? 0;
    // The chunk record follows the header record: signature, then type, length, payload, CRC.
    const headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(9, true);
    const chunkStart = IRVIS_SIGNATURE.length + 9 + headerLength;
    expect(bytes[chunkStart]).toBe(RECORD_CHUNK);
    const chunkRecord = bytes.subarray(chunkStart, keyframe);
    const doubled = new Uint8Array([
      ...bytes.subarray(0, keyframe),
      ...chunkRecord,
      ...bytes.subarray(keyframe, bytes.length - 16),
    ]);
    const reader = await IrvisReader.open(memoryByteSource(doubled));
    expect(reader.frameCount).toBe(0);
    expect(reader.damage).toEqual({
      offset: keyframe,
      reason: 'a chunk does not start with a keyframe',
    });
  });

  it('reads only the records it needs when the index is intact', async () => {
    const scene = movingHandScene({ width: 40, height: 24, frames: 60 });
    const sink = new MemoryByteSink();
    const writer = await IrvisWriter.create(sink, options(scene, 8));
    for (let f = 0; f < scene.frames.length; f++) {
      await writer.appendFrame(thermalFrame(scene, f));
      await writer.appendViewState(scene.timestamps[f] ?? 0, { range: { min: f, max: 40 } });
    }
    await writer.close();
    const bytes = sink.bytes();
    const counted = countingSource(bytes);
    const reader = await IrvisReader.open(counted.source);
    expect(reader.indexed).toBe(true);
    expect(reader.viewStates).toHaveLength(60);
    // The header, the trailer, the index and the views, read exactly: no
    // frame data. A windowed header read alone would take the whole file.
    expect(counted.read()).toBeLessThan(bytes.length / 2);
  });

  it('rejects a file that is not .irvis or is of another version', async () => {
    await expect(
      IrvisReader.open(memoryByteSource(new TextEncoder().encode('PNG'))),
    ).rejects.toThrow('not an .irvis file: the signature is missing');
    await expect(IrvisReader.open(memoryByteSource(IRVIS_SIGNATURE))).rejects.toThrow(
      'the header record is damaged: the file ends inside a record header',
    );
    const scene = staticScene({ width: 8, height: 8, frames: 1 });
    const { bytes } = await record(scene, 0);
    const header = (await IrvisReader.open(memoryByteSource(bytes))).header;
    const newer = new Uint8Array([
      ...IRVIS_SIGNATURE,
      ...encodeRecord(RECORD_HEADER, encodeJson({ ...header, version: 2 })),
    ]);
    await expect(IrvisReader.open(memoryByteSource(newer))).rejects.toThrow(
      '.irvis version 2 is not supported; this reader reads version 1',
    );
    const broken = new Uint8Array([
      ...IRVIS_SIGNATURE,
      ...encodeRecord(RECORD_HEADER, encodeJson({ ...header, bitDepth: 12, threshold: -1 })),
    ]);
    await expect(IrvisReader.open(memoryByteSource(broken))).rejects.toThrow(
      'invalid header: bitDepth must be 16; threshold must be an integer from 0 to 32767',
    );
  });
});

describe('irvis writer', () => {
  it('rejects frames that do not fit the header and calls that overlap', async () => {
    const scene = staticScene({ width: 16, height: 8, frames: 2 });
    const writer = await IrvisWriter.create(new MemoryByteSink(), options(scene, 8));
    await expect(writer.appendFrame(thermalFrame(scene, 0, { width: 8 }))).rejects.toThrow(
      'frame is 8×8, the recording is 16×8',
    );
    await expect(
      writer.appendFrame(thermalFrame(scene, 0), { fields: { 'sensor-temperature': 1 } }),
    ).rejects.toThrow("frame field 'sensor-temperature' is not declared in the header");
    const first = writer.appendFrame(thermalFrame(scene, 0));
    await expect(writer.appendFrame(thermalFrame(scene, 1))).rejects.toThrow(
      'wait for the previous call to the writer to settle',
    );
    await first;
    await writer.close();
    await expect(writer.appendFrame(thermalFrame(scene, 1))).rejects.toThrow(
      'the writer is closed',
    );
  });

  it('rejects inconsistent options', async () => {
    const scene = staticScene({ width: 16, height: 8, frames: 1 });
    await expect(
      IrvisWriter.create(new MemoryByteSink(), options(scene, 4, { tolerance: 5, width: 0 })),
    ).rejects.toThrow(
      'invalid .irvis options: width and height must be positive integers; tolerance must be an integer from 0 to the threshold',
    );
  });
});

describe('irvis writer failures', () => {
  it('refuses every call after the sink fails, and the file keeps its guarantee', async () => {
    const scene = movingHandScene({ width: 40, height: 24, frames: 10 });
    // Append 1 is the signature and header, so append 5 is frame 3.
    const { sink, memory } = failingSink(5);
    const writer = await IrvisWriter.create(sink, options(scene, 8));
    for (let f = 0; f < 3; f++) await writer.appendFrame(thermalFrame(scene, f));
    await expect(writer.appendFrame(thermalFrame(scene, 3))).rejects.toThrow('QuotaExceededError');
    await expect(writer.appendFrame(thermalFrame(scene, 4))).rejects.toThrow(
      'the writer stopped after an earlier error: QuotaExceededError',
    );
    await expect(writer.close()).rejects.toThrow('the writer stopped after an earlier error');
    expect(writer.frameCount).toBe(3);

    const reader = await IrvisReader.open(memoryByteSource(memory.bytes()));
    expect(reader.frameCount).toBe(3);
    const decoded = await readAll(reader);
    decoded.forEach((raw, f) => {
      expect(maxError(raw, scene.frames[f] ?? new Uint16Array(0))).toBeLessThanOrEqual(8);
    });
  });

  it('stays usable after a call it rejects before writing', async () => {
    const scene = staticScene({ width: 16, height: 8, frames: 3 });
    const sink = new MemoryByteSink();
    const writer = await IrvisWriter.create(sink, options(scene, 8));
    await writer.appendFrame(thermalFrame(scene, 1));
    await expect(writer.appendFrame(thermalFrame(scene, 0))).rejects.toThrow(
      "frame timestamp 1000 is before the previous frame's 1040",
    );
    await writer.appendFrame(thermalFrame(scene, 2));
    await writer.close();
    const reader = await IrvisReader.open(memoryByteSource(sink.bytes()));
    expect(reader.frames.map((f) => f.timestamp)).toEqual([1040, 1080]);
  });

  it('does not let a change to a returned array reach the next frame', async () => {
    const scene = movingHandScene({ width: 40, height: 24, frames: 6 });
    const sink = new MemoryByteSink();
    const writer = await IrvisWriter.create(sink, options(scene, 8));
    for (let f = 0; f < scene.frames.length; f++) {
      (await writer.appendFrame(thermalFrame(scene, f))).values.fill(0);
    }
    await writer.close();

    const reader = await IrvisReader.open(memoryByteSource(sink.bytes()));
    const first = await reader.readFrame(0);
    first.frame.raw.fill(0);
    first.frame.uncertain?.fill(1);
    expect(
      maxError((await reader.readFrame(0)).frame.raw, scene.frames[0] ?? new Uint16Array(0)),
    ).toBeLessThanOrEqual(8);
    for (let f = 1; f < scene.frames.length; f++) {
      const { frame } = await reader.readFrame(f);
      expect(maxError(frame.raw, scene.frames[f] ?? new Uint16Array(0))).toBeLessThanOrEqual(8);
      frame.raw.fill(0);
    }
  });

  it('rejects encoder settings and intervals that would break the guarantee', async () => {
    const scene = staticScene({ width: 16, height: 8, frames: 1 });
    await expect(
      IrvisWriter.create(
        new MemoryByteSink(),
        options(scene, 8, {
          keyframeIntervalMs: Number.NaN,
          flushIntervalMs: -1,
          tuning: { precision: Number.NaN, weight: 2, denseBias: 0 },
        }),
      ),
    ).rejects.toThrow(
      'invalid .irvis options: keyframeIntervalMs must be a positive number or Infinity; flushIntervalMs must be a positive number or Infinity; tuning.precision must be a number from 0 to 1; tuning.weight must be a number from 0 to 1; tuning.denseBias must be a positive number',
    );
  });

  it('does not start a chunk for an equal conversion with its keys in another order or with -0', async () => {
    const scene = staticScene({ width: 16, height: 8, frames: 3 });
    const writer = await IrvisWriter.create(new MemoryByteSink(), options(scene, 8));
    const reordered = { offset: -273.15, scale: 1 / 64, kind: 'linear' } as const;
    await writer.appendFrame(thermalFrame(scene, 0));
    const second = await writer.appendFrame(thermalFrame(scene, 1, { conversion: reordered }));
    expect(second.chunk).toBeNull();
    const zero = { kind: 'linear', scale: 1, offset: 0 } as const;
    const negativeZero = { kind: 'linear', scale: 1, offset: -0 } as const;
    expect(
      (await writer.appendFrame(thermalFrame(scene, 2, { conversion: negativeZero }))).chunk,
    ).toBe('conversion');
    const more = staticScene({ width: 16, height: 8, frames: 3, periodMs: 40 });
    const next = (f: number) => thermalFrame(more, f, { timestamp: 2000 + f * 40 });
    expect((await writer.appendFrame({ ...next(0), conversion: zero })).chunk).toBeNull();
    expect((await writer.appendFrame({ ...next(1), conversion: negativeZero })).chunk).toBeNull();
    await writer.close();
  });
});

describe('irvis writer input', () => {
  it('rejects a conversion or camera state that JSON cannot hold, and stays usable', async () => {
    const scene = staticScene({ width: 16, height: 8, frames: 3 });
    const sink = new MemoryByteSink();
    const writer = await IrvisWriter.create(sink, options(scene, 8));
    await writer.appendFrame(thermalFrame(scene, 0));
    await expect(
      writer.appendFrame(
        thermalFrame(scene, 1, { conversion: { kind: 'linear', scale: Number.NaN, offset: 0 } }),
      ),
    ).rejects.toThrow('frame conversion has a number that is not finite');
    await expect(
      writer.appendFrame(
        thermalFrame(scene, 1, {
          cameraState: { origin: 'camera', values: { distance: Number.POSITIVE_INFINITY } },
        }),
      ),
    ).rejects.toThrow("camera state value 'distance' is not a finite number");
    await writer.appendFrame(thermalFrame(scene, 2));
    await writer.close();
    const reader = await IrvisReader.open(memoryByteSource(sink.bytes()));
    expect(reader.frameCount).toBe(2);
    expect(reader.damage).toBeNull();
  });

  it('accepts a repeated timestamp that the stored previous one rounds above', async () => {
    const scene = staticScene({ width: 16, height: 8, frames: 3 });
    const sink = new MemoryByteSink();
    const writer = await IrvisWriter.create(sink, options(scene, 8));
    await writer.appendFrame(thermalFrame(scene, 0, { timestamp: 1000 }));
    const first = await writer.appendFrame(thermalFrame(scene, 1, { timestamp: 1000.0006 }));
    expect(first.timestamp).toBe(1000.001);
    const again = await writer.appendFrame(thermalFrame(scene, 2, { timestamp: 1000.0006 }));
    expect(again.timestamp).toBe(1000.001);
    await writer.close();
    const reader = await IrvisReader.open(memoryByteSource(sink.bytes()));
    expect(reader.frames.map((f) => f.timestamp)).toEqual([1000, 1000.001, 1000.001]);
  });
});

describe('reencodeIrvis', () => {
  it('keeps every value within the new threshold of the measured one', async () => {
    const scene = nucScene(20, 3, 300, small);
    const original = await record(scene, 4, { keyframeIntervalMs: 800 });
    const sink = new MemoryByteSink();
    const result = await reencodeIrvis(memoryByteSource(original.bytes), sink, 16);
    expect(result.frames).toBe(60);
    expect(result.damage).toBeNull();
    expect(sink.size).toBeLessThan(original.bytes.length);

    const before = await IrvisReader.open(memoryByteSource(original.bytes));
    const after = await IrvisReader.open(memoryByteSource(sink.bytes()));
    expect(after.header.threshold).toBe(16);
    expect(after.header.thresholdHistory).toEqual([4]);
    expect(after.frames.map((f) => [f.timestamp, f.keyframe])).toEqual(
      before.frames.map((f) => [f.timestamp, f.keyframe]),
    );
    const decoded = await readAll(after);
    scene.frames.forEach((raw, f) => {
      expect(maxError(raw, decoded[f] ?? new Uint16Array(0))).toBeLessThanOrEqual(16);
    });
    for (let f = 0; f < after.frameCount; f++) {
      if (after.frames[f]?.keyframe) {
        expect((await after.readFrame(f)).chunk.reason).toBe(
          (await before.readFrame(f)).chunk.reason,
        );
      }
    }

    const again = new MemoryByteSink();
    await reencodeIrvis(memoryByteSource(sink.bytes()), again, 20);
    const twice = await IrvisReader.open(memoryByteSource(again.bytes()));
    expect(twice.header.thresholdHistory).toEqual([4, 16]);
    const decodedTwice = await readAll(twice);
    scene.frames.forEach((raw, f) => {
      expect(maxError(raw, decodedTwice[f] ?? new Uint16Array(0))).toBeLessThanOrEqual(20);
    });
  });

  it('refuses a smaller threshold', async () => {
    const scene = staticScene({ width: 16, height: 8, frames: 2 });
    const { bytes } = await record(scene, 8);
    await expect(reencodeIrvis(memoryByteSource(bytes), new MemoryByteSink(), 4)).rejects.toThrow(
      "cannot re-encode to threshold 4: it must be an integer of at least the file's 8",
    );
  });

  it('skips the rest of a damaged chunk when the index is intact', async () => {
    const scene = movingHandScene(small);
    // A keyframe every 10 frames: six chunks.
    const { bytes } = await record(scene, 8, { keyframeIntervalMs: 400 });
    const full = await IrvisReader.open(memoryByteSource(bytes));
    expect(full.chunkCount).toBe(6);
    const target = full.frames[15]?.offset ?? 0;
    const damaged = bytes.slice();
    damaged[target + 12] = (damaged[target + 12] ?? 0) ^ 0xff;
    const sink = new MemoryByteSink();
    const result = await reencodeIrvis(memoryByteSource(damaged), sink, 8);
    expect(result.frames).toBe(55);
    expect(result.skipped).toBe(5);
    expect(result.damage).toEqual({
      offset: target,
      reason: `frame 15 at byte ${String(target)} is damaged: CRC-32 mismatch`,
    });
    const copy = await IrvisReader.open(memoryByteSource(sink.bytes()));
    expect(copy.indexed).toBe(true);
    expect(copy.frames.map((f) => f.timestamp)).toEqual(
      full.frames.filter((_, f) => f < 15 || f >= 20).map((f) => f.timestamp),
    );
    const decoded = await readAll(copy);
    const kept = scene.frames.filter((_, f) => f < 15 || f >= 20);
    decoded.forEach((raw, f) => {
      expect(maxError(raw, kept[f] ?? new Uint16Array(0))).toBeLessThanOrEqual(8);
    });
  });

  it('copies a damaged file up to its last valid record', async () => {
    const scene = movingHandScene(small);
    const { bytes } = await record(scene, 8);
    const full = await IrvisReader.open(memoryByteSource(bytes));
    const cut = (full.frames[40]?.offset ?? 0) + 20;
    const sink = new MemoryByteSink();
    const result = await reencodeIrvis(memoryByteSource(bytes.subarray(0, cut)), sink, 8);
    expect(result.frames).toBe(40);
    expect(result.damage).toEqual({
      offset: full.frames[40]?.offset,
      reason: 'the file ends inside a record',
    });
    const copy = await IrvisReader.open(memoryByteSource(sink.bytes()));
    expect(copy.indexed).toBe(true);
    expect(copy.frameCount).toBe(40);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { cameraProfiles, IrvisReader, memoryByteSource } from '@irvis/core';
import { createRecorder, fileByteSource } from '../src/index.ts';
describe('recorder', () => {
  it('bounds pending work and preserves lossless frame values and timestamps', async () => {
    const profile = cameraProfiles[0]!;
    const chunks: Uint8Array[] = [];
    let release: (() => void) | undefined;
    let delay = false;
    const sink = {
      append: async (b: Uint8Array) => {
        if (delay)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        chunks.push(b.slice());
      },
      flush: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const recorder = await createRecorder(
      sink,
      { profile, width: 1, height: 1, fps: 25, threshold: 0, path: 'exact' },
      vi.fn(),
    );
    const frame = {
      width: 1,
      height: 1,
      raw: new Uint16Array([19000]),
      uncertain: null,
      timestamp: 200,
      conversion: profile.conversions[0]!.conversion,
      cameraState: { origin: 'assumed' as const, values: {} },
    };
    delay = true;
    expect(recorder.append(frame)).toBe(true);
    frame.raw[0] = 0;
    expect(recorder.append(frame)).toBe(false);
    delay = false;
    release?.();
    await recorder.stop();
    const bytes = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    const reader = await IrvisReader.open(memoryByteSource(bytes));
    expect(reader.frames).toHaveLength(1);
    expect((await reader.readFrame(0)).frame.raw[0]).toBe(19000);
    expect(reader.frames[0]!.timestamp).toBe(200);
  });
  it('reports write failure and rejects finalization while closing storage', async () => {
    const profile = cameraProfiles[0]!;
    let fail = false;
    const sink = {
      append: () => (fail ? Promise.reject(new Error('Disk full')) : Promise.resolve()),
      flush: () => Promise.resolve(),
      close: vi.fn(() => Promise.resolve()),
    };
    const onError = vi.fn();
    const recorder = await createRecorder(
      sink,
      { profile, width: 1, height: 1, fps: 25, threshold: 0, path: 'exact' },
      onError,
    );
    fail = true;
    recorder.append({
      width: 1,
      height: 1,
      raw: new Uint16Array([19000]),
      uncertain: null,
      timestamp: 0,
      conversion: profile.conversions[0]!.conversion,
      cameraState: { origin: 'assumed', values: {} },
    });
    await expect(recorder.stop()).rejects.toThrow('Disk full');
    expect(onError).toHaveBeenCalledOnce();
    expect(sink.close).toHaveBeenCalled();
  });
  it('recovers the last durable frame when a crash discards the next unflushed write', async () => {
    const profile = cameraProfiles[0]!;
    let bytes = new Uint8Array(0);
    let durable = bytes;
    let stall = false;
    let release: (() => void) | undefined;
    const sink = {
      async append(chunk: Uint8Array) {
        bytes = new Uint8Array([...bytes, ...chunk]);
        if (stall)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      },
      flush: () => {
        durable = bytes.slice();
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    };
    const recorder = await createRecorder(
      sink,
      { profile, width: 1, height: 1, fps: 25, threshold: 0, path: 'exact' },
      vi.fn(),
    );
    const frame = {
      width: 1,
      height: 1,
      raw: new Uint16Array([19000]),
      uncertain: null,
      timestamp: 0,
      conversion: profile.conversions[0]!.conversion,
      cameraState: { origin: 'assumed' as const, values: {} },
    };
    recorder.append(frame);
    await vi.waitFor(async () =>
      expect((await IrvisReader.open(memoryByteSource(durable))).frames).toHaveLength(1),
    );
    stall = true;
    expect(recorder.append({ ...frame, timestamp: 40 })).toBe(true);
    expect(recorder.append({ ...frame, timestamp: 80 })).toBe(false);
    const recovered = await IrvisReader.open(memoryByteSource(durable));
    expect(recovered.frames).toHaveLength(1);
    expect(recovered.indexed).toBe(false);
    expect((await recovered.readFrame(0)).frame.raw[0]).toBe(19000);
    stall = false;
    release?.();
    await recorder.stop();
  });
  it('stops accepting frames after one second of stalled storage', async () => {
    vi.useFakeTimers();
    try {
      const profile = cameraProfiles[0]!;
      let stall = false;
      let release: (() => void) | undefined;
      const error = vi.fn();
      const recorder = await createRecorder(
        {
          append: () =>
            stall
              ? new Promise<void>((resolve) => {
                  release = resolve;
                })
              : Promise.resolve(),
          flush: () => Promise.resolve(),
          close: () => Promise.resolve(),
        },
        { profile, width: 1, height: 1, fps: 25, threshold: 0, path: 'exact' },
        error,
      );
      const frame = {
        width: 1,
        height: 1,
        raw: new Uint16Array([19000]),
        uncertain: null,
        timestamp: 0,
        conversion: profile.conversions[0]!.conversion,
        cameraState: { origin: 'assumed' as const, values: {} },
      };
      stall = true;
      recorder.append(frame);
      await vi.advanceTimersByTimeAsync(1000);
      expect(error).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: 'Recording storage is too slow; recording stopped.' }),
      );
      expect(recorder.append(frame)).toBe(false);
      stall = false;
      release?.();
      await expect(recorder.stop()).rejects.toThrow('too slow');
    } finally {
      vi.useRealTimers();
    }
  });
  it('reads bounded slices from picked files', async () => {
    const source = fileByteSource(new Blob([new Uint8Array([1, 2, 3])]));
    expect(await source.size()).toBe(3);
    expect(await source.read(2, 10)).toEqual(new Uint8Array([3]));
    await expect(source.read(-1, 3)).rejects.toThrow('Invalid byte range.');
  });
});

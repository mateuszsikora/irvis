import { describe, it, expect, vi } from 'vitest';
import { createDesktopRecordingStorage, type DesktopBridge } from '@irvis/backend-electron';
describe('desktop recording storage', () => {
  it('splits large appends and rejects overlapping calls instead of queueing them', async () => {
    let release: (() => void) | undefined;
    const sizes: number[] = [];
    const call = vi.fn((op: string, _name?: string, bytes?: Uint8Array) => {
      if (op === 'append') {
        sizes.push(bytes!.length);
        if (sizes.length === 1)
          return new Promise<void>((resolve) => {
            release = resolve;
          });
      }
      return Promise.resolve();
    });
    const bridge: DesktopBridge = {
      recordingStorage: call,
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
    };
    const sink = await createDesktopRecordingStorage(bridge).create('test.irvis');
    const pending = sink.append(new Uint8Array(4 * 1024 * 1024 + 7));
    await expect(sink.append(new Uint8Array(1))).rejects.toThrow('Recording is closed or busy.');
    release!();
    await pending;
    expect(sizes).toEqual([4 * 1024 * 1024, 7]);
    await sink.close();
    await sink.close();
    expect(call.mock.calls.filter(([op]) => op === 'close')).toHaveLength(1);
  });
});

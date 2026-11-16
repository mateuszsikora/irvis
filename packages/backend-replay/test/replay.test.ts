import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraProfiles, type RawFrame } from '@irvis/core';
import { createReplayBackend } from '../src/index.ts';
afterEach(() => vi.useRealTimers());
describe('replay', () => {
  it('emits synthetic frames and closes idempotently', async () => {
    vi.useFakeTimers();
    const backend = createReplayBackend();
    const profile = cameraProfiles[0]!;
    const session = await backend.open({
      deviceId: 'demo',
      profile,
      modeId: profile.videoModes[0]!.id,
    });
    const listener = vi.fn<(frame: RawFrame) => void>();
    session.frames.subscribe(listener);
    vi.advanceTimersByTime(100);
    expect(listener).toHaveBeenCalled();
    const first = listener.mock.calls[0]![0];
    if (first.kind !== 'thermal') throw new Error('Expected thermal frame');
    expect(first.frame.raw.length).toBe(profile.sensor.width * profile.sensor.height);
    await session.close();
    await session.close();
    listener.mockClear();
    vi.advanceTimersByTime(100);
    expect(listener).not.toHaveBeenCalled();
  });
  it('loops fixtures and unsubscribes listeners', async () => {
    vi.useFakeTimers();
    const profile = cameraProfiles[0]!;
    const frame = {
      width: 1,
      height: 1,
      raw: new Uint16Array([123]),
      uncertain: null,
      timestamp: 0,
      conversion: profile.conversions[0]!.conversion,
      cameraState: { origin: 'assumed' as const, values: {} },
    };
    const session = await createReplayBackend([frame]).open({
      deviceId: 'demo',
      profile,
      modeId: profile.videoModes[0]!.id,
    });
    const listener = vi.fn<(frame: RawFrame) => void>();
    const unsubscribe = session.frames.subscribe(listener);
    vi.advanceTimersByTime(100);
    expect(listener.mock.calls[0]![0]).toEqual({ kind: 'thermal', frame });
    unsubscribe();
    listener.mockClear();
    vi.advanceTimersByTime(100);
    expect(listener).not.toHaveBeenCalled();
    await session.close();
  });
});

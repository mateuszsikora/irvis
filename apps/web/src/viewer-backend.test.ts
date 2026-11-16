import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraProfiles } from '@irvis/core';
import { liveBackend } from './viewer-backend.ts';
import { startDiagnostics } from '@irvis/backend-browser';
vi.mock('@irvis/backend-browser', () => ({ startDiagnostics: vi.fn() }));
afterEach(() => {
  delete window.irvisDesktop;
  vi.clearAllMocks();
});
describe('viewer backend', () => {
  it('selects Electron from preload and releases the bridge once', async () => {
    const stop = vi.fn(() => Promise.resolve());
    const unsubscribe = vi.fn();
    const command = vi.fn(() => Promise.resolve());
    const listDevices = vi.fn(() => Promise.resolve([{ id: '/dev/video3', label: 'Thermal' }]));
    window.irvisDesktop = {
      command,
      listDevices,
      start: vi.fn(() => Promise.resolve()),
      stop,
      subscribe: vi.fn(() => unsubscribe),
    };
    const backend = liveBackend(vi.fn());
    expect(backend.id).toBe('electron');
    expect(backend.capabilities.exactRaw).toBe(true);
    expect(backend.capabilities.deviceControl).toBe(true);
    expect(await backend.listDevices()).toEqual([{ id: '/dev/video3', label: 'Thermal' }]);
    const profile = cameraProfiles[0]!;
    const session = await backend.open({
      deviceId: '0',
      profile,
      modeId: profile.videoModes[0]!.id,
    });
    await session.command?.('gain-high');
    expect(command).toHaveBeenCalledWith('gain-high');
    await session.close();
    await expect(session.command?.('gain-high')).rejects.toThrow('Camera session is closed');
    await session.close();
    expect(stop).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('selects browser without preload and forwards frames', async () => {
    const stop = vi.fn();
    vi.mocked(startDiagnostics).mockReturnValue(stop);
    const backend = liveBackend(vi.fn());
    expect(backend.id).toBe('browser');
    const profile = cameraProfiles[0]!;
    const session = await backend.open({
      deviceId: 'default',
      profile,
      modeId: profile.videoModes[0]!.id,
    });
    const listener = vi.fn();
    session.frames.subscribe(listener);
    const callbacks = vi.mocked(startDiagnostics).mock.calls[0]![2];
    const frame = {
      kind: 'yuv420' as const,
      layout: 'i420' as const,
      width: 2,
      height: 2,
      timestamp: 0,
      data: new Uint8Array(6),
      planes: [],
    };
    callbacks.result({ frame } as unknown as Parameters<typeof callbacks.result>[0]);
    expect(listener).toHaveBeenCalledWith(frame);
    await session.close();
    expect(stop).toHaveBeenCalledOnce();
    callbacks.result({ frame } as unknown as Parameters<typeof callbacks.result>[0]);
    expect(listener).toHaveBeenCalledOnce();
  });
  it('isolates capture ownership across adapter instances and drops obsolete errors', async () => {
    let finish!: () => void;
    const start = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const stop = vi.fn(() => Promise.resolve());
    const callbacks: Array<(message: string) => void> = [];
    window.irvisDesktop = {
      start,
      stop,
      subscribe: (_frame, error) => {
        callbacks.push(error);
        return () => {};
      },
    };
    const firstError = vi.fn(),
      nextError = vi.fn();
    const profile = cameraProfiles[0]!;
    const request = { deviceId: '0', profile, modeId: profile.videoModes[0]!.id };
    const pending = liveBackend(firstError).open(request);
    const next = await liveBackend(nextError).open(request);
    finish();
    const first = await pending;
    callbacks[0]!('Old error');
    expect(firstError).toHaveBeenCalledOnce();
    expect(firstError).toHaveBeenCalledWith('');
    await first.close();
    expect(stop).not.toHaveBeenCalled();
    callbacks[1]!('Current error');
    expect(nextError).toHaveBeenLastCalledWith('Current error');
    await next.close();
    expect(stop).toHaveBeenCalledOnce();
  });
});

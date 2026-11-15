import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraProfiles } from '@irvis/core';
import { startDiagnostics } from '@irvis/backend-browser';
const mode = cameraProfiles[0]!.videoModes.find((m) => m.layout)!;
const callbacks = () => ({ metadata: vi.fn(), result: vi.fn(), error: vi.fn() });
let workerProcessor = true;
class FakeWorker {
  static last: FakeWorker;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.last = this;
    queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', processor: workerProcessor } }));
  }
}
function setup() {
  workerProcessor = true;
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('MediaStreamTrackProcessor', undefined);
  const track = { stop: vi.fn(), getSettings: () => ({ deviceId: 'chosen' }) };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return { track, stream, getUserMedia };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('browser session', () => {
  it('transfers the track when the processor exists only in the worker', async () => {
    const { track } = setup();
    const cb = callbacks();
    const stop = startDiagnostics(mode, 'chosen', cb);
    await vi.waitFor(() =>
      expect(FakeWorker.last.postMessage).toHaveBeenCalledWith({ type: 'track', track, mode }, [
        track,
      ]),
    );
    stop();
    expect(FakeWorker.last.postMessage).toHaveBeenLastCalledWith({ type: 'stop' });
    expect(FakeWorker.last.terminate).not.toHaveBeenCalled();
    FakeWorker.last.onmessage?.({ data: { type: 'stopped' } });
    expect(track.stop).toHaveBeenCalled();
    expect(FakeWorker.last.terminate).toHaveBeenCalled();
    expect(cb.error).not.toHaveBeenCalled();
  });
  it('stops tracks returned after cancellation during the permission prompt', async () => {
    const { track, stream, getUserMedia } = setup();
    let grant!: (stream: unknown) => void;
    getUserMedia.mockReturnValue(
      new Promise((resolve) => {
        grant = resolve;
      }),
    );
    const stop = startDiagnostics(mode, '', callbacks());
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    stop();
    grant(stream);
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalled());
    expect(FakeWorker.last.postMessage).not.toHaveBeenCalled();
  });
  it('reports unsupported browsers without requesting camera access', async () => {
    const { getUserMedia } = setup();
    workerProcessor = false;
    const cb = callbacks();
    startDiagnostics(mode, '', cb);
    await vi.waitFor(() => expect(cb.error).toHaveBeenCalledWith('use Chrome, Edge or Safari'));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(FakeWorker.last.terminate).toHaveBeenCalled();
  });
});

describe('main-thread capture', () => {
  function main(copyTo = vi.fn(() => Promise.resolve([{ offset: 0, stride: mode.width }]))) {
    const state = setup();
    const frame = {
      format: 'NV12',
      codedWidth: mode.width,
      codedHeight: mode.height,
      visibleRect: null,
      colorSpace: { toJSON: () => ({}) },
      timestamp: 1000,
      allocationSize: () => 24,
      copyTo,
      close: vi.fn(),
    };
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ value: frame, done: false })
        .mockResolvedValue({ done: true }),
      cancel: vi.fn(() => Promise.resolve()),
      releaseLock: vi.fn(),
    };
    vi.stubGlobal(
      'MediaStreamTrackProcessor',
      class {
        readable = { getReader: () => reader };
      },
    );
    return { ...state, frame, reader };
  }
  it('waits for the worker result before reading again and closes on stream end', async () => {
    const { frame, reader } = main();
    const cb = callbacks();
    startDiagnostics(mode, '', cb);
    await vi.waitFor(() => expect(FakeWorker.last.postMessage).toHaveBeenCalled());
    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(frame.close).not.toHaveBeenCalled();
    const call = FakeWorker.last.postMessage.mock.calls[0] as unknown as [
      { frame: { data: Uint8Array } },
      ArrayBuffer[],
    ];
    expect(call[1]).toEqual([call[0].frame.data.buffer]);
    FakeWorker.last.onmessage?.({ data: { type: 'result', result: {} } });
    await vi.waitFor(() => expect(cb.error).toHaveBeenCalledWith('Camera stream ended.'));
    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalled();
  });
  it('closes a frame when cancelled during copy without sending it', async () => {
    let copied!: (planes: { offset: number; stride: number }[]) => void;
    const copy = vi.fn(
      () =>
        new Promise<{ offset: number; stride: number }[]>((resolve) => {
          copied = resolve;
        }),
    );
    const { frame } = main(copy);
    const stop = startDiagnostics(mode, '', callbacks());
    await vi.waitFor(() => expect(copy).toHaveBeenCalled());
    stop();
    copied([]);
    await vi.waitFor(() => expect(frame.close).toHaveBeenCalledTimes(1));
    expect(FakeWorker.last.postMessage).not.toHaveBeenCalled();
  });
  it('closes a frame and stops capture when copying fails', async () => {
    const { frame, track } = main(vi.fn(() => Promise.reject(new Error('copy failed'))));
    const cb = callbacks();
    startDiagnostics(mode, '', cb);
    await vi.waitFor(() => expect(cb.error).toHaveBeenCalledWith('copy failed'));
    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
  });
});

it('terminates after the shutdown deadline if a worker never acknowledges', async () => {
  setup();
  vi.useFakeTimers();
  const stop = startDiagnostics(mode, '', callbacks());
  await vi.advanceTimersByTimeAsync(0);
  stop();
  expect(FakeWorker.last.terminate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(FakeWorker.last.terminate).toHaveBeenCalledTimes(1);
});
it('cancels the startup timer when stopped before the worker is ready', async () => {
  setup();
  vi.useFakeTimers();
  const cb = callbacks();
  const stop = startDiagnostics(mode, '', cb);
  stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(cb.error).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

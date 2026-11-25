import { afterEach, expect, it, vi } from 'vitest';
import { installWorker, type WorkerScope } from '../src/worker-runtime.ts';
import { cameraProfiles, simulateYUYVtoI420 } from '@irvis/core';
afterEach(() => vi.unstubAllGlobals());
function scope() {
  const postMessage = vi.fn();
  const scope: WorkerScope = { onmessage: () => {}, postMessage };
  installWorker(scope);
  const send = (data: unknown) =>
    scope.onmessage({ data } as Parameters<WorkerScope['onmessage']>[0]);
  return { send, postMessage };
}
const mode = cameraProfiles[0]!.videoModes.find((m) => m.layout)!;
it('stops the transferred track and cancels a blocked read before acknowledging', async () => {
  let end!: (value: { done: boolean }) => void;
  const reader = {
    read: () =>
      new Promise((resolve) => {
        end = resolve;
      }),
    cancel: vi.fn(() => {
      end({ done: true });
      return Promise.resolve();
    }),
    releaseLock: vi.fn(),
  };
  vi.stubGlobal(
    'MediaStreamTrackProcessor',
    class {
      readable = { getReader: () => reader };
    },
  );
  const track = { stop: vi.fn() };
  const { send, postMessage } = scope();
  send({ type: 'track', track, mode });
  send({ type: 'stop' });
  await vi.waitFor(() => expect(postMessage).toHaveBeenLastCalledWith({ type: 'stopped' }));
  expect(track.stop).toHaveBeenCalled();
  expect(reader.cancel).toHaveBeenCalled();
  expect(reader.releaseLock).toHaveBeenCalled();
  expect(postMessage).not.toHaveBeenCalledWith({ type: 'ended' });
});
it('returns the copied buffer and reports reconstruction failures, passing a frame without temperature data through', async () => {
  const smallMode = {
    ...mode,
    width: 2,
    height: 2,
    layout: { thermal: { firstRow: 0, rows: 2, packing: 'u16le' } },
  };
  const frame = simulateYUYVtoI420({
    kind: 'yuyv',
    width: 2,
    height: 2,
    timestamp: 0,
    data: new Uint8Array(8),
  });
  const { send, postMessage } = scope();
  send({ type: 'frame', frame, mode: smallMode, info: {} });
  expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'result' }), [
    frame.data.buffer,
  ]);
  send({ type: 'frame', frame, mode: { ...smallMode, layout: null }, info: {} });
  expect(postMessage).toHaveBeenLastCalledWith(
    { type: 'result', result: { info: {}, frame, reconstructionMs: null, statistics: null } },
    [frame.data.buffer],
  );
  send({
    type: 'frame',
    frame,
    mode: { ...smallMode, layout: { thermal: { firstRow: 0, rows: 4, packing: 'u16le' } } },
    info: {},
  });
  await vi.waitFor(() =>
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'error',
      message: 'reconstruction rows must be positive, pair-aligned and inside the frame',
    }),
  );
});

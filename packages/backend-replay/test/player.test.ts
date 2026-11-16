import { describe, it, expect, vi } from 'vitest';
import { IrvisWriter, memoryByteSource, cameraProfiles, type ThermalFrame } from '@irvis/core';
import { openRecording } from '../src/index.ts';
async function fixture() {
  const chunks: Uint8Array[] = [];
  const profile = cameraProfiles[0]!;
  const writer = await IrvisWriter.create(
    {
      append: (b) => {
        chunks.push(b.slice());
        return Promise.resolve();
      },
      flush: async () => {},
      close: async () => {},
    },
    {
      width: 1,
      height: 1,
      fps: 10,
      profile,
      path: 'exact',
      threshold: 0,
      viewState: { palette: 'iron' },
    },
  );
  for (const timestamp of [5000, 5100, 5400]) {
    if (timestamp === 5100) await writer.appendViewState(timestamp, { palette: 'rainbow' });
    await writer.appendFrame({
      width: 1,
      height: 1,
      raw: new Uint16Array([timestamp]),
      uncertain: null,
      timestamp,
      conversion: profile.conversions[0]!.conversion,
      cameraState: { origin: 'assumed', values: {} },
    });
  }
  await writer.close();
  const bytes = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
describe('recording player', () => {
  it('seeks relative to the first timestamp and restores accumulated view state', async () => {
    const player = await openRecording(memoryByteSource(await fixture()));
    const frame = vi.fn<(f: ThermalFrame) => void>();
    const view = vi.fn();
    player.frames.subscribe(frame);
    player.recordedViewState.subscribe(view);
    expect(player.viewState.getSnapshot().duration).toBe(400);
    player.seek(300);
    await vi.waitFor(() => expect(frame).toHaveBeenCalled());
    expect(frame.mock.lastCall![0].timestamp).toBe(5100);
    expect(view).toHaveBeenLastCalledWith({ palette: 'rainbow' });
    player.seek(-20);
    await vi.waitFor(() => expect(frame.mock.lastCall![0].timestamp).toBe(5000));
    expect(view).toHaveBeenLastCalledWith({ palette: 'iron' });
    expect(() => player.setRate(0)).toThrow();
    expect(() => player.seek(NaN)).toThrow();
    player.close();
  });
  it('suppresses obsolete seeks and all deliveries after close', async () => {
    const bytes = await fixture();
    const player = await openRecording(memoryByteSource(bytes));
    const frame = vi.fn<(f: ThermalFrame) => void>();
    player.frames.subscribe(frame);
    player.seek(400);
    player.seek(0);
    await vi.waitFor(() => expect(frame).toHaveBeenCalledTimes(1));
    expect(frame.mock.lastCall![0].timestamp).toBe(5000);
    player.seek(400);
    player.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frame).toHaveBeenCalledTimes(1);
  });
  it('plays at the selected rate and pauses at the end', async () => {
    const player = await openRecording(memoryByteSource(await fixture()));
    player.setRate(10);
    player.play();
    await vi.waitFor(() => expect(player.viewState.getSnapshot().paused).toBe(true));
    expect(player.viewState.getSnapshot().position).toBe(400);
    player.play();
    player.pause();
    expect(player.viewState.getSnapshot().paused).toBe(true);
    player.close();
  });
});

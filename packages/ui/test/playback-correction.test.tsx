import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cameraProfiles,
  exportSnapshot,
  IrvisReader,
  memoryByteSource,
  type CameraBackend,
  type RecordingPlayer,
  type ViewStateValues,
} from '@irvis/core';
import { Viewer } from '../src/Viewer.tsx';
import type { RecordingControlsProps } from '../src/RecordingControls.tsx';
import type { ViewSettings } from '../src/render.ts';
const controls = vi.hoisted(() => ({ current: null as RecordingControlsProps | null }));
const draw = vi.hoisted(() => vi.fn());
vi.mock('../src/RecordingControls.tsx', () => ({
  RecordingControls: (props: RecordingControlsProps) => {
    controls.current = props;
    return null;
  },
}));
vi.mock('../src/render.ts', () => ({
  FrameRenderer: class {
    draw = draw;
  },
}));
afterEach(() => {
  cleanup();
  draw.mockReset();
  controls.current = null;
});
const profile = cameraProfiles[0]!;
const frame = {
  width: 1,
  height: 1,
  raw: new Uint16Array([30]),
  timestamp: 0,
  conversion: { kind: 'linear' as const, scale: 1, offset: 0 },
  uncertain: null,
  cameraState: { origin: 'assumed' as const, values: {} },
};
const correction = (offsetKelvin: number) => ({
  emissivity: 1,
  offsetKelvin,
  reflectedCelsius: 25,
});
async function player(offset: number | null) {
  const view = offset === null ? {} : { correction: correction(offset) };
  const reader = await IrvisReader.open(
    memoryByteSource(
      await exportSnapshot(frame, { profile, path: 'exact', fps: 1, viewState: view }),
    ),
  );
  const views = new Set<(view: ViewStateValues) => void>();
  const frames = new Set<(value: typeof frame) => void>();
  const result: RecordingPlayer = {
    reader,
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setRate: vi.fn(),
    close: vi.fn(),
    viewState: {
      getSnapshot: () => ({ position: 0, duration: 0, paused: true, rate: 1 }),
      subscribe: () => () => {},
    },
    recordedViewState: {
      subscribe: (listener) => {
        views.add(listener);
        return () => {
          views.delete(listener);
        };
      },
    },
    frames: {
      subscribe: (listener) => {
        frames.add(listener);
        return () => {
          frames.delete(listener);
        };
      },
    },
    errors: { subscribe: () => () => {} },
  };
  return {
    result,
    emit(view?: ViewStateValues) {
      if (view) for (const listener of views) listener(view);
      for (const listener of frames) listener({ ...frame });
    },
  };
}
function setup() {
  const backend: CameraBackend = {
    id: 'replay',
    capabilities: { exactRaw: true, deviceControl: false, concurrentWith: [] },
    listDevices: () => Promise.resolve([]),
    open: () => Promise.reject(new Error('Unused')),
  };
  render(<Viewer device="" modeId="yuyv-256x384" backend={backend} profile={profile} />);
}
async function opened(p: Awaited<ReturnType<typeof player>>) {
  await act(async () => {
    await controls.current!.onPlayback(p.result);
    p.emit();
  });
}
async function expectOffset(offset: number | null) {
  await waitFor(() => {
    const settings = draw.mock.lastCall?.[3] as ViewSettings | undefined;
    expect(settings?.analysis?.correction?.offsetKelvin ?? null).toBe(offset);
    expect(screen.getByLabelText<HTMLInputElement>('Offset (°C)').value).toBe(String(offset ?? 0));
  });
}
describe('playback correction', () => {
  it('restores each recording independently and resets manual overrides on reopen', async () => {
    setup();
    const first = await player(2);
    const second = await player(-3);
    await opened(first);
    await expectOffset(2);
    fireEvent.change(screen.getByLabelText('Offset (°C)'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('Apply correction'));
    await expectOffset(10);
    await opened(second);
    await expectOffset(-3);
    await opened(await player(2));
    await expectOffset(2);
    await opened(await player(null));
    await expectOffset(null);
  });
  it('preserves measurement identities and independent edits across recorded correction changes', async () => {
    setup();
    const recording = await player(0);
    await opened(recording);
    await expectOffset(0);
    fireEvent.click(screen.getByText('Add point'));
    fireEvent.change(screen.getByLabelText('x (%)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('High threshold (°C)'), { target: { value: '47' } });
    act(() => recording.emit({ correction: correction(5) }));
    await expectOffset(5);
    expect(screen.getByLabelText<HTMLInputElement>('High threshold (°C)').value).toBe('47');
    fireEvent.click(screen.getByText('Add point'));
    fireEvent.change(screen.getByLabelText('x (%)'), { target: { value: '80' } });
    const objects = () => (draw.mock.lastCall?.[3] as ViewSettings | undefined)?.analysis?.objects;
    await waitFor(() =>
      expect(objects()?.map(({ id, x }) => ({ id, x }))).toEqual([
        { id: 1, x: 10 },
        { id: 2, x: 80 },
      ]),
    );
    fireEvent.click(screen.getByText('Delete selected'));
    await waitFor(() =>
      expect(objects()?.map(({ id, x }) => ({ id, x }))).toEqual([{ id: 1, x: 10 }]),
    );
    act(() => recording.emit({ correction: correction(0) }));
    await expectOffset(0);
    fireEvent.click(screen.getByText('Add line'));
    await waitFor(() =>
      expect(objects()?.map(({ id, kind }) => ({ id, kind }))).toEqual([
        { id: 1, kind: 'Point' },
        { id: 3, kind: 'Line' },
      ]),
    );
    fireEvent.change(screen.getByLabelText('Selected object'), { target: { value: '1' } });
    expect(screen.getByLabelText<HTMLInputElement>('x (%)').value).toBe('10');
  });
  it('follows recorded changes and seeks until an explicit correction edit, ignoring obsolete players', async () => {
    setup();
    const first = await player(1);
    await opened(first);
    await expectOffset(1);
    act(() => first.emit({ correction: correction(4) }));
    await expectOffset(4);
    act(() => first.emit({ correction: correction(1) }));
    await expectOffset(1);
    fireEvent.change(screen.getByLabelText('Offset (°C)'), { target: { value: '7' } });
    fireEvent.click(screen.getByText('Apply correction'));
    await expectOffset(7);
    act(() => first.emit({ correction: correction(4) }));
    await expectOffset(7);
    const second = await player(-2);
    await opened(second);
    await expectOffset(-2);
    act(() => first.emit({ correction: correction(9) }));
    await expectOffset(-2);
  });
});

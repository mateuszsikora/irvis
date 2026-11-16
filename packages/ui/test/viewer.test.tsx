import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraProfiles, type CameraBackend, type CameraSession, type RawFrame } from '@irvis/core';
import { Viewer } from '../src/index.ts';
const draw = vi.hoisted(() => vi.fn());
vi.mock('../src/render.ts', () => ({
  FrameRenderer: class {
    draw = draw;
  },
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  draw.mockClear();
});
const profile = cameraProfiles[0]!;
function backend(): CameraBackend {
  return {
    id: 'browser',
    capabilities: { exactRaw: false, deviceControl: false, concurrentWith: [] },
    listDevices: () => Promise.resolve([{ id: 'cam', label: 'Camera' }]),
    open: vi.fn(),
  };
}
describe('Viewer', () => {
  it('offers six palettes and rejects reversed manual bounds', () => {
    render(<Viewer profile={profile} backend={backend()} />);
    expect(screen.getByRole('group', { name: 'Palette' }).querySelectorAll('button')).toHaveLength(
      6,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }));
    fireEvent.change(screen.getByLabelText('Lower bound (°C)'), { target: { value: '50' } });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply bounds' }).disabled).toBe(
      true,
    );
    expect(screen.getByRole('alert').textContent).toContain('Lower bound must be below');
  });
  it('declares camera state without sending a command and locks orientation', () => {
    const source = backend();
    render(<Viewer profile={profile} backend={source} />);
    expect(screen.getByText('camera mode unknown, readings assume high gain')).toBeTruthy();
    fireEvent.click(screen.getByText('Confirm camera mode and factory settings'));
    expect(screen.getByText('Camera mode declared by user.')).toBeTruthy();
    expect(vi.mocked(source).open.mock.calls).toHaveLength(0);
    fireEvent.click(screen.getByLabelText('Lock orientation'));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '90°' }).disabled).toBe(true);
    fireEvent.click(screen.getByText('Camera commands'));
    for (const c of profile.commands)
      expect(screen.getByRole<HTMLButtonElement>('button', { name: c.label }).disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Download desktop app' })).toBeTruthy();
  });
  it('closes an open that resolves after unmount', async () => {
    const source = backend();
    let resolve!: (s: CameraSession) => void;
    source.open = () =>
      new Promise((r) => {
        resolve = r;
      });
    const view = render(<Viewer profile={profile} backend={source} />);
    await waitFor(() => expect(screen.getByText<HTMLButtonElement>('Start').disabled).toBe(false));
    fireEvent.click(screen.getByText('Start'));
    view.unmount();
    const close = vi.fn(async () => {});
    resolve({ close } as unknown as CameraSession);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
  it('redraws the retained frame when settings change after Stop', async () => {
    vi.useFakeTimers();
    let emit!: (frame: RawFrame) => void;
    const unsubscribe = vi.fn();
    const source = backend();
    source.open = () =>
      Promise.resolve({
        device: { id: 'cam', label: 'Camera' },
        profile,
        mode: profile.videoModes[0]!,
        frames: {
          subscribe: (listener) => {
            emit = listener;
            return unsubscribe;
          },
        },
        close: () => Promise.resolve(),
      });
    render(<Viewer profile={profile} backend={source} />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
      await Promise.resolve();
    });
    act(() => {
      emit({
        kind: 'thermal',
        frame: {
          width: 1,
          height: 1,
          timestamp: 0,
          raw: new Uint16Array([18500]),
          conversion: profile.conversions[0]!.conversion,
          cameraState: { origin: 'assumed', values: {} },
          uncertain: null,
        },
      });
      vi.advanceTimersByTime(20);
    });
    expect(draw).toHaveBeenCalledOnce();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
      await Promise.resolve();
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Rainbow' }));
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(draw).toHaveBeenLastCalledWith(
      expect.anything(),
      profile,
      profile.videoModes[0],
      expect.objectContaining({ palette: 'rainbow' }),
    );
  });
});

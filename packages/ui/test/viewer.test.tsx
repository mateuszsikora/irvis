import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cameraProfiles,
  exportPng,
  findVideoMode,
  type CameraBackend,
  type VideoMode,
  type CameraSession,
  type RawFrame,
} from '@irvis/core';
import { Viewer } from '../src/index.ts';
const draw = vi.hoisted(() => vi.fn());
const alarmCallback = vi.hoisted(() => ({
  current: (_active: boolean) => {
    void _active;
  },
}));
vi.mock('../src/render.ts', () => ({
  FrameRenderer: class {
    draw = draw;
    constructor(
      _canvas: unknown,
      _scale: unknown,
      _bounds: unknown,
      _warning: unknown,
      _readouts: unknown,
      onAlarm: (active: boolean) => void,
    ) {
      alarmCallback.current = onAlarm;
    }
  },
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  draw.mockClear();
  vi.unstubAllGlobals();
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
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={backend()} />);
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
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={source} />);
    expect(screen.getByText('camera mode unknown, readings assume high gain')).toBeTruthy();
    fireEvent.click(screen.getByText('Confirm camera mode and factory settings'));
    expect(screen.getByText('Camera mode declared by user.')).toBeTruthy();
    expect(vi.mocked(source).open.mock.calls).toHaveLength(0);
    fireEvent.click(screen.getByLabelText('Lock orientation'));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '90°' }).disabled).toBe(true);
    fireEvent.click(screen.getByText('Camera commands'));
    for (const c of profile.commands)
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: c.parameter ? 'Apply ' + c.label.toLowerCase() : c.label,
        }).disabled,
      ).toBe(true);
    expect(screen.getByRole('link', { name: 'Download desktop app' })).toBeTruthy();
  });
  function controlledBackend(command: (id: string) => Promise<void>): CameraBackend {
    return {
      ...backend(),
      id: 'electron',
      capabilities: { exactRaw: true, deviceControl: true, concurrentWith: [] },
      open: () =>
        Promise.resolve({
          device: { id: 'cam', label: 'Camera' },
          profile,
          mode: profile.videoModes[0]!,
          frames: { subscribe: () => () => {} },
          command,
          close: async () => {},
        }),
    };
  }
  async function startCamera() {
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'High gain', hidden: true }).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByText('Camera commands'));
  }
  function commandStatus() {
    return screen.getByText('Camera commands').parentElement!.querySelector('[role="status"]')!;
  }
  it('clears camera command confirmation on Stop and Start', async () => {
    const command = vi.fn(async () => {});
    render(
      <Viewer
        device="cam"
        modeId="yuyv-256x384"
        profile={profile}
        backend={controlledBackend(command)}
      />,
    );
    await startCamera();
    fireEvent.click(screen.getByRole('button', { name: 'High gain' }));
    await waitFor(() => expect(commandStatus().textContent).toBe('Camera command confirmed.'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(commandStatus().textContent).toBe('');
    await startCamera();
    expect(commandStatus().textContent).toBe('');
    expect(command).toHaveBeenCalledTimes(1);
  });
  it('ignores an old command failure while a new session waits for confirmation', async () => {
    let rejectOld!: (error: Error) => void;
    let finishNew!: () => void;
    const command = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectOld = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishNew = resolve;
          }),
      );
    render(
      <Viewer
        device="cam"
        modeId="yuyv-256x384"
        profile={profile}
        backend={controlledBackend(command)}
      />,
    );
    await startCamera();
    fireEvent.click(screen.getByRole('button', { name: 'High gain' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await startCamera();
    fireEvent.click(screen.getByRole('button', { name: 'Low gain' }));
    await act(async () => {
      rejectOld(new Error('Old camera disconnected'));
      await Promise.resolve();
    });
    expect(commandStatus().textContent).toBe('Waiting for camera confirmation…');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'High gain' }).disabled).toBe(
      true,
    );
    await act(async () => {
      finishNew();
      await Promise.resolve();
    });
    expect(commandStatus().textContent).toBe('Camera command confirmed.');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'High gain' }).disabled).toBe(
      false,
    );
  });
  it('closes an open that resolves after unmount', async () => {
    const source = backend();
    let resolve!: (s: CameraSession) => void;
    source.open = () =>
      new Promise((r) => {
        resolve = r;
      });
    const view = render(
      <Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={source} />,
    );
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
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={source} />);
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

describe('image-only view', () => {
  function imageBackend(
    mode: VideoMode,
  ): CameraBackend & { emit: (frame: RawFrame) => void; subscribed: () => boolean } {
    let listener: ((frame: RawFrame) => void) | undefined;
    return {
      ...backend(),
      id: 'electron',
      capabilities: { exactRaw: true, deviceControl: true, concurrentWith: [] },
      emit: (frame) => listener?.(frame),
      subscribed: () => listener !== undefined,
      open: () =>
        Promise.resolve({
          device: { id: 'cam', label: 'Camera' },
          profile,
          mode,
          frames: {
            subscribe: (next) => {
              listener = next;
              return () => {};
            },
          },
          command: () => Promise.resolve(),
          close: async () => {},
        }),
    };
  }
  it('shows a mode without temperature data with orientation only, and no temperature tools', async () => {
    const mode = findVideoMode(profile, 'image-1280x720@30')!;
    const live = imageBackend(mode);
    const { container } = render(
      <Viewer device="cam" modeId={mode.id} profile={profile} backend={live} />,
    );
    const group = (name: string) => container.querySelector(`[aria-label="${name}"]`);
    expect(container.querySelector('.preview-meta')?.textContent).toContain(
      'IMAGE ONLY/1280 × 720',
    );
    expect(
      screen.getByText(
        'This video mode has no temperature data: Start shows the camera’s image only.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Image only', { selector: 'h3' })).toBeTruthy();
    expect(group('Palette')).toBeNull();
    expect(group('Range mode')).toBeNull();
    expect(screen.queryByText('Camera commands')).toBeNull();
    expect(group('Rotation')).not.toBeNull();
    expect(group('Tracking shortcuts')).toBeNull();
    expect(screen.queryByText('Uncertain pixels')).toBeNull();
    expect(screen.queryByText('Alarm disabled')).toBeNull();
    expect(group('Measurement readings')?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('.scale-strip')?.hasAttribute('hidden')).toBe(true);
    fireEvent.click(screen.getByText('Start', { selector: 'button' }));
    const frame: RawFrame = {
      kind: 'yuyv',
      width: 1280,
      height: 720,
      data: new Uint8Array(1280 * 720 * 2),
      timestamp: 0,
    };
    // The viewer subscribes in an effect after the render that shows the session.
    await waitFor(() => expect(live.subscribed()).toBe(true));
    act(() => live.emit(frame));
    await waitFor(() => expect(draw).toHaveBeenCalledWith(frame, profile, mode, expect.anything()));
    expect(screen.getByText('Capture photo', { selector: 'button' }).hasAttribute('disabled')).toBe(
      true,
    );
  });
  it("keeps the camera commands for the profile's own image-only mode", () => {
    const mode = profile.videoModes.find((m) => m.layout === null)!;
    render(<Viewer device="cam" modeId={mode.id} profile={profile} backend={imageBackend(mode)} />);
    expect(screen.getByText('Image only', { selector: 'h3' })).toBeTruthy();
    expect(screen.getByText('Camera commands')).toBeTruthy();
  });
});

describe('measurement controls', () => {
  it('keeps three of each object, edits and deletes objects, and preserves tracking on clear', () => {
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={backend()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Track min' }));
    for (const kind of ['point', 'line', 'area'])
      for (let i = 0; i < 3; i++) fireEvent.click(screen.getByText(`Add ${kind}`));
    const selector = screen.getByLabelText<HTMLSelectElement>('Selected object');
    expect(selector.options).toHaveLength(10);
    fireEvent.change(screen.getByLabelText('x (%)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('x2 (%)'), { target: { value: '90' } });
    expect(screen.getByLabelText<HTMLInputElement>('x (%)').value).toBe('10');
    expect(screen.getByLabelText<HTMLInputElement>('x2 (%)').value).toBe('90');
    fireEvent.click(screen.getByText('Delete selected'));
    expect(selector.options).toHaveLength(9);
    fireEvent.click(screen.getByText('Clear measurements'));
    expect(selector.options).toHaveLength(1);
    expect(screen.getByText('Track min').getAttribute('aria-pressed')).toBe('true');
  });
  it('converts committed thresholds between units and validates correction edits', () => {
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={backend()} />);
    fireEvent.change(screen.getByLabelText('High threshold (°C)'), { target: { value: '-10.5' } });
    fireEvent.click(screen.getByText('Apply threshold'));
    fireEvent.change(screen.getByLabelText('Temperature unit'), { target: { value: 'F' } });
    expect(screen.getByLabelText<HTMLInputElement>('High threshold (°F)').value).toBe('13.1');
    fireEvent.change(screen.getByLabelText('Temperature unit'), { target: { value: 'K' } });
    expect(screen.getByLabelText<HTMLInputElement>('High threshold (K)').value).toBe('262.6');
    fireEvent.change(screen.getByLabelText('Emissivity'), { target: { value: '0' } });
    expect(screen.getByText<HTMLButtonElement>('Apply correction').disabled).toBe(true);
    fireEvent.click(screen.getByText('Reset parameters'));
    expect(screen.getByLabelText<HTMLInputElement>('Emissivity').value).toBe('1');
    expect(screen.getByLabelText<HTMLInputElement>('Reflected temperature (°C)').value).toBe('25');
    expect(screen.getByLabelText<HTMLInputElement>('Ambient temperature (°C)').disabled).toBe(true);
  });
  it('silences a triggered alarm immediately when disabled', async () => {
    const start = vi.fn(),
      stop = vi.fn();
    vi.stubGlobal(
      'AudioContext',
      class {
        destination = {};
        resume = () => Promise.resolve();
        close = () => Promise.resolve();
        createOscillator = () => ({ connect: vi.fn(), disconnect: vi.fn(), start, stop });
        createGain = () => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() });
      },
    );
    const source = backend();
    source.open = () =>
      Promise.resolve({
        mode: profile.videoModes[0]!,
        frames: {
          subscribe: (listener: (frame: RawFrame) => void) => {
            listener({
              kind: 'thermal',
              frame: {
                width: 1,
                height: 1,
                timestamp: 0,
                raw: new Uint16Array([50]),
                conversion: { kind: 'linear', scale: 1, offset: 0 },
                cameraState: { origin: 'assumed', values: {} },
                uncertain: null,
              },
            });
            return () => {};
          },
        },
        close: async () => {},
      } as unknown as CameraSession);
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={source} />);
    await waitFor(() => expect(screen.getByText<HTMLButtonElement>('Start').disabled).toBe(false));
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(screen.getByText<HTMLButtonElement>('Stop').disabled).toBe(false));
    fireEvent.click(screen.getByLabelText('Enable alarm'));
    expect(screen.getByText('Alarm enabled — below threshold')).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
    act(() => alarmCallback.current(true));
    expect(start).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('Enable alarm'));
    expect(stop).toHaveBeenCalledOnce();
    expect(screen.getByText('Alarm disabled')).toBeTruthy();
    act(() => alarmCallback.current(true));
    expect(start).toHaveBeenCalledOnce();
  });
  it('opens a thermal PNG and adds fresh editable measurements', async () => {
    const bytes = await exportPng(
      {
        width: 2,
        height: 2,
        timestamp: 0,
        raw: new Uint16Array([20, 30, 40, 50]),
        conversion: { kind: 'linear', scale: 1, offset: 0 },
        cameraState: { origin: 'assumed', values: {} },
        uncertain: null,
      },
      {
        profile: { id: profile.id, version: profile.version, name: profile.name },
        fps: 1,
        path: 'exact',
      },
    );
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={backend()} />);
    fireEvent.click(screen.getByText('Add point'));
    fireEvent.change(screen.getByLabelText('Open thermal photo'), {
      target: { files: [{ name: 'scene.png', arrayBuffer: () => Promise.resolve(bytes.buffer) }] },
    });
    await screen.findByText(/scene.png/);
    expect(screen.getByLabelText<HTMLSelectElement>('Selected object').options).toHaveLength(1);
    for (const kind of ['point', 'line', 'area']) fireEvent.click(screen.getByText(`Add ${kind}`));
    expect(screen.getByLabelText<HTMLSelectElement>('Selected object').options).toHaveLength(4);
    await waitFor(() => expect(draw).toHaveBeenCalled());
    const received = draw.mock.calls.at(-1)?.[0] as RawFrame;
    expect(received.kind).toBe('thermal');
    if (received.kind === 'thermal')
      expect(received.frame.raw).toEqual(new Uint16Array([20, 30, 40, 50]));
  });
});

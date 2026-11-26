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
const recordingFrame = vi.hoisted(() =>
  vi.fn((): { frame: { width: number; height: number } } | null => null),
);
const alarmCallback = vi.hoisted(() => ({
  current: (_active: boolean) => {
    void _active;
  },
}));
vi.mock('../src/render.ts', () => ({
  FrameRenderer: class {
    draw = draw;
    recordingFrame = recordingFrame;
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
  recordingFrame.mockReset();
  recordingFrame.mockReturnValue(null);
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
    expect(
      screen.queryByText('Turn on a tracking shortcut or add a measurement to see readings.'),
    ).toBeNull();
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
  it('adds a point where the image is clicked and drags points and area corners', () => {
    // A 256 × 192 frame drawn 512 × 384 px: two screen pixels per image pixel.
    recordingFrame.mockReturnValue({ frame: { width: 256, height: 192 } });
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={backend()} />);
    const image = screen.getByLabelText('Thermal image');
    image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 384 }) as DOMRect;
    const selector = screen.getByLabelText<HTMLSelectElement>('Selected object');
    const value = (label: string) => screen.getByLabelText<HTMLInputElement>(label).value;
    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 201, clientY: 101 });
    expect(selector.options).toHaveLength(2);
    expect(selector.value).toBe('1');
    // Pixel (100, 50) of 256 × 192.
    expect([value('x (%)'), value('y (%)')]).toEqual(['39.22', '26.18']);
    fireEvent.pointerMove(image, { pointerId: 1, clientX: 21, clientY: 21 });
    fireEvent.pointerUp(image, { pointerId: 1, clientX: 21, clientY: 21 });
    expect([value('x (%)'), value('y (%)')]).toEqual(['3.92', '5.24']);
    // Pressing near the point grabs it instead of adding another.
    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 25, clientY: 25 });
    fireEvent.pointerUp(image, { pointerId: 1, clientX: 25, clientY: 25 });
    expect(selector.options).toHaveLength(2);
    // Outside the picture nothing happens.
    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 600, clientY: 10 });
    expect(selector.options).toHaveLength(2);
    // Area 2 spans 25–75 %; drag its top-right corner, pixel (191, 48), to (200, 10).
    fireEvent.click(screen.getByText('Add area'));
    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 383, clientY: 97 });
    fireEvent.pointerMove(image, { pointerId: 1, clientX: 401, clientY: 21 });
    fireEvent.pointerUp(image, { pointerId: 1, clientX: 401, clientY: 21 });
    expect(selector.value).toBe('2');
    expect([value('x (%)'), value('y (%)'), value('x2 (%)'), value('y2 (%)')]).toEqual([
      '25',
      '5.24',
      '78.43',
      '75',
    ]);
    // Buttons and clicks share one id counter.
    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 301, clientY: 301 });
    expect(selector.value).toBe('3');
  });
  it('keeps a grabbed handle where it was until the pointer really moves', () => {
    recordingFrame.mockReturnValue({ frame: { width: 256, height: 192 } });
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={backend()} />);
    const image = screen.getByLabelText('Thermal image');
    image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 384 }) as DOMRect;
    const selector = screen.getByLabelText<HTMLSelectElement>('Selected object');
    const value = (label: string) => screen.getByLabelText<HTMLInputElement>(label).value;
    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 201, clientY: 101 });
    fireEvent.pointerUp(image, { pointerId: 1, clientX: 201, clientY: 101 });
    fireEvent.click(screen.getByText('Add point'));
    // Grab point 1 four image pixels off its centre and jiggle by 2 screen pixels: a click.
    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 209, clientY: 101 });
    fireEvent.pointerMove(image, { pointerId: 1, clientX: 211, clientY: 101 });
    fireEvent.pointerUp(image, { pointerId: 1, clientX: 211, clientY: 101 });
    expect(selector.value).toBe('1');
    expect([value('x (%)'), value('y (%)')]).toEqual(['39.22', '26.18']);
    // A real drag moves it by the pointer's travel, not onto the pointer.
    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 209, clientY: 101 });
    fireEvent.pointerMove(image, { pointerId: 1, clientX: 229, clientY: 101 });
    // A second pointer neither takes over nor ends the drag.
    fireEvent.pointerDown(image, { button: 0, pointerId: 2, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(image, { pointerId: 2, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(image, { pointerId: 1, clientX: 249, clientY: 101 });
    fireEvent.pointerUp(image, { pointerId: 1, clientX: 249, clientY: 101 });
    // Pixel 100 + 20 = 120 of 256.
    expect([value('x (%)'), value('y (%)')]).toEqual(['47.06', '26.18']);
    expect(selector.options).toHaveLength(3);
    // Other buttons do nothing.
    fireEvent.pointerDown(image, { button: 2, pointerId: 1, clientX: 50, clientY: 50 });
    expect(selector.options).toHaveLength(3);
  });
  it('recovers when a drag never sees its pointer released', () => {
    recordingFrame.mockReturnValue({ frame: { width: 256, height: 192 } });
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={backend()} />);
    const image = screen.getByLabelText('Thermal image');
    image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 384 }) as DOMRect;
    const selector = screen.getByLabelText<HTMLSelectElement>('Selected object');
    // The mouse's pointerup is lost; its next press still adds a point.
    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 101, clientY: 101 });
    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 301, clientY: 101 });
    expect(selector.options).toHaveLength(3);
    // Losing the pointer capture ends the drag, so another pointer can start one.
    fireEvent.lostPointerCapture(image, { pointerId: 1 });
    fireEvent.pointerDown(image, { button: 0, pointerId: 2, clientX: 301, clientY: 301 });
    expect(selector.options).toHaveLength(4);
  });
  it('shows a move cursor only over a handle of an object that still exists', async () => {
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
    recordingFrame.mockReturnValue({ frame: { width: 256, height: 192 } });
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={backend()} />);
    // The cursor appears once a frame is shown; a photo shows one.
    fireEvent.change(screen.getByLabelText('Open thermal photo'), {
      target: { files: [{ name: 'scene.png', arrayBuffer: () => Promise.resolve(bytes.buffer) }] },
    });
    await screen.findByText(/scene.png/);
    const image = screen.getByLabelText('Thermal image');
    image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 384 }) as DOMRect;
    expect(image.style.cursor).toBe('crosshair');
    expect(image.style.touchAction).toBe('manipulation');
    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 101, clientY: 101 });
    fireEvent.pointerUp(image, { pointerId: 1, clientX: 101, clientY: 101 });
    const mouse = { pointerId: 1, pointerType: 'mouse' };
    fireEvent.pointerMove(image, { ...mouse, clientX: 103, clientY: 101 });
    expect(image.style.cursor).toBe('move');
    fireEvent.pointerMove(image, { ...mouse, clientX: 301, clientY: 301 });
    expect(image.style.cursor).toBe('crosshair');
    fireEvent.pointerMove(image, { ...mouse, clientX: 103, clientY: 101 });
    fireEvent.click(screen.getByText('Delete selected'));
    expect(image.style.cursor).toBe('crosshair');
    fireEvent.click(screen.getByText('Add point'));
    fireEvent.pointerDown(image, { button: 0, pointerId: 1, clientX: 101, clientY: 101 });
    fireEvent.pointerUp(image, { pointerId: 1, clientX: 101, clientY: 101 });
    fireEvent.pointerMove(image, { ...mouse, clientX: 103, clientY: 101 });
    expect(image.style.cursor).toBe('move');
    fireEvent.pointerLeave(image, mouse);
    expect(image.style.cursor).toBe('crosshair');
  });
  it('adds a point for a finger only when it lifts without scrolling', () => {
    recordingFrame.mockReturnValue({ frame: { width: 256, height: 192 } });
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={backend()} />);
    const image = screen.getByLabelText('Thermal image');
    image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 384 }) as DOMRect;
    const selector = screen.getByLabelText<HTMLSelectElement>('Selected object');
    const touch = { button: 0, pointerId: 5, pointerType: 'touch' };
    fireEvent.pointerDown(image, { ...touch, clientX: 101, clientY: 101 });
    expect(selector.options).toHaveLength(1);
    fireEvent.pointerUp(image, { ...touch, clientX: 102, clientY: 101 });
    expect(selector.options).toHaveLength(2);
    // A swipe and a gesture the browser takes over add nothing.
    fireEvent.pointerDown(image, { ...touch, clientX: 301, clientY: 101 });
    fireEvent.pointerMove(image, { ...touch, clientX: 301, clientY: 141 });
    fireEvent.pointerUp(image, { ...touch, clientX: 301, clientY: 141 });
    fireEvent.pointerDown(image, { ...touch, clientX: 301, clientY: 101 });
    fireEvent.pointerCancel(image, { ...touch, clientX: 301, clientY: 101 });
    expect(selector.options).toHaveLength(2);
    // Only a touch that starts on a handle keeps the page from scrolling.
    const onHandle = fireEvent.touchStart(image, { touches: [{ clientX: 101, clientY: 101 }] });
    const elsewhere = fireEvent.touchStart(image, { touches: [{ clientX: 401, clientY: 301 }] });
    expect([onHandle, elsewhere]).toEqual([false, true]);
  });
  it('asks for a tracking shortcut or a measurement only while neither is on', () => {
    render(<Viewer device="cam" modeId="yuyv-256x384" profile={profile} backend={backend()} />);
    const hint = 'Turn on a tracking shortcut or add a measurement to see readings.';
    expect(screen.getByText(hint)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Track max' }));
    expect(screen.queryByText(hint)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Track max' }));
    expect(screen.getByText(hint)).toBeTruthy();
    fireEvent.click(screen.getByText('Add point'));
    expect(screen.queryByText(hint)).toBeNull();
    fireEvent.click(screen.getByText('Clear measurements'));
    expect(screen.getByText(hint)).toBeTruthy();
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

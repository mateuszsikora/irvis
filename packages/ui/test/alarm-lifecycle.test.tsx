import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cameraProfiles,
  exportPng,
  type CameraBackend,
  type RawFrame,
  type ThermalFrame,
} from '@irvis/core';
import { Viewer } from '../src/index.ts';
const alarmCallback = vi.hoisted(() => ({
  current: (_active: boolean) => {
    void _active;
  },
}));
const draw = vi.hoisted(() => vi.fn());
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
  vi.unstubAllGlobals();
  draw.mockReset();
});
const profile = cameraProfiles[0]!;
const frame: ThermalFrame = {
  width: 1,
  height: 1,
  timestamp: 0,
  raw: new Uint16Array([50]),
  conversion: { kind: 'linear', scale: 1, offset: 0 },
  cameraState: { origin: 'assumed', values: {} },
  uncertain: null,
};
function setup(captureError = '') {
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
  const listeners: ((frame: RawFrame) => void)[] = [];
  const backend: CameraBackend = {
    id: 'browser',
    capabilities: { exactRaw: false, deviceControl: false, concurrentWith: [] },
    listDevices: () => Promise.resolve([{ id: 'cam', label: 'Camera' }]),
    open: () =>
      Promise.resolve({
        device: { id: 'cam', label: 'Camera' },
        profile,
        mode: profile.videoModes[0]!,
        frames: {
          subscribe: (listener) => {
            listeners.push(listener);
            return () => {};
          },
        },
        close: () => Promise.resolve(),
      }),
  };
  const view = render(
    <Viewer
      device="cam"
      modeId="yuyv-256x384"
      profile={profile}
      backend={backend}
      captureError={captureError}
    />,
  );
  return { start, stop, listeners, view, backend };
}
async function connect() {
  await waitFor(() => expect(screen.getByText<HTMLButtonElement>('Start').disabled).toBe(false));
  await act(async () => {
    fireEvent.click(screen.getByText('Start'));
    await Promise.resolve();
  });
}
function trigger(listener: (frame: RawFrame) => void) {
  act(() => {
    listener({ kind: 'thermal', frame });
  });
  fireEvent.click(screen.getByLabelText('Enable alarm'));
  act(() => alarmCallback.current(true));
}
async function openPhoto() {
  const bytes = await exportPng(frame, {
    profile: { id: profile.id, version: profile.version, name: profile.name },
    fps: 1,
    path: 'exact',
  });
  fireEvent.change(screen.getByLabelText('Open thermal photo'), {
    target: { files: [{ name: 'scene.png', arrayBuffer: () => Promise.resolve(bytes.buffer) }] },
  });
  await screen.findByText(/scene.png/);
}
describe('alarm lifecycle', () => {
  it('scopes capture errors to the camera across photo analysis and return to live capture', async () => {
    const { start, stop, view, backend, listeners } = setup('Camera disconnected');
    expect(screen.getByText('Capture error')).toBeTruthy();
    await openPhoto();
    fireEvent.click(screen.getByLabelText('Enable alarm'));
    act(() => alarmCallback.current(true));
    expect(screen.getByText('Alarm triggered')).toBeTruthy();
    expect(screen.queryByText('Capture error')).toBeNull();
    expect(screen.queryByText('Camera disconnected')).toBeNull();
    expect(start).toHaveBeenCalledOnce();
    view.rerender(
      <Viewer
        device="cam"
        modeId="yuyv-256x384"
        profile={profile}
        backend={backend}
        captureError="Late camera error"
      />,
    );
    expect(screen.queryByText('Late camera error')).toBeNull();
    expect(stop).not.toHaveBeenCalled();
    await connect();
    expect(screen.getByText('Capture error')).toBeTruthy();
    expect(screen.getByText('Late camera error')).toBeTruthy();
    expect(stop).toHaveBeenCalledOnce();
    act(() => {
      listeners[0]!({ kind: 'thermal', frame });
      alarmCallback.current(true);
    });
    expect(start).toHaveBeenCalledOnce();
    view.rerender(
      <Viewer
        device="cam"
        modeId="yuyv-256x384"
        profile={profile}
        backend={backend}
        captureError=""
      />,
    );
    expect(screen.queryByText('Capture error')).toBeNull();
    expect(start).toHaveBeenCalledTimes(2);
  });
  it('still reports photo rendering errors and silences photo audio', async () => {
    const { start, stop } = setup('Camera disconnected');
    await openPhoto();
    fireEvent.click(screen.getByLabelText('Enable alarm'));
    act(() => alarmCallback.current(true));
    expect(start).toHaveBeenCalledOnce();
    draw.mockImplementation(() => {
      throw new Error('Photo rendering failed');
    });
    fireEvent.click(screen.getByText('Rainbow'));
    await screen.findByText('Error: Photo rendering failed');
    // The error shows on commit; the effect that stops the sound runs just after it.
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(screen.queryByText('Camera disconnected')).toBeNull();
    act(() => alarmCallback.current(true));
    expect(start).toHaveBeenCalledOnce();
  });
  it('keeps live alarms working after a rejected photo import', async () => {
    const { start, stop, listeners } = setup();
    await connect();
    trigger(listeners[0]!);
    expect(start).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Open thermal photo'), {
      target: {
        files: [{ name: 'bad.png', arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }],
      },
    });
    await screen.findByText(/Photo import failed:/);
    expect(screen.queryByText('Capture error')).toBeNull();
    expect(stop).not.toHaveBeenCalled();
    act(() => alarmCallback.current(false));
    act(() => alarmCallback.current(true));
    expect(start).toHaveBeenCalledTimes(2);
  });
  it('waits for a new session frame and ignores retained frames and obsolete emissions', async () => {
    const { start, stop, listeners } = setup();
    await connect();
    trigger(listeners[0]!);
    expect(start).toHaveBeenCalledOnce();
    await act(async () => {
      fireEvent.click(screen.getByText('Stop'));
      await Promise.resolve();
    });
    expect(stop).toHaveBeenCalledOnce();
    await connect();
    expect(start).toHaveBeenCalledOnce();
    // A display change redraws the retained old frame; its alarm cannot belong to this session.
    draw.mockImplementation(() => alarmCallback.current(true));
    const before = draw.mock.calls.length;
    fireEvent.click(screen.getByText('Rainbow'));
    await waitFor(() => expect(draw.mock.calls.length).toBeGreaterThan(before));
    expect(start).toHaveBeenCalledOnce();
    act(() => {
      listeners[0]!({ kind: 'thermal', frame });
      alarmCallback.current(true);
    });
    expect(start).toHaveBeenCalledOnce();
    act(() => {
      listeners[1]!({ kind: 'thermal', frame });
    });
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  });
  it('stops photo audio and requires explicit re-enabling while keeping the photo editable', async () => {
    const { start, stop } = setup();
    const bytes = await exportPng(frame, {
      profile: { id: profile.id, version: profile.version, name: profile.name },
      fps: 1,
      path: 'exact',
    });
    fireEvent.change(screen.getByLabelText('Open thermal photo'), {
      target: { files: [{ name: 'scene.png', arrayBuffer: () => Promise.resolve(bytes.buffer) }] },
    });
    await screen.findByText(/scene.png/);
    fireEvent.click(screen.getByText('Add point'));
    fireEvent.click(screen.getByLabelText('Enable alarm'));
    act(() => alarmCallback.current(true));
    expect(start).toHaveBeenCalledOnce();
    expect(screen.getByText<HTMLButtonElement>('Stop').disabled).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByText('Stop'));
      await Promise.resolve();
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(screen.getByText('Alarm disabled')).toBeTruthy();
    act(() => alarmCallback.current(true));
    expect(start).toHaveBeenCalledOnce();
    expect(screen.getByLabelText<HTMLSelectElement>('Selected object').options).toHaveLength(2);
    fireEvent.click(screen.getByLabelText('Enable alarm'));
    act(() => alarmCallback.current(true));
    expect(start).toHaveBeenCalledTimes(2);
  });
});

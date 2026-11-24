import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { cameraProfiles } from '@irvis/core';
import { App } from './App.tsx';
import { startDiagnostics } from '@irvis/backend-browser';
vi.mock('./Diagnostics.tsx', () => ({ Diagnostics: () => null }));
vi.mock('@irvis/backend-browser', () => ({ startDiagnostics: vi.fn(() => () => {}) }));
afterEach(() => {
  cleanup();
  delete window.irvisDesktop;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
/** Selects the first listed camera, which the Source menu shows once the list arrives. */
async function selectCamera() {
  const source = screen.getByLabelText<HTMLSelectElement>('Source');
  const camera = await waitFor(() => {
    const option = source.querySelector<HTMLOptionElement>('option[value^="camera:"]');
    expect(option).toBeTruthy();
    return option!;
  });
  fireEvent.change(source, { target: { value: camera.value } });
}
async function start() {
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
}
describe('viewer sessions', () => {
  it('clears capture errors on retry and ignores errors from the closed browser session', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: () => Promise.resolve([]) } });
    render(<App />);
    await selectCamera();
    await start();
    await waitFor(() => expect(startDiagnostics).toHaveBeenCalledOnce());
    const old = vi.mocked(startDiagnostics).mock.calls[0]![2];
    act(() => old.error('Camera stream ended.'));
    expect(screen.getByRole('alert').textContent).toBe('Camera stream ended.');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await start();
    await waitFor(() => expect(startDiagnostics).toHaveBeenCalledTimes(2));
    act(() => old.error('Obsolete error'));
    expect(screen.queryByRole('alert')).toBeNull();
    vi.unstubAllGlobals();
  });
  it('keeps the newer Electron capture running after Start Stop Start with a delayed open', async () => {
    let resolveFirst!: () => void;
    const startBridge = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            resolveFirst = r;
          }),
      )
      .mockResolvedValue(undefined);
    const stopBridge = vi.fn(() => Promise.resolve());
    window.irvisDesktop = { start: startBridge, stop: stopBridge, subscribe: () => () => {} };
    render(<App />);
    await selectCamera();
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await start();
    await waitFor(() => expect(startBridge).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });
    expect(stopBridge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(stopBridge).toHaveBeenCalledOnce());
  });
  it('ignores pending capture errors after switching to Demo and back before starting again', async () => {
    let finish!: () => void;
    let report!: (message: string) => void;
    const stop = vi.fn(() => Promise.resolve());
    const unsubscribe = vi.fn();
    window.irvisDesktop = {
      start: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      stop,
      subscribe: (_frame, error) => {
        report = error;
        return unsubscribe;
      },
    };
    render(<App />);
    await selectCamera();
    await start();
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'demo' } });
    act(() => report('Old camera failed'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Capture error')).toBeNull();
    expect(screen.getByText('Ready')).toBeTruthy();
    await selectCamera();
    act(() => report('Old camera failed again'));
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('isolates pending errors when the camera profile changes and still reports current errors', async () => {
    let finish!: () => void;
    const reports: Array<(message: string) => void> = [];
    const bridgeStart = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const stop = vi.fn(() => Promise.resolve());
    window.irvisDesktop = {
      start: bridgeStart,
      stop,
      subscribe: (_frame, error) => {
        reports.push(error);
        return () => {};
      },
    };
    const profile = cameraProfiles[0]!;
    render(
      <App profiles={[profile, { ...profile, id: 'second-profile', name: 'Second profile' }]} />,
    );
    await selectCamera();
    await start();
    fireEvent.change(screen.getByLabelText('Camera profile'), {
      target: { value: 'second-profile' },
    });
    act(() => reports[0]!('Previous profile error'));
    expect(screen.queryByRole('alert')).toBeNull();
    await start();
    await waitFor(() => expect(bridgeStart).toHaveBeenCalledTimes(2));
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(stop).not.toHaveBeenCalled();
    act(() => reports[1]!('Current profile error'));
    expect(screen.getByRole('alert').textContent).toBe('Current profile error');
  });
});

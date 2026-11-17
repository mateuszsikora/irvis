import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraProfiles, type RawFrame } from '@irvis/core';
import { CameraControls } from '../src/CameraControls.tsx';

afterEach(cleanup);
const profile = cameraProfiles[0]!;
describe('CameraControls', () => {
  it('disables Auto for a video mode without temperature data', () => {
    const command = vi.fn();
    render(
      <CameraControls
        profile={profile}
        browser={false}
        command={command}
        frames={{ subscribe: () => () => {} }}
        mode={profile.videoModes[1]}
      />,
    );
    fireEvent.click(screen.getByText('Camera commands'));
    const auto = screen.getByRole<HTMLButtonElement>('button', { name: 'Auto sensor range' });
    expect(auto.disabled).toBe(true);
    fireEvent.click(auto);
    expect(command).not.toHaveBeenCalled();
    expect(screen.getByText('Auto requires a video mode with temperature data.')).toBeTruthy();
  });
  it('waits for automatic gain confirmation and exits Auto on failure', async () => {
    let receive: (frame: RawFrame) => void = () => {};
    const frames = {
      subscribe: (listener: typeof receive) => {
        receive = listener;
        return () => {};
      },
    };
    let reject!: (error: Error) => void;
    const command = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, fail) => {
            reject = fail;
          }),
      );
    render(
      <CameraControls
        profile={profile}
        browser={false}
        command={command}
        frames={frames}
        mode={{
          ...profile.videoModes[0]!,
          width: 2,
          height: 2,
          layout: { thermal: { firstRow: 1, rows: 1, packing: 'u16le' } },
        }}
      />,
    );
    fireEvent.click(screen.getByText('Camera commands'));
    fireEvent.click(screen.getByRole('button', { name: 'Auto sensor range' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Auto sensor range' }).getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    const data = new Uint8Array(8);
    new DataView(data.buffer).setUint16(4, 30000, true);
    const frame: RawFrame = {
      kind: 'yuyv',
      width: 2,
      height: 2,
      data,
      timestamp: 0,
      cameraState: { origin: 'camera', values: { gain: 'high' } },
    };
    act(() => {
      for (let i = 0; i < 500; i++) receive(frame);
    });
    expect(command.mock.calls).toEqual([
      ['gain-high', undefined],
      ['gain-low', undefined],
    ]);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Manual sensor range' }).disabled,
    ).toBe(true);
    await act(async () => {
      reject(new Error('Gain readback failed'));
      await Promise.resolve();
    });
    expect(
      screen.getByRole('button', { name: 'Manual sensor range' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Gain readback failed');
    act(() => {
      for (let i = 0; i < 500; i++) receive(frame);
    });
    expect(command).toHaveBeenCalledTimes(2);
  });
  it('confirms each reset write before clearing host correction', async () => {
    const command = vi.fn(() => Promise.resolve());
    const resetHostCorrection = vi.fn();
    render(
      <CameraControls
        profile={profile}
        browser={false}
        command={command}
        resetHostCorrection={resetHostCorrection}
      />,
    );
    fireEvent.click(screen.getByText('Camera commands'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset camera correction' }));
    await waitFor(() => expect(resetHostCorrection).toHaveBeenCalledOnce());
    expect(command.mock.calls).toEqual([
      ['set-emissivity', 1],
      ['set-ambient-temperature', 298 - 273.15],
      ['set-reflected-temperature', 298 - 273.15],
    ]);
    expect(
      screen.getByRole<HTMLInputElement>('spinbutton', { name: /^Camera reflected/ }).value,
    ).toBe('24.85');
  });
  it('stops a partial reset on failure and keeps host correction', async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('USB disconnected'));
    const resetHostCorrection = vi.fn();
    render(
      <CameraControls
        profile={profile}
        browser={false}
        command={command}
        resetHostCorrection={resetHostCorrection}
      />,
    );
    fireEvent.click(screen.getByText('Camera commands'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset camera correction' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('USB disconnected'),
    );
    expect(command).toHaveBeenCalledTimes(2);
    expect(resetHostCorrection).not.toHaveBeenCalled();
  });
  it('does not continue a reset after its camera session ends', async () => {
    let finish!: () => void;
    const command = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const resetHostCorrection = vi.fn();
    const view = render(
      <CameraControls
        profile={profile}
        browser={false}
        command={command}
        resetHostCorrection={resetHostCorrection}
      />,
    );
    fireEvent.click(screen.getByText('Camera commands'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset camera correction' }));
    view.unmount();
    finish();
    await Promise.resolve();
    expect(command).toHaveBeenCalledTimes(1);
    expect(resetHostCorrection).not.toHaveBeenCalled();
  });
  it('disables commands in the browser even with a dispatcher', () => {
    const command = vi.fn();
    render(<CameraControls profile={profile} browser command={command} />);
    fireEvent.click(screen.getByText('Camera commands'));
    const gain = screen.getByRole<HTMLButtonElement>('button', { name: 'High gain' });
    expect(gain.disabled).toBe(true);
    fireEvent.click(gain);
    expect(command).not.toHaveBeenCalled();
    expect(screen.getByText(/available in the desktop app/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Manual NUC' }).disabled).toBe(
      true,
    );
  });
  it('validates camera correction inputs and sends only the selected value', async () => {
    const command = vi.fn(() => Promise.resolve());
    render(<CameraControls profile={profile} browser={false} command={command} />);
    fireEvent.click(screen.getByText('Camera commands'));
    const input = screen.getByRole('spinbutton', { name: /^Camera emissivity/ });
    const apply = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Apply camera emissivity',
    });
    fireEvent.change(input, { target: { value: '0.1' } });
    expect(apply.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '0.875' } });
    fireEvent.click(apply);
    await waitFor(() => expect(command).toHaveBeenCalledWith('set-emissivity', 0.875));
  });
  it('waits for confirmation before allowing another command and reports failure', async () => {
    let finish!: () => void;
    const command = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<CameraControls profile={profile} browser={false} command={command} />);
    fireEvent.click(screen.getByText('Camera commands'));
    const high = screen.getByRole<HTMLButtonElement>('button', { name: 'High gain' });
    const low = screen.getByRole<HTMLButtonElement>('button', { name: 'Low gain' });
    fireEvent.click(high);
    expect(low.disabled).toBe(true);
    fireEvent.click(low);
    expect(command).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(high.disabled).toBe(false));
    expect(screen.getByRole('status').textContent).toBe('Camera command confirmed.');
    command.mockRejectedValueOnce(new Error('Camera did not confirm the requested gain'));
    fireEvent.click(low);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('did not confirm'),
    );
    expect(high.disabled).toBe(false);
  });
});

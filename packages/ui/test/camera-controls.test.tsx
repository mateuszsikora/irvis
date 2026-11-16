import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraProfiles } from '@irvis/core';
import { CameraControls } from '../src/CameraControls.tsx';

afterEach(cleanup);
const profile = cameraProfiles[0]!;
describe('CameraControls', () => {
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

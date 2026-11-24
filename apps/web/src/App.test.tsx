import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraProfiles, type CameraProfile } from '@irvis/core';
import { App } from './App.tsx';

vi.mock('./Diagnostics.tsx', () => ({ Diagnostics: () => null }));

afterEach(() => {
  cleanup();
  delete window.irvisDesktop;
});

const options = (label: string) =>
  Array.from(
    screen.getByLabelText<HTMLSelectElement>(label).querySelectorAll('option'),
    (option) => [option.value, option.textContent],
  );

describe('App', () => {
  it('names the app', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('irvis');
  });

  it('says that no camera is supported while the registry is empty', () => {
    render(<App profiles={[]} />);
    expect(screen.getByText('No camera is supported yet.')).toBeTruthy();
  });

  it('lists the registered cameras by name next to Start', () => {
    const profiles: CameraProfile[] = [
      { ...cameraProfiles[0]!, id: 'a', name: 'Camera A' },
      { ...cameraProfiles[0]!, id: 'b', name: 'Camera B' },
    ];
    render(<App profiles={profiles} />);
    expect(
      Array.from(
        screen.getByLabelText('Camera profile').querySelectorAll('option'),
        (option) => option.textContent,
      ),
    ).toEqual(['Camera A', 'Camera B']);
    expect(
      screen
        .getByRole('button', { name: 'Start' })
        .parentElement!.contains(screen.getByLabelText('Camera profile')),
    ).toBe(true);
  });

  it('offers Demo and every connected camera as the source, and only thermal video modes', async () => {
    window.irvisDesktop = {
      start: vi.fn(() => Promise.resolve()),
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
      listDevices: () =>
        Promise.resolve([
          { id: '0', label: 'FaceTime HD Camera' },
          { id: '1', label: 'USB Camera' },
        ]),
    };
    render(<App />);
    await screen.findByText('USB Camera', { selector: 'option' });
    expect(options('Source')).toEqual([
      ['demo', 'Demo'],
      ['camera:0', 'FaceTime HD Camera'],
      ['camera:1', 'USB Camera'],
    ]);
    expect(options('Video mode')).toEqual([['yuyv-256x384', '256 × 384 · 25 fps']]);
  });

  it('starts the camera and mode chosen in the header', async () => {
    const start = vi.fn(() => Promise.resolve());
    window.irvisDesktop = {
      start,
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
      listDevices: () => Promise.resolve([{ id: '1', label: 'USB Camera' }]),
    };
    render(<App />);
    await screen.findByText('USB Camera', { selector: 'option' });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'camera:1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith({
        profileId: cameraProfiles[0]!.id,
        modeId: 'yuyv-256x384',
        device: '1',
      }),
    );
  });

  it('keeps a camera that disappears on refresh selected as disconnected and disables Start', async () => {
    let devices = [{ id: '1', label: 'USB Camera' }];
    window.irvisDesktop = {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
      listDevices: () => Promise.resolve(devices),
    };
    render(<App />);
    await screen.findByText('USB Camera', { selector: 'option' });
    const source = screen.getByLabelText<HTMLSelectElement>('Source');
    fireEvent.change(source, { target: { value: 'camera:1' } });
    devices = [{ id: '2', label: 'Other camera' }];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cameras' }));
    await screen.findByText('Other camera', { selector: 'option' });
    expect(source.value).toBe('missing');
    expect(options('Source')).toEqual([
      ['demo', 'Demo'],
      ['camera:2', 'Other camera'],
      ['missing', 'USB Camera (disconnected)'],
    ]);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(true);
    devices = [{ id: '1', label: 'USB Camera' }];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cameras' }));
    await screen.findByText('USB Camera', { selector: 'option' });
    expect(source.value).toBe('camera:1');
    expect(screen.queryByText('USB Camera (disconnected)')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(false);
  });

  it('does not take another camera that moves into the position of a disconnected one', async () => {
    let devices = [
      { id: '0', label: 'FaceTime HD Camera' },
      { id: '1', label: 'USB Camera' },
      { id: '2', label: 'iPhone Camera' },
    ];
    window.irvisDesktop = {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
      listDevices: () => Promise.resolve(devices),
    };
    render(<App />);
    await screen.findByText('USB Camera', { selector: 'option' });
    const source = screen.getByLabelText<HTMLSelectElement>('Source');
    fireEvent.change(source, { target: { value: 'camera:1' } });
    devices = [
      { id: '0', label: 'FaceTime HD Camera' },
      { id: '1', label: 'iPhone Camera' },
    ];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cameras' }));
    await screen.findByText('USB Camera (disconnected)', { selector: 'option' });
    expect(source.value).toBe('missing');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(true);
  });

  it('follows the chosen camera to its new position and starts it there', async () => {
    const start = vi.fn(() => Promise.resolve());
    let devices = [
      { id: '0', label: 'iPhone Camera' },
      { id: '1', label: 'FaceTime HD Camera' },
      { id: '2', label: 'USB Camera' },
    ];
    window.irvisDesktop = {
      start,
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
      listDevices: () => Promise.resolve(devices),
    };
    render(<App />);
    await screen.findByText('USB Camera', { selector: 'option' });
    const source = screen.getByLabelText<HTMLSelectElement>('Source');
    fireEvent.change(source, { target: { value: 'camera:2' } });
    devices = [
      { id: '0', label: 'FaceTime HD Camera' },
      { id: '1', label: 'USB Camera' },
    ];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cameras' }));
    await waitFor(() => expect(source.value).toBe('camera:1'));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(expect.objectContaining({ device: '1' })),
    );
  });

  it('keeps following a camera found under a new id when its old id is taken by a namesake', async () => {
    let devices = [
      { id: '0', label: 'FaceTime HD Camera' },
      { id: '1', label: 'USB Camera' },
    ];
    window.irvisDesktop = {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
      listDevices: () => Promise.resolve(devices),
    };
    render(<App />);
    await screen.findByText('USB Camera', { selector: 'option' });
    const source = screen.getByLabelText<HTMLSelectElement>('Source');
    fireEvent.change(source, { target: { value: 'camera:1' } });
    devices = [
      { id: '0', label: 'USB Camera' },
      { id: '1', label: 'FaceTime HD Camera' },
    ];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cameras' }));
    await waitFor(() => expect(source.value).toBe('camera:0'));
    devices = [
      { id: '0', label: 'USB Camera' },
      { id: '1', label: 'USB Camera' },
    ];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cameras' }));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh cameras' }).disabled,
      ).toBe(false),
    );
    expect(source.value).toBe('camera:0');
  });

  it('explains why the camera list is unavailable', async () => {
    render(<App />);
    expect(
      await screen.findByText('Cameras unavailable: Camera access requires HTTPS or localhost.'),
    ).toBeTruthy();
  });
});

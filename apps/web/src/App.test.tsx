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
const disabled = (label: string) =>
  Array.from(
    screen.getByLabelText<HTMLSelectElement>(label).querySelectorAll('option'),
    (option) => option.disabled,
  );
const T7_MODES = [
  { width: 256, height: 192, minFps: 25, maxFps: 25 },
  { width: 256, height: 384, minFps: 25, maxFps: 25 },
];
const FACETIME_MODES = [
  { width: 1920, height: 1080, minFps: 15, maxFps: 30 },
  { width: 640, height: 480, minFps: 15, maxFps: 30 },
];

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

  it('offers Demo and every connected camera as the source, and the profile modes with image-only ones disabled', async () => {
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
    expect(options('Video mode')).toEqual([
      ['yuyv-256x384', '256 × 384 · 25 fps'],
      ['yuyv-256x192', '256 × 192 · 25 fps · image only'],
    ]);
    expect(disabled('Video mode')).toEqual([false, true]);
  });

  it('lists the modes the chosen camera reports, with temperature data only where the profile has it', async () => {
    const start = vi.fn(() => Promise.resolve());
    const listModes = vi.fn(() => Promise.resolve(T7_MODES));
    window.irvisDesktop = {
      start,
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
      listDevices: () => Promise.resolve([{ id: '0', label: 'USB Camera' }]),
      listModes,
    };
    render(<App />);
    await screen.findByText('USB Camera', { selector: 'option' });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'camera:0' } });
    await screen.findByText('256 × 192 · 25 fps · image only', { selector: 'option' });
    expect(listModes).toHaveBeenCalledWith('0');
    expect(options('Video mode')).toEqual([
      ['device-256x192-25-25', '256 × 192 · 25 fps · image only'],
      ['yuyv-256x384', '256 × 384 · 25 fps'],
    ]);
    expect(disabled('Video mode')).toEqual([true, false]);
    expect(screen.getByLabelText<HTMLSelectElement>('Video mode').value).toBe('yuyv-256x384');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(expect.objectContaining({ modeId: 'yuyv-256x384' })),
    );
  });

  it('says before Start that a camera without a temperature mode is not the thermal camera', async () => {
    window.irvisDesktop = {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
      listDevices: () => Promise.resolve([{ id: '1', label: 'FaceTime HD Camera' }]),
      listModes: () => Promise.resolve(FACETIME_MODES),
    };
    render(<App />);
    await screen.findByText('FaceTime HD Camera', { selector: 'option' });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'camera:1' } });
    expect(
      await screen.findByText(
        'FaceTime HD Camera has no video mode with temperature data in the InfiRay P2 Pro profile. It is probably not the thermal camera: choose another camera in Source.',
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>('Video mode').value).toBe('');
    expect(options('Video mode')).toEqual([
      ['', 'No mode with temperature data'],
      ['device-1920x1080-15-30', '1920 × 1080 · 15–30 fps · image only'],
      ['device-640x480-15-30', '640 × 480 · 15–30 fps · image only'],
    ]);
    expect(disabled('Video mode')).toEqual([true, true, true]);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(true);
  });

  it('falls back to the profile modes when the camera modes cannot be read', async () => {
    const listModes = vi.fn(() => Promise.reject(new Error('Reading the camera modes timed out')));
    window.irvisDesktop = {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
      listDevices: () => Promise.resolve([{ id: '0', label: 'USB Camera' }]),
      listModes,
    };
    render(<App />);
    await screen.findByText('USB Camera', { selector: 'option' });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'camera:0' } });
    // The unknown modes before the read look the same, so wait for the read to settle.
    await waitFor(() => expect(listModes).toHaveBeenCalledWith('0'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(false);
    expect(screen.queryByText(/has no video mode with temperature data/)).toBeNull();
    expect(options('Video mode')).toEqual([
      ['yuyv-256x384', '256 × 384 · 25 fps'],
      ['yuyv-256x192', '256 × 192 · 25 fps · image only'],
    ]);
  });

  it('chooses the profile that lists the camera USB IDs or, without them, matches its name, and keeps the choice when none or several do', async () => {
    const base = cameraProfiles[0]!;
    const profiles: CameraProfile[] = [
      {
        ...base,
        id: 'a',
        name: 'Camera A',
        identification: { usb: [{ vendorId: 1, productId: 1 }] },
      },
      {
        ...base,
        id: 'b',
        name: 'Camera B',
        identification: { usb: [{ vendorId: 2, productId: 2 }] },
      },
      {
        ...base,
        id: 'c',
        name: 'Camera C',
        identification: { usb: [{ vendorId: 2, productId: 2 }] },
      },
      {
        ...base,
        id: 'd',
        name: 'Camera D',
        identification: { usb: [{ vendorId: 3, productId: 3 }] },
      },
      {
        ...base,
        id: 'e',
        name: 'Camera E',
        identification: { usb: [{ vendorId: 4, productId: 4 }], labelPattern: 'lepton' },
      },
    ];
    window.irvisDesktop = {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
      listDevices: () =>
        Promise.resolve([
          { id: '0', label: 'Webcam' },
          { id: '1', label: 'Shared', vendorId: 2, productId: 2 },
          { id: '2', label: 'Thermal', vendorId: 3, productId: 3 },
          { id: '3', label: 'PureThermal Lepton' },
        ]),
    };
    render(<App profiles={profiles} />);
    await screen.findByText('Thermal', { selector: 'option' });
    const source = screen.getByLabelText('Source');
    // The profile select remounts with the viewer on every Source choice.
    const profile = () => screen.getByLabelText<HTMLSelectElement>('Camera profile').value;
    fireEvent.change(source, { target: { value: 'camera:2' } });
    expect(profile()).toBe('d');
    fireEvent.change(source, { target: { value: 'camera:1' } });
    expect(profile()).toBe('d');
    fireEvent.change(screen.getByLabelText('Camera profile'), { target: { value: 'b' } });
    fireEvent.change(source, { target: { value: 'camera:0' } });
    expect(profile()).toBe('b');
    fireEvent.change(source, { target: { value: 'camera:3' } });
    expect(profile()).toBe('e');
  });

  it('keeps the default mode in profile order when the camera modes arrive, so a started capture goes on', async () => {
    const base = cameraProfiles[0]!;
    const thermal = base.videoModes[0]!;
    const tall = { ...thermal, id: 'yuyv-256x400', height: 400 };
    const profile: CameraProfile = { ...base, videoModes: [thermal, tall] };
    let report!: (modes: typeof T7_MODES) => void;
    const start = vi.fn(() => Promise.resolve());
    const stop = vi.fn(() => Promise.resolve());
    window.irvisDesktop = {
      start,
      stop,
      subscribe: () => () => {},
      listDevices: () => Promise.resolve([{ id: '0', label: 'USB Camera' }]),
      listModes: () =>
        new Promise((resolve) => {
          report = resolve;
        }),
    };
    render(<App profiles={[profile]} />);
    await screen.findByText('USB Camera', { selector: 'option' });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'camera:0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(expect.objectContaining({ modeId: thermal.id })),
    );
    report([
      { width: 256, height: 400, minFps: 25, maxFps: 25 },
      { width: 256, height: 384, minFps: 25, maxFps: 25 },
    ]);
    await screen.findByText('256 × 400 · 25 fps', { selector: 'option' });
    expect(options('Video mode').map(([value]) => value)).toEqual(['yuyv-256x400', thermal.id]);
    expect(screen.getByLabelText<HTMLSelectElement>('Video mode').value).toBe(thermal.id);
    expect(stop).not.toHaveBeenCalled();
  });

  it('ignores modes read for a camera that is no longer chosen, or for another camera at its id', async () => {
    const pending: Record<string, (modes: typeof T7_MODES) => void> = {};
    let devices = [
      { id: '0', label: 'USB Camera' },
      { id: '1', label: 'FaceTime HD Camera' },
    ];
    window.irvisDesktop = {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
      listDevices: () => Promise.resolve(devices),
      listModes: (id: string) =>
        new Promise((resolve) => {
          pending[id] = resolve;
        }),
    };
    render(<App />);
    await screen.findByText('FaceTime HD Camera', { selector: 'option' });
    const source = screen.getByLabelText('Source');
    fireEvent.change(source, { target: { value: 'camera:1' } });
    fireEvent.change(source, { target: { value: 'camera:0' } });
    await waitFor(() => expect(pending['0']).toBeDefined());
    pending['0']!(T7_MODES);
    await screen.findByText('256 × 192 · 25 fps · image only', { selector: 'option' });
    pending['1']!(FACETIME_MODES);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(options('Video mode')[1]).toEqual(['yuyv-256x384', '256 × 384 · 25 fps']);
    fireEvent.change(source, { target: { value: 'demo' } });
    devices = [{ id: '0', label: 'FaceTime HD Camera' }];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cameras' }));
    await waitFor(() =>
      expect(options('Source')).toEqual([
        ['demo', 'Demo'],
        ['camera:0', 'FaceTime HD Camera'],
      ]),
    );
    fireEvent.change(source, { target: { value: 'camera:0' } });
    expect(options('Video mode')).toEqual([
      ['yuyv-256x384', '256 × 384 · 25 fps'],
      ['yuyv-256x192', '256 × 192 · 25 fps · image only'],
    ]);
  });

  it('keeps the camera modes while a refresh follows the camera to a new id and when reading them there fails', async () => {
    let devices = [
      { id: '0', label: 'FaceTime HD Camera' },
      { id: '1', label: 'USB Camera' },
    ];
    const listModes = vi.fn((id: string) =>
      id === '1' ? Promise.resolve(T7_MODES) : new Promise<typeof T7_MODES>(() => {}),
    );
    window.irvisDesktop = {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      subscribe: () => () => {},
      listDevices: () => Promise.resolve(devices),
      listModes,
    };
    render(<App />);
    await screen.findByText('USB Camera', { selector: 'option' });
    const source = screen.getByLabelText<HTMLSelectElement>('Source');
    fireEvent.change(source, { target: { value: 'camera:1' } });
    await screen.findByText('256 × 192 · 25 fps · image only', { selector: 'option' });
    devices = [{ id: '0', label: 'USB Camera' }];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cameras' }));
    await waitFor(() => expect(source.value).toBe('camera:0'));
    // The read for the new id starts in a passive effect, after the render that shows it.
    await waitFor(() => expect(listModes).toHaveBeenLastCalledWith('0'));
    expect(options('Video mode')[0]).toEqual([
      'device-256x192-25-25',
      '256 × 192 · 25 fps · image only',
    ]);
    listModes.mockImplementation(() => Promise.reject(new Error('Device busy')));
    devices = [
      { id: '0', label: 'FaceTime HD Camera' },
      { id: '1', label: 'USB Camera' },
    ];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cameras' }));
    await waitFor(() => expect(source.value).toBe('camera:1'));
    await waitFor(() => expect(listModes).toHaveBeenLastCalledWith('1'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(options('Video mode')[0]).toEqual([
      'device-256x192-25-25',
      '256 × 192 · 25 fps · image only',
    ]);
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

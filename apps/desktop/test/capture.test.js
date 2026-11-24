import { describe, it, expect, vi, afterEach } from 'vitest';
import { inputArgs, captureArgs, captureEndedMessage } from '../src/capture.js';
import { openControl } from '../src/control.js';
import { cameraProfiles } from '@irvis/core';
import { CameraUsb } from '../../../tools/capture-cli/src/usb-protocol.ts';
const usb = vi.hoisted(() => {
  const device = {
    deviceDescriptor: { idVendor: 0x0bda, idProduct: 0x5840 },
    open: vi.fn(),
    close: vi.fn(),
    controlTransfer: vi.fn((type, request, value, index, data, cb) => {
      void Promise.resolve().then(() =>
        cb(null, typeof data === 'number' ? Buffer.alloc(data) : Buffer.alloc(0)),
      );
    }),
  };
  return { device, getDeviceList: vi.fn(() => [device]) };
});
vi.mock('usb', () => ({ getDeviceList: usb.getDeviceList }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
describe('desktop capture', () => {
  const profile = cameraProfiles[0],
    mode = profile.videoModes[0];
  it('selects the native input and exact output for each system', () => {
    expect(inputArgs('darwin', '2', mode)).toEqual([
      '-f',
      'avfoundation',
      '-framerate',
      '25',
      '-video_size',
      '256x384',
      '-pixel_format',
      'yuyv422',
      '-i',
      '2:none',
    ]);
    expect(inputArgs('linux', '/dev/video2', mode)).toContain('v4l2');
    expect(inputArgs('linux', '/dev/video2', mode)).toContain('-input_format');
    expect(inputArgs('win32', 'Thermal camera', mode).slice(-2)).toEqual([
      '-i',
      'video=Thermal camera',
    ]);
    expect(captureArgs('darwin', 0, mode)).toContain('+');
    expect(captureArgs('darwin', 0, mode)).not.toContain('-t');
    expect(() => inputArgs('linux', '/tmp/video', mode)).toThrow('Invalid capture selection');
  });
  it('explains a camera without the thermal video mode instead of quoting ffmpeg', () => {
    const log = [
      '[in#0 @ 0x7c5101c000] Selected video size (256x384) is not supported by the device.',
      '[in#0 @ 0x7c5101c000] Supported modes:',
      '[in#0 @ 0x7c5101c000]   1920x1080@[15.000000 30.000000]fps',
      '[in#0 @ 0x7c5101c000]   1280x720@[15.000000 30.000000]fps',
      '[in#0 @ 0x7c5101c000]   1280x720@[60.000000 60.000000]fps',
      '[in#0 @ 0x7c5101c000]   640x480@[15.000000 30.000000]fps',
      '[in#0 @ 0x7c51018000] Error opening input: Input/output error',
      'Error opening input file 0:none.',
      'Error opening input files: Input/output error',
      '',
    ].join('\n');
    expect(captureEndedMessage(251, log, mode)).toBe(
      'This camera has no 256 × 384 video mode; it offers 1920 × 1080, 1280 × 720 and 640 × 480. It is probably not the thermal camera: choose another camera in Source.',
    );
  });
  it('ends other capture failures with the exit code and the last ffmpeg lines without their context', () => {
    const log = [
      'ffmpeg version 8.0',
      '[AVFoundation indev @ 0x78ed01c140] Video device not found',
      '[in#0 @ 0x78ed01c000] Error opening input: Input/output error',
      'Error opening input file 99:none.',
      'Error opening input files: Input/output error',
    ].join('\n');
    expect(captureEndedMessage(251, log, mode)).toBe(
      [
        'Capture ended (251).',
        'Video device not found',
        'Error opening input: Input/output error',
        'Error opening input file 99:none.',
        'Error opening input files: Input/output error',
      ].join('\n'),
    );
  });
  it('reads state, allow-lists commands and refreshes per-frame sensor bytes', async () => {
    vi.useFakeTimers();
    const control = await openControl(profile);
    try {
      expect(await control.read()).toEqual({
        origin: 'camera',
        values: {
          gain: 'low',
          emissivity: 'unknown',
          'reflected-temperature': 'unknown',
          'usb-distance': 0,
          'usb-tu': 0,
          'usb-ta': 0,
          'usb-ems': 0,
          'usb-tau': 0,
          'usb-pseudo_color': '00',
          'usb-cur_vtemp': '0000',
        },
      });
      const count = usb.device.controlTransfer.mock.calls.length;
      await expect(control.command('not-a-command')).rejects.toThrow('Unknown camera command');
      expect(usb.device.controlTransfer).toHaveBeenCalledTimes(count);
      await expect(control.command('gain-high')).rejects.toThrow('Camera did not confirm');
      expect(
        usb.device.controlTransfer.mock.calls.some(
          (c) =>
            Buffer.isBuffer(c[4]) && c[4].equals(Buffer.from(profile.commands[1].transport.data)),
        ),
      ).toBe(true);
      const before = usb.device.controlTransfer.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(usb.device.controlTransfer.mock.calls.length).toBeGreaterThan(before);
    } finally {
      control.close();
    }
    await Promise.resolve();
    await expect(control.command('gain-high')).rejects.toThrow('closed');
    expect(usb.device.close).toHaveBeenCalledOnce();
  });
  it('blocks gain conversion after failed readback and recovers only on a valid read', async () => {
    const state = vi
      .spyOn(CameraUsb.prototype, 'state')
      .mockResolvedValueOnce({ gain: 0 })
      .mockResolvedValueOnce({ gain: { error: 'USB timeout' }, distance: 100 })
      .mockResolvedValueOnce({ gain: 7 })
      .mockResolvedValueOnce({ gain: 1 });
    const control = await openControl(profile);
    try {
      expect((await control.read()).values.gain).toBe('low');
      await expect(control.command('gain-low')).rejects.toThrow('Camera did not confirm');
      expect(control.snapshot.values.gain).toBe('unknown');
      expect(
        profile.conversions.find((c) => c.gain === control.snapshot.values.gain),
      ).toBeUndefined();
      expect((await control.read()).values.gain).toBe('unknown');
      expect((await control.read()).values.gain).toBe('high');
      expect(state).toHaveBeenCalledTimes(4);
    } finally {
      await control.close();
    }
  });
  it('rejects overlapping commands and confirms gain readback', async () => {
    vi.spyOn(CameraUsb.prototype, 'state').mockResolvedValue({ gain: 1 });
    const control = await openControl(profile);
    try {
      const first = control.command('gain-high');
      expect(control.busy).toBe(true);
      await expect(control.command('gain-low')).rejects.toThrow('already in progress');
      await first;
      expect(control.snapshot.values.gain).toBe('high');
      expect(control.busy).toBe(false);
      expect(control.snapshot.values['command-generation']).toBe(1);
      expect((await control.read()).values['command-generation']).toBe(1);
    } finally {
      await control.close();
    }
  });
  it('discards stale gain when command readback throws', async () => {
    vi.spyOn(CameraUsb.prototype, 'state')
      .mockResolvedValueOnce({ gain: 1 })
      .mockRejectedValueOnce(new Error('Disconnected'));
    const control = await openControl(profile);
    try {
      await control.read();
      await expect(control.command('gain-low')).rejects.toThrow('Disconnected');
      expect(control.snapshot.values.gain).toBe('unknown');
      expect(control.busy).toBe(false);
    } finally {
      await control.close();
    }
  });
  it('repeats the full state read while gain, emissivity or reflected temperature is unknown', async () => {
    vi.useFakeTimers();
    const state = vi
      .spyOn(CameraUsb.prototype, 'state')
      .mockResolvedValueOnce({ gain: 1, ems: { error: 'IOKit request failed' }, tu: 300 })
      .mockResolvedValueOnce({ gain: { error: 'IOKit request failed' }, ems: 112, tu: 300 })
      .mockResolvedValueOnce({ gain: 1, ems: 112, tu: 300 });
    const standard = vi.spyOn(CameraUsb.prototype, 'standard');
    const control = await openControl(profile);
    try {
      expect((await control.read()).values.emissivity).toBe('unknown');
      await vi.advanceTimersByTimeAsync(1000);
      expect(state).toHaveBeenCalledTimes(2);
      expect(control.snapshot.values.emissivity).toBe(0.875);
      expect(control.snapshot.values.gain).toBe('unknown');
      await vi.advanceTimersByTimeAsync(1000);
      expect(state).toHaveBeenCalledTimes(3);
      expect(standard).not.toHaveBeenCalled();
      expect(control.snapshot.values.gain).toBe('high');
      await vi.advanceTimersByTimeAsync(1000);
      expect(state).toHaveBeenCalledTimes(3);
      expect(standard).toHaveBeenCalledOnce();
    } finally {
      await control.close();
    }
  });
  it('backs off repeated full state reads to 30 seconds and polls sensor bytes between them', async () => {
    vi.useFakeTimers();
    const state = vi
      .spyOn(CameraUsb.prototype, 'state')
      .mockResolvedValue({ gain: 1, ems: 0, tu: 300 });
    const standard = vi.spyOn(CameraUsb.prototype, 'standard');
    const control = await openControl(profile);
    try {
      await control.read();
      const reads = [];
      for (let second = 1; second <= 120; second++) {
        const before = state.mock.calls.length;
        await vi.advanceTimersByTimeAsync(1000);
        if (state.mock.calls.length > before) reads.push(second);
      }
      // Gaps 1, 2, 4, 8, 16, then 30 seconds.
      expect(reads).toEqual([1, 2, 4, 8, 16, 32, 62, 92]);
      expect(standard).toHaveBeenCalledTimes(120 - reads.length);
      expect(control.snapshot.values.emissivity).toBe('unknown');
    } finally {
      await control.close();
    }
  });
  it('encodes bounded camera settings and confirms their raw readback', async () => {
    vi.spyOn(CameraUsb.prototype, 'state').mockResolvedValue({ gain: 1, ems: 112, tu: 300 });
    const control = await openControl(profile);
    try {
      await control.command('set-emissivity', 0.875);
      expect(control.snapshot.values.emissivity).toBe(0.875);
      expect(control.snapshot.values['reflected-temperature']).toBe(300 - 273.15);
      expect(
        usb.device.controlTransfer.mock.calls.some(
          (call) =>
            Buffer.isBuffer(call[4]) &&
            call[4].equals(Buffer.from([0x14, 0xc5, 0, 3, 0, 0, 0, 112])),
        ),
      ).toBe(true);
      await expect(control.command('set-emissivity', 1)).rejects.toThrow(
        'did not confirm the requested setting',
      );
    } finally {
      await control.close();
    }
  });
  it('rejects missing nonfinite and out of range settings before USB access', async () => {
    const control = await openControl(profile);
    try {
      for (const value of [undefined, NaN, Infinity, 0.49, 1.01, '0.875'])
        await expect(control.command('set-emissivity', value)).rejects.toThrow(
          'outside the supported range',
        );
      await expect(control.command('gain-high', 1)).rejects.toThrow('does not accept a value');
      expect(usb.device.controlTransfer).not.toHaveBeenCalled();
    } finally {
      await control.close();
    }
  });
  it('refuses ambiguous USB selection', async () => {
    usb.getDeviceList.mockReturnValueOnce([usb.device, usb.device]);
    await expect(openControl(profile)).rejects.toThrow('exactly one');
    expect(usb.device.open).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { inputArgs, captureArgs } from '../src/capture.js';
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
  it('reads state, allow-lists commands and refreshes per-frame sensor bytes', async () => {
    vi.useFakeTimers();
    const control = await openControl(profile);
    try {
      expect(await control.read()).toEqual({
        origin: 'camera',
        values: {
          gain: 'low',
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
      await control.command('gain-high');
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
      await control.command('gain-low');
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
  it('refuses ambiguous USB selection', async () => {
    usb.getDeviceList.mockReturnValueOnce([usb.device, usb.device]);
    await expect(openControl(profile)).rejects.toThrow('exactly one');
    expect(usb.device.open).not.toHaveBeenCalled();
  });
});

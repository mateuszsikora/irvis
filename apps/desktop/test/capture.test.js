import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  inputArgs,
  captureArgs,
  captureEndedMessage,
  listDevices,
  listModes,
  modesArgs,
  parseCameraData,
  parseDeviceModes,
} from '../src/capture.js';
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
  it('names V4L2 nodes as the kernel does, in number order, without second nodes of a device', async () => {
    const sysfs = {
      'video0/name': 'Integrated Camera\n',
      'video0/index': '0\n',
      'video2/name': 'USB Camera: USB Camera\n',
      'video2/index': '0\n',
      'video2/device/../idVendor': '0bda\n',
      'video2/device/../idProduct': '5830\n',
      'video3/name': 'USB Camera: USB Camera\n',
      'video3/index': '1\n',
    };
    const fs = {
      readdir: () => Promise.resolve(['video10', 'video2', 'null', 'video3', 'video0']),
      readFile: (path) => {
        const text = sysfs[path.replace('/sys/class/video4linux/', '')];
        return text === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(text);
      },
    };
    expect(await listDevices('linux', undefined, fs)).toEqual([
      { id: '/dev/video0', label: 'Integrated Camera' },
      { id: '/dev/video2', label: 'USB Camera: USB Camera', vendorId: 0x0bda, productId: 0x5830 },
      { id: '/dev/video10', label: 'video10' },
    ]);
  });
  it('lists macOS cameras without screens, with the USB IDs macOS reports for a name unless it has two pairs', async () => {
    const avfoundation = [
      '[AVFoundation indev @ 0x7b0f018140] AVFoundation video devices:',
      '[AVFoundation indev @ 0x7b0f018140] [0] USB Camera',
      '[AVFoundation indev @ 0x7b0f018140] [1] FaceTime HD Camera',
      '[AVFoundation indev @ 0x7b0f018140] [2] Webcam',
      '[AVFoundation indev @ 0x7b0f018140] [3] Capture screen 0',
      '[AVFoundation indev @ 0x7b0f018140] AVFoundation audio devices:',
      '[AVFoundation indev @ 0x7b0f018140] [0] MacBook Pro Microphone',
    ].join('\n');
    const cameraData = JSON.stringify({
      SPCameraDataType: [
        { _name: 'USB Camera', 'spcamera_model-id': 'UVC Camera VendorID_3034 ProductID_22592' },
        { _name: 'FaceTime HD Camera', 'spcamera_model-id': 'FaceTime HD Camera' },
        { _name: 'Webcam', 'spcamera_model-id': 'UVC Camera VendorID_1133 ProductID_2141' },
        { _name: 'Webcam', 'spcamera_model-id': 'UVC Camera VendorID_1133 ProductID_2142' },
      ],
    });
    const exec = vi.fn((program) =>
      Promise.resolve(
        program === '/usr/sbin/system_profiler'
          ? { code: 0, stdout: cameraData, stderr: '', timedOut: false }
          : { code: 1, stdout: '', stderr: avfoundation, timedOut: false },
      ),
    );
    expect(await listDevices('darwin', () => 'ffmpeg', undefined, exec)).toEqual([
      { id: '0', label: 'USB Camera', vendorId: 0x0bda, productId: 0x5840 },
      { id: '1', label: 'FaceTime HD Camera' },
      { id: '2', label: 'Webcam' },
    ]);
    exec.mockImplementation((program) =>
      program === '/usr/sbin/system_profiler'
        ? Promise.reject(new Error('ENOENT'))
        : Promise.resolve({ code: 1, stdout: '', stderr: avfoundation, timedOut: false }),
    );
    expect((await listDevices('darwin', () => 'ffmpeg', undefined, exec))[0]).toEqual({
      id: '0',
      label: 'USB Camera',
    });
  });
  it('reads no USB IDs from camera data that is not JSON or has no camera list', () => {
    expect(parseCameraData('')).toEqual(new Map());
    expect(parseCameraData('{"SPCameraDataType": {}}')).toEqual(new Map());
    expect(parseCameraData('{"SPCameraDataType": [null, {"_name": 1}]}')).toEqual(new Map());
  });
  it('reads the USB IDs of DirectShow devices from their alternative names', async () => {
    const dshow = [
      '[dshow @ 000001] "USB Camera" (video)',
      '[dshow @ 000001]   Alternative name "@device_pnp_\\\\?\\usb#vid_0bda&pid_5830&mi_00#6&2f2c3e5&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\\global"',
      '[dshow @ 000001] "OBS Virtual Camera" (video)',
      '[dshow @ 000001]   Alternative name "@device_sw_{860BB310-5D01-11D0-BD3B-00A0C911CE86}\\{A3FCE0F5-3493-419F-958A-ABA1250EC20B}"',
      '[dshow @ 000001] "Microphone (Realtek Audio)" (audio)',
    ].join('\n');
    const exec = () => Promise.resolve({ code: 1, stdout: '', stderr: dshow, timedOut: false });
    expect(await listDevices('win32', () => 'ffmpeg', undefined, exec)).toEqual([
      { id: 'USB Camera', label: 'USB Camera', vendorId: 0x0bda, productId: 0x5830 },
      { id: 'OBS Virtual Camera', label: 'OBS Virtual Camera' },
    ]);
  });
  it('asks each platform input for the modes of a valid device only', () => {
    expect(modesArgs('darwin', '1')).toEqual([
      '-hide_banner',
      '-nostdin',
      '-f',
      'avfoundation',
      '-framerate',
      '1',
      '-video_size',
      '1x1',
      '-i',
      '1:none',
    ]);
    expect(modesArgs('linux', '/dev/video2')).toEqual([
      '-hide_banner',
      '-nostdin',
      '-f',
      'v4l2',
      '-list_formats',
      'all',
      '-i',
      '/dev/video2',
    ]);
    expect(modesArgs('win32', 'USB Camera').slice(-4)).toEqual([
      '-list_options',
      'true',
      '-i',
      'video=USB Camera',
    ]);
    for (const [platform, device] of [
      ['darwin', '1:0'],
      ['linux', '/etc/passwd'],
      ['win32', ''],
      ['freebsd', '0'],
    ])
      expect(() => modesArgs(platform, device)).toThrow('Invalid capture selection');
  });
  it('reads the modes each platform input reports', async () => {
    const avfoundation = [
      '[in#0 @ 0x79a940c000] Selected video size (1x1) is not supported by the device.',
      '[in#0 @ 0x79a940c000] Supported modes:',
      '[in#0 @ 0x79a940c000]   256x192@[25.000000 25.000000]fps',
      '[in#0 @ 0x79a940c000]   256x384@[25.000000 25.000000]fps',
      '[in#0 @ 0x79a940c000]   256x384@[25.000000 25.000000]fps',
      '[in#0 @ 0x79a9408000] Error opening input: Input/output error',
    ].join('\n');
    const exec = vi.fn(() =>
      Promise.resolve({ code: 251, stdout: '', stderr: avfoundation, timedOut: false }),
    );
    expect(await listModes('darwin', '0', () => 'ffmpeg', exec)).toEqual([
      { width: 256, height: 192, minFps: 25, maxFps: 25 },
      { width: 256, height: 384, minFps: 25, maxFps: 25 },
    ]);
    const signal = new AbortController().signal;
    await listModes('darwin', '0', () => 'ffmpeg', exec, signal);
    expect(exec).toHaveBeenLastCalledWith('ffmpeg', modesArgs('darwin', '0'), 10000, signal);
    // AVFoundation opens a format only at its maximum rate, and reports it unrounded.
    expect(
      parseDeviceModes(
        'darwin',
        [
          '[in#0 @ 0x7ad5808000] Supported modes:',
          '[in#0 @ 0x7ad5808000]   1280x720@[1.000000 30.000030]fps',
          '[in#0 @ 0x7ad5808000]   1280x720@[15.000000 30.000030]fps',
          '[in#0 @ 0x7ad5808000]   1280x720@[60.000000 60.000000]fps',
        ].join('\n'),
      ),
    ).toEqual([
      { width: 1280, height: 720, minFps: 30.00003, maxFps: 30.00003 },
      { width: 1280, height: 720, minFps: 60, maxFps: 60 },
    ]);
    const v4l2 = [
      '[video4linux2,v4l2 @ 0x55d5c4a0c840] Compressed:       mjpeg :          Motion-JPEG : 1280x720 640x480',
      '[video4linux2,v4l2 @ 0x55d5c4a0c840] Raw       :     yuyv422 :           YUYV 4:2:2 : 256x384 256x192',
      '[video4linux2,v4l2 @ 0x55d5c4a0c840] Raw       :     nv12 :           Y/CbCr 4:2:0 : 640x480',
      '/dev/video2: Immediate exit requested',
    ].join('\n');
    expect(parseDeviceModes('linux', v4l2)).toEqual([
      { width: 256, height: 384 },
      { width: 256, height: 192 },
    ]);
    const stepwise =
      '[video4linux2,v4l2 @ 0x1] Raw       :     yuyv422 :           YUYV 4:2:2 : {8-1920, 8}x{8-1080, 8}';
    expect(parseDeviceModes('linux', stepwise)).toEqual([]);
    const dshow = [
      '[dshow @ 000001] DirectShow video device options (from video devices)',
      '[dshow @ 000001]  Pin "Capture" (alternative pin name "0")',
      '[dshow @ 000001]   pixel_format=yuyv422  min s=256x384 fps=25 max s=256x384 fps=25',
      '[dshow @ 000001]   pixel_format=yuyv422  min s=256x384 fps=25 max s=256x384 fps=25 (tv, bt470bg/bt709/unknown, topleft)',
      '[dshow @ 000001]   pixel_format=yuyv422  min s=320x240 fps=5 max s=640x480 fps=30',
      '[dshow @ 000001]   vcodec=mjpeg  min s=1280x720 fps=30 max s=1280x720 fps=30',
    ].join('\n');
    expect(parseDeviceModes('win32', dshow)).toEqual([
      { width: 256, height: 384, minFps: 25, maxFps: 25 },
    ]);
    exec.mockResolvedValueOnce({ code: null, stdout: '', stderr: '', timedOut: true });
    await expect(listModes('darwin', '0', () => 'ffmpeg', exec)).rejects.toThrow(
      'Reading the camera modes timed out',
    );
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

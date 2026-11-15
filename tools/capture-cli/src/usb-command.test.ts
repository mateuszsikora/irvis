import { afterEach, describe, expect, it, vi } from 'vitest';
import { usbCommand } from './usb-command.ts';

const mock = vi.hoisted(() => ({
  detach: vi.fn(),
  attach: vi.fn(),
  close: vi.fn(),
  stop: vi.fn(() => Promise.resolve()),
}));
vi.mock('usb', () => ({
  getDeviceList: () => [
    {
      busNumber: 1,
      deviceAddress: 1,
      deviceDescriptor: { idVendor: 0x0bda, idProduct: 0x5830 },
      configDescriptor: {},
      interfaces: [
        {
          interfaceNumber: 0,
          isKernelDriverActive: () => true,
          detachKernelDriver: mock.detach,
          attachKernelDriver: mock.attach,
        },
      ],
      open() {},
      close: mock.close,
      controlTransfer(
        _type: number,
        _request: number,
        _value: number,
        _index: number,
        data: Buffer | number,
        cb: (error: undefined, data: Buffer) => void,
      ) {
        cb(undefined, Buffer.alloc(typeof data === 'number' ? data : 0));
      },
    },
  ],
}));
vi.mock('./usb-video.ts', () => ({
  observeVideo: () => {
    // Interrupt only after video starts and session handlers are registered.
    queueMicrotask(() => process.emit('SIGTERM'));
    return { check() {}, stop: mock.stop };
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('USB session cancellation', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'reattaches and closes after %s and removes handlers',
    async (signal) => {
      const listeners = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
      const exitCode = process.exitCode;
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        if (String(chunk).includes('"event":"command-end"')) process.emit(signal);
        return true;
      });
      try {
        await usbCommand(['watch', '--detach', '--seconds', '3600']);
        expect(mock.detach).toHaveBeenCalledOnce();
        expect(mock.attach).toHaveBeenCalledOnce();
        expect(mock.close).toHaveBeenCalledOnce();
        expect(process.exitCode).toBe(signal === 'SIGINT' ? 130 : 143);
        expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(
          listeners,
        );
      } finally {
        process.exitCode = exitCode;
      }
    },
  );

  it('stops ffmpeg when interrupted during startup', async () => {
    const exitCode = process.exitCode;
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await usbCommand(['watch', '--video', '0']);
      expect(mock.stop).toHaveBeenCalledOnce();
      expect(mock.close).toHaveBeenCalledOnce();
      expect(output.mock.calls.some(([s]) => String(s).includes('"event":"command-start"'))).toBe(
        false,
      );
    } finally {
      process.exitCode = exitCode;
    }
  });
});

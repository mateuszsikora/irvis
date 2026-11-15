import { afterEach, expect, it, vi } from 'vitest';
import { probeUsb } from './usb.ts';

interface RuntimeWebUsb {
  getDevices(): Promise<unknown[]>;
  // Replace only native discovery; exercise the library's real authorization filter.
  loadDevices(filters?: unknown): Promise<unknown[]>;
}

async function installedUsb() {
  const name = 'usb';
  return (await import(name)) as {
    getDeviceList: unknown;
    WebUSB: { new (): RuntimeWebUsb; prototype: RuntimeWebUsb };
  };
}

function device(vendorId: number, productId: number) {
  const descriptor = new Uint8Array([9, 2, 9, 0, 0, 1, 0, 128, 50]);
  return {
    vendorId,
    productId,
    manufacturerName: 'test',
    productName: 'camera',
    serialNumber: '',
    usbVersionMajor: 2,
    usbVersionMinor: 0,
    deviceVersionMajor: 1,
    deviceVersionMinor: 0,
    deviceVersionSubminor: 0,
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    configurations: [],
    open: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    controlTransferIn: vi.fn(() => Promise.resolve({ data: new DataView(descriptor.buffer) })),
  };
}

afterEach(() => vi.restoreAllMocks());

it('loads legacy enumeration and the WebUSB constructor from the installed USB package', async () => {
  // Import only: no device enumeration, opening or transfers in CI.
  const module = await installedUsb();
  expect(typeof module.getDeviceList).toBe('function');
  expect(typeof module.WebUSB).toBe('function');
});

it('authorizes the requested camera before WebUSB filtering and reads its descriptors', async () => {
  const module = await installedUsb();
  const camera = device(0x0bda, 0x5840);
  const unrelated = device(0x1234, 0x5678);
  const load = vi
    .spyOn(module.WebUSB.prototype, 'loadDevices')
    .mockResolvedValue([camera, unrelated]);
  const ids = [{ vendorId: camera.vendorId, productId: camera.productId }];
  const lines = await probeUsb({ ids });
  expect(load).toHaveBeenCalledWith(ids);
  expect(lines.join('\n')).toContain('USB 0x0bda:0x5840');
  expect(lines.join('\n')).toContain('configuration 1: 0 interface(s), total 9 B');
  expect(camera.open).toHaveBeenCalledOnce();
  expect(camera.controlTransferIn).toHaveBeenCalledTimes(2);
  expect(camera.close).toHaveBeenCalledOnce();
  expect(unrelated.open).not.toHaveBeenCalled();
});

it('authorizes all devices for an empty probe ID list', async () => {
  const module = await installedUsb();
  const camera = device(0x0bda, 0x5840);
  const other = device(0x1234, 0x5678);
  const load = vi.spyOn(module.WebUSB.prototype, 'loadDevices').mockResolvedValue([camera, other]);
  const lines = await probeUsb({ ids: [] });
  expect(load).toHaveBeenCalledWith(undefined);
  expect(lines.join('\n')).toContain('USB 0x0bda:0x5840');
  expect(lines.join('\n')).toContain('USB 0x1234:0x5678');
  expect(camera.close).toHaveBeenCalledOnce();
  expect(other.close).toHaveBeenCalledOnce();
});

it('reports no devices when native discovery is empty', async () => {
  const module = await installedUsb();
  vi.spyOn(module.WebUSB.prototype, 'loadDevices').mockResolvedValue([]);
  expect(await probeUsb({ ids: [] })).toEqual(['no USB devices found']);
});

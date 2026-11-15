import { expect, it } from 'vitest';

it('loads both legacy transfers and WebUSB enumeration from the installed USB package', async () => {
  // Import only: no device enumeration, opening or transfers in CI.
  const name = 'usb';
  const module = (await import(name)) as {
    getDeviceList: unknown;
    webusb: { getDevices: unknown };
  };
  expect(typeof module.getDeviceList).toBe('function');
  expect(typeof module.webusb.getDevices).toBe('function');
});

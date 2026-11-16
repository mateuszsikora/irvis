import { run } from '../../../tools/capture-cli/src/ffmpeg.ts';
import { CameraUsb } from '../../../tools/capture-cli/src/usb-protocol.ts';
import { usbProtocol } from '../../../packages/core/src/cameras/infiray-p2pro/profile.ts';

/** Serialize all EP0 transactions; never claim or detach the UVC interface. */
export async function openControl(profile, helper) {
  if (profile.id !== 'infiray-p2pro')
    throw new Error('Camera control is unsupported for this profile');
  const packageName = 'usb';
  const { getDeviceList } = await import(packageName);
  const matches = getDeviceList().filter((d) =>
    profile.identification.usb.some(
      (u) =>
        u.vendorId === d.deviceDescriptor.idVendor && u.productId === d.deviceDescriptor.idProduct,
    ),
  );
  if (matches.length !== 1)
    throw new Error('Camera control requires exactly one matching USB camera');
  const device = matches[0];
  if (!helper) device.open();
  device.timeout = 1000;
  const transfer = helper
    ? async (type, request, value, index, data) => {
        const result = await run(
          helper,
          [
            device.deviceDescriptor.idVendor,
            device.deviceDescriptor.idProduct,
            device.deviceAddress,
            type,
            request,
            value,
            index,
            typeof data === 'number' ? data : data.toString('hex'),
            device.busNumber,
          ].map(String),
          2000,
        );
        if (result.code !== 0 || result.timedOut)
          throw new Error('IOKit request failed: ' + result.stderr);
        return Buffer.from(result.stdout.trim(), 'hex');
      }
    : (...args) =>
        new Promise((resolve, reject) => {
          device.controlTransfer(...args, (error, data) =>
            error ? reject(error) : resolve(Buffer.isBuffer(data) ? data : Buffer.alloc(0)),
          );
        });
  const camera = new CameraUsb((...args) => {
    if (closed) return Promise.reject(new Error('Camera control is closed'));
    return transfer(...args);
  });
  let closing;
  let polling = false;
  let busy = false;
  let closed = false,
    queue = Promise.resolve(),
    snapshot = { origin: 'assumed', values: {} };
  const serial = (fn) => {
    const result = queue.then(() => {
      if (closed) throw new Error('Camera control is closed');
      busy = true;
      return Promise.resolve()
        .then(fn)
        .finally(() => {
          busy = false;
        });
    });
    queue = result.catch(() => {});
    return result;
  };
  async function readState() {
    const raw = await camera.state();
    const values = { gain: 'unknown' };
    for (const [key, value] of Object.entries(raw)) {
      if (
        key === 'gain'
          ? value === 0 || value === 1
          : typeof value === 'number' || typeof value === 'string'
      )
        values[key === 'gain' ? 'gain' : `usb-${key}`] =
          key === 'gain' ? (value === 1 ? 'high' : 'low') : value;
    }
    snapshot = { origin: Object.keys(values).length ? 'camera' : 'assumed', values };
    return snapshot;
  }
  const timer = setInterval(() => {
    if (closed || polling) return;
    polling = true;
    void serial(async () => {
      const bytes = await camera.standard(
        usbProtocol.sensorTemperature,
        usbProtocol.sensorTemperatureReadLength,
      );
      snapshot = {
        ...snapshot,
        values: { ...snapshot.values, 'usb-cur_vtemp': bytes.toString('hex') },
      };
    })
      .catch(() => {
        snapshot = {
          ...snapshot,
          values: Object.fromEntries(
            Object.entries(snapshot.values).filter(([k]) => k !== 'usb-cur_vtemp'),
          ),
        };
      })
      .finally(() => {
        polling = false;
      });
  }, 1000);
  return {
    get busy() {
      return busy;
    },
    get snapshot() {
      return snapshot;
    },
    read: () => serial(readState),
    command: (id) =>
      serial(async () => {
        const command = profile.commands.find((c) => c.id === id);
        if (!command) throw new Error('Unknown camera command');
        try {
          await camera.ready();
          for (const t of [command.transport, ...(command.followUp ?? [])]) {
            if (t.kind !== 'vendor-control') throw new Error('Unsupported command transport');
            await camera.transfer(t.requestType, t.request, t.value, t.index, Buffer.from(t.data));
          }
          await camera.ready();
        } finally {
          await readState();
        }
      }),
    close() {
      if (closing) return closing;
      closed = true;
      clearInterval(timer);
      closing = queue.then(() => {
        if (!helper) device.close();
      });
      return closing;
    },
  };
}

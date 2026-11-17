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
  let commandPending = false;
  let commandGeneration = 0;
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
    if (commandGeneration) values['command-generation'] = commandGeneration;
    for (const [key, value] of Object.entries(raw)) {
      if (
        key === 'gain'
          ? value === 0 || value === 1
          : typeof value === 'number' || typeof value === 'string'
      )
        values[key === 'gain' ? 'gain' : `usb-${key}`] =
          key === 'gain' ? (value === 1 ? 'high' : 'low') : value;
    }
    values.emissivity =
      typeof raw.ems === 'number' && raw.ems > 0 && raw.ems <= 128 ? raw.ems / 128 : 'unknown';
    values['reflected-temperature'] =
      typeof raw.tu === 'number' && raw.tu > 0 && raw.tu <= 1024 ? raw.tu - 273.15 : 'unknown';
    snapshot = { origin: 'camera', values };
    if (!stateUnknown()) {
      fullReadDelay = FIRST_FULL_READ_DELAY;
      nextFullRead = 0;
    }
    return snapshot;
  }
  // Unknown gain blocks readings and unknown EMS/TU blocks Host correction, so the
  // poll repeats the full state read, backing off so a persistent failure keeps video.
  const FIRST_FULL_READ_DELAY = 1000;
  const MAX_FULL_READ_DELAY = 30000;
  let fullReadDelay = FIRST_FULL_READ_DELAY;
  let nextFullRead = 0;
  function stateUnknown() {
    return (
      snapshot.origin === 'camera' &&
      ['gain', 'emissivity', 'reflected-temperature'].some((k) => snapshot.values[k] === 'unknown')
    );
  }
  const timer = setInterval(() => {
    if (closed || polling) return;
    polling = true;
    void serial(async () => {
      if (stateUnknown() && Date.now() >= nextFullRead) {
        try {
          await readState();
        } finally {
          if (stateUnknown()) {
            nextFullRead = Date.now() + fullReadDelay;
            fullReadDelay = Math.min(fullReadDelay * 2, MAX_FULL_READ_DELAY);
          }
        }
        return;
      }
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
      return busy || commandPending;
    },
    get snapshot() {
      return snapshot;
    },
    read: () => serial(readState),
    async command(id, value) {
      if (closed) throw new Error('Camera control is closed');
      const command = profile.commands.find((c) => c.id === id);
      if (!command) throw new Error('Unknown camera command');
      const parameter = command.parameter;
      let encoded;
      if (parameter) {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < parameter.min ||
          value > parameter.max
        )
          throw new Error('Camera command value is outside the supported range');
        encoded = Math.round(value * parameter.scale + parameter.offset);
      } else if (value !== undefined) {
        throw new Error('Camera command does not accept a value');
      }
      if (commandPending) throw new Error('Camera command is already in progress');
      commandPending = true;
      try {
        await serial(async () => {
          // Never retain a pre-command gain if a write or its readback fails.
          commandGeneration++;
          snapshot = {
            origin: 'camera',
            values: { gain: 'unknown', 'command-generation': commandGeneration },
          };
          try {
            await camera.ready();
            for (const [index, t] of [command.transport, ...(command.followUp ?? [])].entries()) {
              if (t.kind !== 'vendor-control') throw new Error('Unsupported command transport');
              const data = Buffer.from(t.data);
              if (index === 0 && parameter) data.writeUInt32BE(encoded, parameter.byteOffset);
              await camera.transfer(t.requestType, t.request, t.value, t.index, data);
            }
            await camera.ready();
          } finally {
            await readState();
          }
          if (parameter && snapshot.values[parameter.readback] !== encoded)
            throw new Error('Camera did not confirm the requested setting');
          const expected = id === 'gain-high' ? 'high' : id === 'gain-low' ? 'low' : undefined;
          if (expected && snapshot.values.gain !== expected)
            throw new Error('Camera did not confirm the requested gain');
        });
      } finally {
        commandPending = false;
      }
    },
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

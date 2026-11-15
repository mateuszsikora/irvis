import { run } from './ffmpeg.ts';
import { parseArgs } from 'node:util';
import { appendFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { profile } from '../../../packages/core/src/cameras/infiray-p2pro/profile.ts';
import { CameraUsb, TPD_MAX, TPD_NAMES, type Transfer } from './usb-protocol.ts';
import { CliError } from './errors.ts';
import { observeVideo } from './usb-video.ts';

interface UsbInterface {
  interfaceNumber: number;
  isKernelDriverActive(): boolean;
  detachKernelDriver(): void;
  attachKernelDriver(): void;
}
interface Device {
  busNumber: number;
  deviceAddress: number;
  deviceDescriptor: { idVendor: number; idProduct: number };
  configDescriptor: unknown;
  interfaces: UsbInterface[];
  timeout: number;
  open(): void;
  close(): void;
  controlTransfer(
    type: number,
    request: number,
    value: number,
    index: number,
    data: Buffer | number,
    callback: (error: Error | undefined, data?: Buffer | number) => void,
  ): void;
}
const USB_PACKAGE = 'usb';

export async function usbCommand(args: readonly string[]): Promise<string> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      iokit: { type: 'string' },
      out: { type: 'string' },
      device: { type: 'string' },
      seconds: { type: 'string', default: '12' },
      detach: { type: 'boolean', default: false },
      video: { type: 'string' },
    },
  });
  const [command = 'list', arg, raw] = positionals;
  const seconds = Number(values.seconds);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600)
    throw new CliError('--seconds must be 1..3600');
  const arity: Record<string, number> = {
    list: 1,
    state: 1,
    watch: 1,
    nuc: 1,
    gain: 2,
    tpd: 3,
    palette: 2,
  };
  if (!(command in arity) || positionals.length > (arity[command] ?? 0))
    throw new CliError('invalid usb command or arguments');
  if (command === 'gain' && arg !== 'high' && arg !== 'low')
    throw new CliError('gain must be high or low');
  const id = TPD_NAMES.indexOf(arg as (typeof TPD_NAMES)[number]);
  const value = Number(raw);
  if (
    command === 'tpd' &&
    (id < 0 ||
      raw === undefined ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > (TPD_MAX[id] ?? -1))
  )
    throw new CliError('tpd requires distance|tu|ta|ems|tau|gain and a valid raw integer');
  if (
    command === 'palette' &&
    (!arg ||
      !Number.isInteger(Number(arg)) ||
      Number(arg) < 1 ||
      Number(arg) > 11 ||
      Number(arg) === 2)
  )
    throw new CliError('palette requires 1 or 3..11');
  if (values.iokit && (process.platform !== 'darwin' || values.detach || command === 'list'))
    throw new CliError('--iokit requires macOS and a command without --detach');
  if (values.detach && values.video !== undefined)
    throw new CliError('--detach is diagnostics only: stop the stream and omit --video');
  if (!['darwin', 'linux'].includes(process.platform))
    throw new CliError('USB spike runs on macOS and Linux');
  if (values.out) writeFileSync(values.out, '', { flag: 'wx' });
  const log = (event: string, data: unknown): void => {
    const line = JSON.stringify({ time: new Date().toISOString(), event, data }) + '\n';
    if (values.out) appendFileSync(values.out, line);
    process.stdout.write(line);
  };
  log('session', {
    platform: process.platform,
    node: process.version,
    command,
    args,
    attempt: values.iokit
      ? 'c-IOKit-DeviceRequest'
      : values.detach
        ? 'b-detach-no-stream'
        : 'a-EP0-no-claim',
  });
  if (command === 'nuc') {
    log('unsupported', 'NUC opcode is unknown; no transfer sent. See docs/protocol.md.');
    throw new CliError(
      'NUC is not established for this camera; record automatic shutter events instead',
    );
  }
  const module = (await import(USB_PACKAGE)) as { getDeviceList(): Device[] };
  const devices = module
    .getDeviceList()
    .filter((d) =>
      profile.identification.usb.some(
        (u) =>
          u.vendorId === d.deviceDescriptor.idVendor &&
          u.productId === d.deviceDescriptor.idProduct,
      ),
    );
  log(
    'devices',
    devices.map((d) => ({
      address: `${String(d.busNumber)}:${String(d.deviceAddress)}`,
      descriptor: d.deviceDescriptor,
      configuration: d.configDescriptor,
    })),
  );
  if (command !== 'list' && values.device === undefined && devices.length !== 1)
    throw new CliError('select one camera with --device <bus>:<address>');
  const selected =
    values.device === undefined
      ? devices
      : devices.filter(
          (d) => `${String(d.busNumber)}:${String(d.deviceAddress)}` === values.device,
        );
  if (selected.length === 0) throw new CliError('no matching USB camera');
  const cancellation = new AbortController();
  let interrupted: NodeJS.Signals | undefined;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (interrupted) return;
    interrupted = signal;
    cancellation.abort();
  };
  const onInt = (): void => onSignal('SIGINT');
  const onTerm = (): void => onSignal('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    for (const device of selected) {
      cancellation.signal.throwIfAborted();
      let opened = false;
      const detached: UsbInterface[] = [];
      let video: ReturnType<typeof observeVideo> | undefined;
      try {
        if (!values.iokit) {
          device.open();
          opened = true;
          device.timeout = 1000;
        }
        for (const iface of values.iokit ? [] : device.interfaces) {
          try {
            log('kernel', {
              interface: iface.interfaceNumber,
              active: iface.isKernelDriverActive(),
            });
          } catch (error) {
            log('kernel', { interface: iface.interfaceNumber, unknown: String(error) });
          }
        }
        if (command === 'list') continue;
        if (values.detach) {
          const iface = device.interfaces.find((i) => i.interfaceNumber === 0);
          if (!iface) throw new Error('interface 0 not found');
          iface.detachKernelDriver();
          detached.push(iface);
          log('detached', 0);
        }
        const nodeTransfer: Transfer = (type, request, value, index, data) =>
          new Promise((resolve, reject) => {
            device.controlTransfer(type, request, value, index, data, (error, result) => {
              log('transfer', {
                type,
                request,
                value,
                index,
                payload: typeof data === 'number' ? data : data.toString('hex'),
                response: Buffer.isBuffer(result) ? result.toString('hex') : result,
                error: error?.message,
              });
              if (error) reject(error);
              else resolve(Buffer.isBuffer(result) ? result : Buffer.alloc(0));
            });
          });
        const transport: Transfer = values.iokit
          ? async (type, request, value, index, data) => {
              const result = await run(
                values.iokit ?? '',
                [
                  String(device.deviceDescriptor.idVendor),
                  String(device.deviceDescriptor.idProduct),
                  String(device.deviceAddress),
                  String(type),
                  String(request),
                  String(value),
                  String(index),
                  typeof data === 'number' ? String(data) : data.toString('hex'),
                  String(device.busNumber),
                ],
                2000,
              );
              log('iokit-transfer', {
                type,
                request,
                value,
                index,
                data: typeof data === 'number' ? data : data.toString('hex'),
                ...result,
              });
              if (result.code !== 0 || result.timedOut)
                throw new Error(`IOKit request failed: ${result.stderr}`);
              return Buffer.from(result.stdout.trim(), 'hex');
            }
          : nodeTransfer;
        const transfer: Transfer = async (...args) => {
          cancellation.signal.throwIfAborted();
          const result = await transport(...args);
          cancellation.signal.throwIfAborted();
          return result;
        };
        const camera = new CameraUsb(transfer);
        if (values.video !== undefined) {
          video = observeVideo(values.video, log);
          await delay(4000, undefined, { signal: cancellation.signal });
          video.check();
        }
        log('state-before', await camera.state());
        cancellation.signal.throwIfAborted();
        video?.check();
        log('command-start', command);
        try {
          if (command === 'gain') await camera.gain(arg ?? '');
          if (command === 'tpd') await camera.tpd(id, value);
          if (command === 'palette') await camera.palette(Number(arg));
        } finally {
          if (!cancellation.signal.aborted) log('state-after', await camera.state());
        }
        cancellation.signal.throwIfAborted();
        log('command-end', command);
        if (video || command === 'watch') {
          const end = performance.now() + seconds * 1000;
          while (performance.now() < end) {
            cancellation.signal.throwIfAborted();
            const start = performance.now();
            if (command === 'watch') log('state-sample', await camera.state());
            video?.check();
            await delay(Math.max(0, 1000 - (performance.now() - start)), undefined, {
              signal: cancellation.signal,
            });
          }
        }
      } catch (error) {
        log('error', String(error));
        throw error;
      } finally {
        try {
          if (video) await video.stop();
        } finally {
          for (const iface of detached.reverse()) {
            try {
              iface.attachKernelDriver();
              log('reattached', iface.interfaceNumber);
            } catch (error) {
              log('reattach-error', String(error));
            }
          }
          if (opened) device.close();
        }
      }
    }
    cancellation.signal.throwIfAborted();
  } catch (error) {
    if (!interrupted) throw error;
    log('interrupted', interrupted);
    process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }
  return '';
}

// The USB half of `probe`: devices, descriptors and the UVC class-specific
// descriptors through node-usb. Output format:
// docs/features/capture-cli-technical.md#interfaces

const hex = (value: number, digits: number): string =>
  `0x${value.toString(16).padStart(digits, '0')}`;

/** A GUID in its usual text form; the first three fields are little-endian in USB descriptors. */
export function guid(bytes: Uint8Array): string {
  const b = (i: number): string => (bytes[i] ?? 0).toString(16).padStart(2, '0');
  const le = (from: number, length: number): string =>
    Array.from({ length }, (_, k) => b(from + length - 1 - k)).join('');
  const be = (from: number, length: number): string =>
    Array.from({ length }, (_, k) => b(from + k)).join('');
  return `${le(0, 4)}-${le(4, 2)}-${le(6, 2)}-${be(8, 2)}-${be(10, 6)}`;
}

function fourcc(bytes: Uint8Array): string {
  const chars = Array.from(bytes.subarray(0, 4), (c) =>
    c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.',
  );
  return chars.join('');
}

const VC_SUBTYPES: Record<number, string> = {
  0x01: 'VC_HEADER',
  0x02: 'VC_INPUT_TERMINAL',
  0x03: 'VC_OUTPUT_TERMINAL',
  0x04: 'VC_SELECTOR_UNIT',
  0x05: 'VC_PROCESSING_UNIT',
  0x06: 'VC_EXTENSION_UNIT',
};

const VS_SUBTYPES: Record<number, string> = {
  0x01: 'VS_INPUT_HEADER',
  0x02: 'VS_OUTPUT_HEADER',
  0x03: 'VS_STILL_IMAGE_FRAME',
  0x04: 'VS_FORMAT_UNCOMPRESSED',
  0x05: 'VS_FRAME_UNCOMPRESSED',
  0x06: 'VS_FORMAT_MJPEG',
  0x07: 'VS_FRAME_MJPEG',
  0x0d: 'VS_COLORFORMAT',
};

/**
 * One line per descriptor of a configuration descriptor (as read with
 * GET_DESCRIPTOR), with the UVC class-specific ones decoded: formats, frame
 * sizes and intervals, and extension units with their GUIDs.
 */
export function describeConfiguration(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  let videoSubclass = 0;
  let offset = 0;
  while (offset + 2 <= bytes.length) {
    const length = bytes[offset] ?? 0;
    const type = bytes[offset + 1] ?? 0;
    if (length < 2 || offset + length > bytes.length) {
      lines.push(`malformed descriptor at byte ${String(offset)}`);
      break;
    }
    const d = bytes.subarray(offset, offset + length);
    const u8 = (i: number): number => d[i] ?? 0;
    const u16 = (i: number): number => u8(i) | (u8(i + 1) << 8);
    const u32 = (i: number): number => (u16(i) | (u16(i + 2) << 16)) >>> 0;
    if (type === 0x02) {
      lines.push(
        `configuration ${String(u8(5))}: ${String(u8(4))} interface(s), total ${String(u16(2))} B`,
      );
    } else if (type === 0x0b) {
      lines.push(
        `interface association: first ${String(u8(2))}, count ${String(u8(3))}, class ${hex(u8(4), 2)}`,
      );
    } else if (type === 0x04) {
      videoSubclass = u8(5) === 0x0e ? u8(6) : 0;
      lines.push(
        `interface ${String(u8(2))} alt ${String(u8(3))}: class ${hex(u8(5), 2)} subclass ${hex(u8(6), 2)} protocol ${hex(u8(7), 2)}, ${String(u8(4))} endpoint(s)`,
      );
    } else if (type === 0x05) {
      const address = u8(2);
      const kinds = ['control', 'isochronous', 'bulk', 'interrupt'];
      lines.push(
        `  endpoint ${hex(address, 2)} ${address & 0x80 ? 'in' : 'out'} ${kinds[u8(3) & 3] ?? '?'}, max packet ${String(u16(4) & 0x7ff)} × ${String(((u16(4) >> 11) & 3) + 1)}`,
      );
    } else if (type === 0x24 && videoSubclass === 0x01) {
      const subtype = u8(2);
      const name = VC_SUBTYPES[subtype] ?? `VC subtype ${hex(subtype, 2)}`;
      if (subtype === 0x06) {
        lines.push(
          `  ${name} id ${String(u8(3))}: guid ${guid(d.subarray(4, 20))}, ${String(u8(20))} control(s)`,
        );
      } else if (subtype === 0x02 || subtype === 0x05) {
        lines.push(`  ${name} id ${String(u8(3))}`);
      } else {
        lines.push(`  ${name}`);
      }
    } else if (type === 0x24 && videoSubclass === 0x02) {
      const subtype = u8(2);
      const name = VS_SUBTYPES[subtype] ?? `VS subtype ${hex(subtype, 2)}`;
      if (subtype === 0x04) {
        lines.push(
          `  ${name} ${String(u8(3))}: ${fourcc(d.subarray(5, 21))} (guid ${guid(d.subarray(5, 21))}), ${String(u8(21))} bits per pixel, ${String(u8(4))} frame size(s)`,
        );
      } else if (subtype === 0x05 || subtype === 0x07) {
        const intervals: string[] = [];
        const count = u8(25);
        if (count === 0) {
          intervals.push(
            `continuous ${String(u32(26))} to ${String(u32(30))} step ${String(u32(34))}`,
          );
        }
        for (let k = 0; k < count; k++) {
          const interval = u32(26 + k * 4);
          intervals.push(interval > 0 ? `${(1e7 / interval).toFixed(2)} fps` : '0');
        }
        lines.push(
          `  ${name} ${String(u8(3))}: ${String(u16(5))}×${String(u16(7))}, buffer ${String(u32(17))} B, default ${u32(21) > 0 ? (1e7 / u32(21)).toFixed(2) : '?'} fps, intervals ${intervals.join(', ')}`,
        );
      } else {
        lines.push(`  ${name}`);
      }
    } else {
      lines.push(`  descriptor type ${hex(type, 2)}, ${String(length)} B`);
    }
    offset += length;
  }
  return lines;
}

// The members of node-usb's WebUSB-style API that the probe uses. The package
// is loaded by a computed specifier, so that its declarations, which need the
// DOM library, stay out of this Node project.
interface UsbEndpointLike {
  readonly endpointNumber: number;
  readonly direction: string;
  readonly type: string;
  readonly packetSize: number;
}

interface UsbAlternateLike {
  readonly alternateSetting: number;
  readonly interfaceClass: number;
  readonly interfaceSubclass: number;
  readonly interfaceName?: string | undefined;
  readonly endpoints: readonly UsbEndpointLike[];
}

interface UsbDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  readonly manufacturerName?: string | null | undefined;
  readonly productName?: string | null | undefined;
  readonly serialNumber?: string | null | undefined;
  readonly usbVersionMajor: number;
  readonly usbVersionMinor: number;
  readonly deviceVersionMajor: number;
  readonly deviceVersionMinor: number;
  readonly deviceVersionSubminor: number;
  readonly deviceClass: number;
  readonly deviceSubclass: number;
  readonly deviceProtocol: number;
  readonly configurations: readonly {
    readonly interfaces: readonly {
      readonly interfaceNumber: number;
      readonly alternates: readonly UsbAlternateLike[];
    }[];
  }[];
  open(): Promise<void>;
  close(): Promise<void>;
  controlTransferIn(
    setup: {
      requestType: 'standard' | 'class' | 'vendor';
      recipient: 'device' | 'interface' | 'endpoint' | 'other';
      request: number;
      value: number;
      index: number;
    },
    length: number,
  ): Promise<{ readonly data?: DataView | undefined }>;
}

interface UsbModule {
  readonly webusb: { getDevices(): Promise<UsbDeviceLike[]> };
}

const USB_PACKAGE = 'usb';

export interface UsbProbeOptions {
  /** Only devices with one of these IDs; all devices when empty. */
  readonly ids: readonly { readonly vendorId: number; readonly productId: number }[];
}

/** Lines describing the matching USB devices. Never throws: errors become lines. */
export async function probeUsb(options: UsbProbeOptions): Promise<string[]> {
  let usbModule: UsbModule;
  try {
    usbModule = (await import(USB_PACKAGE)) as UsbModule;
  } catch (error) {
    return [`node-usb could not be loaded: ${String(error)}`];
  }
  const lines: string[] = [];
  let devices: UsbDeviceLike[];
  try {
    devices = await usbModule.webusb.getDevices();
  } catch (error) {
    return [`listing USB devices failed: ${String(error)}`];
  }
  const wanted = devices.filter(
    (d) =>
      options.ids.length === 0 ||
      options.ids.some((id) => id.vendorId === d.vendorId && id.productId === d.productId),
  );
  if (devices.length === 0) return ['no USB devices found'];
  if (wanted.length === 0) {
    const ids = options.ids
      .map((id) => `${hex(id.vendorId, 4)}:${hex(id.productId, 4)}`)
      .join(', ');
    return [`no USB device with ID ${ids} (${String(devices.length)} other device(s) present)`];
  }
  for (const d of wanted) {
    lines.push(
      `USB ${hex(d.vendorId, 4)}:${hex(d.productId, 4)} "${d.manufacturerName ?? ''}" "${d.productName ?? ''}" serial "${d.serialNumber ?? ''}"`,
      `  USB ${String(d.usbVersionMajor)}.${String(d.usbVersionMinor)}, device ${String(d.deviceVersionMajor)}.${String(d.deviceVersionMinor)}.${String(d.deviceVersionSubminor)}, class ${hex(d.deviceClass, 2)} subclass ${hex(d.deviceSubclass, 2)} protocol ${hex(d.deviceProtocol, 2)}`,
    );
    for (const config of d.configurations) {
      for (const iface of config.interfaces) {
        for (const alt of iface.alternates) {
          const endpoints = alt.endpoints
            .map(
              (e) =>
                `${String(e.endpointNumber)} ${e.direction} ${e.type} ${String(e.packetSize)} B`,
            )
            .join('; ');
          lines.push(
            `  interface ${String(iface.interfaceNumber)} alt ${String(alt.alternateSetting)}: class ${hex(alt.interfaceClass, 2)} subclass ${hex(alt.interfaceSubclass, 2)}${alt.interfaceName ? ` "${alt.interfaceName}"` : ''}${endpoints ? `; endpoints ${endpoints}` : ''}`,
          );
        }
      }
    }
    lines.push(...(await readConfiguration(d)));
  }
  return lines;
}

/** GET_DESCRIPTOR(CONFIGURATION 0) over the control endpoint, decoded. */
async function readConfiguration(d: UsbDeviceLike): Promise<string[]> {
  const setup = {
    requestType: 'standard' as const,
    recipient: 'device' as const,
    request: 0x06,
    value: 0x0200,
    index: 0,
  };
  try {
    await d.open();
  } catch (error) {
    return [
      `  opening the device failed (descriptors above come from the system): ${String(error)}`,
    ];
  }
  try {
    const head = await d.controlTransferIn(setup, 9);
    const total = head.data?.getUint16(2, true) ?? 0;
    const full = await d.controlTransferIn(setup, total);
    if (!full.data) return ['  the configuration descriptor came back empty'];
    const bytes = new Uint8Array(full.data.buffer, full.data.byteOffset, full.data.byteLength);
    return ['  configuration descriptor:', ...describeConfiguration(bytes).map((l) => `    ${l}`)];
  } catch (error) {
    return [`  reading the configuration descriptor failed: ${String(error)}`];
  } finally {
    await d.close().catch(() => undefined);
  }
}

// Protocol knowledge from LeoDJ/P2Pro-Viewer (MIT); see NOTICE and docs/protocol.md.
import { setTimeout as delay } from 'node:timers/promises';
import {
  profile,
  usbProtocol as protocol,
} from '../../../packages/core/src/cameras/infiray-p2pro/profile.ts';

export type Transfer = (
  type: number,
  request: number,
  value: number,
  index: number,
  data: Buffer | number,
) => Promise<Buffer>;
export const TPD_NAMES = protocol.tpdNames;
export const TPD_MAX = protocol.tpdMax;

export class CameraUsb {
  readonly transfer: Transfer;
  constructor(transfer: Transfer) {
    this.transfer = transfer;
  }

  async ready(): Promise<void> {
    const deadline = performance.now() + 5000;
    do {
      const data = await this.transfer(
        protocol.readType,
        protocol.readRequest,
        protocol.value,
        protocol.status,
        1,
      );
      if (data.length !== 1) throw new Error('short USB status');
      const status = data[0] ?? 0;
      if (status & 0xfc) throw new Error(`camera status error: ${String(status)}`);
      if (!(status & 3)) return;
      await delay(10);
    } while (performance.now() < deadline);
    throw new Error('camera ready timeout');
  }

  async read(index: number, length: number): Promise<Buffer> {
    const data = await this.transfer(
      protocol.readType,
      protocol.readRequest,
      protocol.value,
      index,
      length,
    );
    if (data.length !== length)
      throw new Error(`short USB response: ${String(data.length)}/${String(length)}`);
    return data;
  }

  async write(index: number, data: Buffer): Promise<void> {
    await this.transfer(protocol.writeType, protocol.writeRequest, protocol.value, index, data);
  }

  async tpd(id: number, value?: number): Promise<number | null> {
    const max = TPD_MAX[id];
    if (max === undefined || !Number.isInteger(id)) throw new Error('invalid TPD id');
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > max))
      throw new Error('invalid TPD raw value');
    const head = Buffer.alloc(8);
    head.writeUInt16LE(value === undefined ? protocol.tpd : protocol.tpd | protocol.set);
    head.writeUInt16BE(id, 2);
    head.writeUInt32BE(value ?? 0, 4);
    const tail = Buffer.alloc(8);
    tail.writeUInt32BE(value === undefined ? 2 : 0, 4);
    await this.ready();
    await this.write(protocol.longHead, head);
    await this.write(protocol.longTail, tail);
    await this.ready();
    return value === undefined ? (await this.read(protocol.longResult, 2)).readUInt16BE() : null;
  }

  async gain(mode: string): Promise<void> {
    const command = profile.commands.find((c) => c.id === `gain-${mode}`);
    if (!command) throw new Error('gain must be high or low');
    await this.ready();
    for (const t of [command.transport, ...(command.followUp ?? [])]) {
      if (t.kind !== 'vendor-control') throw new Error('unsupported transport');
      await this.transfer(t.requestType, t.request, t.value, t.index, Buffer.from(t.data));
    }
    await this.ready();
  }

  async standard(code: number, length: number): Promise<Buffer> {
    const head = Buffer.alloc(8);
    head.writeUInt16LE(code);
    head.writeUInt16BE(length, 6);
    await this.ready();
    await this.write(protocol.standardHead, head);
    await this.ready();
    return this.read(protocol.longTail, length);
  }

  async palette(value: number): Promise<void> {
    if (!Number.isInteger(value) || value < 1 || value > 11 || value === 2)
      throw new Error('invalid palette (2 is reserved)');
    await this.ready();
    await this.write(protocol.longHead, Buffer.from([9, 0xc4, 0, 0, 0, 0, 0, 1]));
    await this.ready();
    await this.write(protocol.longTail, Buffer.from([value]));
    await this.ready();
  }

  async state(): Promise<Record<string, unknown>> {
    const state: Record<string, unknown> = {};
    for (const [id, name] of TPD_NAMES.entries()) {
      try {
        state[name] = await this.tpd(id);
      } catch (error) {
        state[name] = { error: String(error) };
      }
    }
    for (const [name, code, length] of [
      ['pseudo_color', protocol.palette, 1],
      ['cur_vtemp', protocol.sensorTemperature, protocol.sensorTemperatureReadLength],
    ] as const) {
      try {
        state[name] = (await this.standard(code, length)).toString('hex');
      } catch (error) {
        state[name] = { error: String(error) };
      }
    }
    return state;
  }
}

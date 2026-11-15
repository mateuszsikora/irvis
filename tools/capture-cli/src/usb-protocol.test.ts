import { describe, expect, it, vi } from 'vitest';
import { CameraUsb, type Transfer } from './usb-protocol.ts';
import { frameStats } from './usb-video.ts';

function mock(response = Buffer.from([0, 1])) {
  const calls: {
    type: number;
    request: number;
    value: number;
    index: number;
    data: string | number;
  }[] = [];
  const transfer: Transfer = (type, request, value, index, data) => {
    calls.push({
      type,
      request,
      value,
      index,
      data: typeof data === 'number' ? data : data.toString('hex'),
    });
    return Promise.resolve(
      index === 0x200 ? Buffer.from([0]) : typeof data === 'number' ? response : Buffer.alloc(0),
    );
  };
  return { camera: new CameraUsb(transfer), calls };
}

describe('USB protocol', () => {
  it('encodes gain as two ordered vendor transfers before polling completion', async () => {
    const { camera, calls } = mock();
    await camera.gain('high');
    expect(calls).toEqual([
      { type: 0xc1, request: 0x44, value: 0x78, index: 0x200, data: 1 },
      { type: 0x41, request: 0x45, value: 0x78, index: 0x9d00, data: '14c5000500000001' },
      { type: 0x41, request: 0x45, value: 0x78, index: 0x1d08, data: '0000000000000000' },
      { type: 0xc1, request: 0x44, value: 0x78, index: 0x200, data: 1 },
    ]);
  });
  it('reads TPD with big endian selector, length and response', async () => {
    const { camera, calls } = mock(Buffer.from([1, 44]));
    expect(await camera.tpd(1)).toBe(300);
    expect(calls.map((c) => c.data)).toEqual([1, '1485000100000000', '0000000000000002', 1, 2]);
    expect(calls.at(-1)?.index).toBe(0x1d10);
  });
  it('rejects malformed responses and camera status errors', async () => {
    await expect(mock(Buffer.alloc(1)).camera.tpd(0)).rejects.toThrow('short USB response');
    const camera = new CameraUsb(() => Promise.resolve(Buffer.from([4])));
    await expect(camera.gain('low')).rejects.toThrow('camera status error');
  });
  it('bounds busy polling and never submits a command while busy', async () => {
    vi.useFakeTimers();
    const transfer = vi.fn(() => Promise.resolve(Buffer.from([1])));
    try {
      const outcome = expect(new CameraUsb(transfer).gain('low')).rejects.toThrow(
        'camera ready timeout',
      );
      await vi.advanceTimersByTimeAsync(5100);
      await outcome;
      expect(transfer).toHaveBeenCalledWith(0xc1, 0x44, 0x78, 0x200, 1);
      expect(transfer).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects out-of-range parameters without a transfer', async () => {
    const { camera, calls } = mock();
    await expect(camera.tpd(3, 128)).rejects.toThrow('invalid');
    await expect(camera.palette(2)).rejects.toThrow('invalid');
    await expect(camera.gain('auto')).rejects.toThrow('gain');
    expect(calls).toEqual([]);
  });
  it('records unreadable state fields instead of inventing values', async () => {
    const camera = new CameraUsb(() => Promise.reject(new Error('denied')));
    const state = await camera.state();
    expect(Object.keys(state)).toHaveLength(8);
    expect(state['gain']).toEqual({ error: 'Error: denied' });
  });
  it('separates upper bytes from little endian thermal samples', () => {
    const frame = Buffer.alloc(196608, 20);
    for (let i = 98304; i < frame.length; i += 2) frame.writeUInt16LE(19082, i);
    expect(frameStats(frame)).toEqual({
      upperMean: 20,
      rawMean: 19082,
      rawMin: 19082,
      rawMax: 19082,
    });
    expect(() => frameStats(Buffer.alloc(1))).toThrow('expected');
  });
});

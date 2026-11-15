import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { observeVideo, VIDEO_STALL_MS } from './usb-video.ts';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('./ffmpeg.ts', () => ({ findFfmpeg: () => '/mock/ffmpeg' }));
afterEach(() => vi.restoreAllMocks());

describe('USB video observation', () => {
  it('preserves timestamp gaps and rejects a live process that stops producing frames', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        child.emit('close', 0);
        return true;
      }),
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const video = observeVideo('0', vi.fn());
    try {
      const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
      expect(args.slice(args.indexOf('-fps_mode'), args.indexOf('-fps_mode') + 2)).toEqual([
        '-fps_mode',
        'passthrough',
      ]);
      child.stdout.write(Buffer.alloc(196608));
      expect(() => video.check()).not.toThrow();
      now = VIDEO_STALL_MS + 1;
      // Incomplete input does not refresh the last complete frame timestamp.
      child.stdout.write(Buffer.alloc(100));
      expect(() => video.check()).toThrow('video stream stalled');
      expect(child.kill).not.toHaveBeenCalled();
    } finally {
      await video.stop();
    }
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

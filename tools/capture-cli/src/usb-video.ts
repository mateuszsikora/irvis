import { spawn } from 'node:child_process';
import { findFfmpeg } from './ffmpeg.ts';

export const VIDEO_STALL_MS = 2000;

/** Raw-unit statistics only: low-gain conversion and the effect of TPD are unknown. */
export function frameStats(frame: Buffer): {
  upperMean: number;
  rawMean: number;
  rawMin: number;
  rawMax: number;
} {
  if (frame.length !== 196608) throw new Error('expected a 256x384 YUYV frame');
  let upper = 0;
  let sum = 0;
  let min = 65535;
  let max = 0;
  for (let i = 0; i < 98304; i++) upper += frame[i] ?? 0;
  for (let i = 98304; i < frame.length; i += 2) {
    const raw = frame.readUInt16LE(i);
    sum += raw;
    min = Math.min(min, raw);
    max = Math.max(max, raw);
  }
  return { upperMean: upper / 98304, rawMean: sum / 49152, rawMin: min, rawMax: max };
}

export function observeVideo(
  device: string,
  log: (event: string, data: unknown) => void,
): { check(): void; stop(): Promise<void> } {
  const input =
    process.platform === 'darwin'
      ? [
          '-f',
          'avfoundation',
          '-pixel_format',
          'yuyv422',
          '-video_size',
          '256x384',
          '-framerate',
          '25',
          '-i',
          device,
        ]
      : [
          '-f',
          'v4l2',
          '-input_format',
          'yuyv422',
          '-video_size',
          '256x384',
          '-framerate',
          '25',
          '-i',
          device,
        ];
  const args = [
    '-hide_banner',
    ...input,
    '-an',
    '-c:v',
    'rawvideo',
    '-pix_fmt',
    '+yuyv422',
    '-fps_mode',
    'passthrough',
    '-f',
    'rawvideo',
    'pipe:1',
  ];
  log('ffmpeg', args);
  const child = spawn(findFfmpeg(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let error: Error | undefined;
  let closed = false;
  let frames = 0;
  let pending = Buffer.alloc(0);
  let previous: ReturnType<typeof frameStats> | undefined;
  let last: number | undefined;
  const done = new Promise<void>((resolve) => {
    child.on('error', (e) => {
      error = e;
    });
    child.on('close', (code) => {
      closed = true;
      log('video-end', { code, frames, trailingBytes: pending.length });
      resolve();
    });
  });
  child.stderr.on('data', (data: Buffer) => log('ffmpeg-stderr', data.toString()));
  child.stdout.on('data', (data: Buffer) => {
    pending = Buffer.concat([pending, data]);
    while (pending.length >= 196608) {
      const stats = frameStats(pending.subarray(0, 196608));
      pending = pending.subarray(196608);
      const now = performance.now();
      log('frame', {
        frame: frames++,
        ...stats,
        intervalMs: last === undefined ? null : now - last,
        late: last !== undefined && now - last > 60,
        rawStep: previous !== undefined && Math.abs(stats.rawMean - previous.rawMean) > 32,
        upperStep: previous !== undefined && Math.abs(stats.upperMean - previous.upperMean) > 2,
      });
      previous = stats;
      last = now;
    }
  });
  return {
    check() {
      if (error) throw error;
      if (closed || frames === 0)
        throw new Error('video stream stopped or no frames arrived; see ffmpeg-stderr');
      if (last !== undefined && performance.now() - last > VIDEO_STALL_MS)
        throw new Error('video stream stalled: no complete frame for more than 2000 ms');
    },
    async stop() {
      if (!closed) child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      try {
        await done;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

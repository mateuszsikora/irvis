import { reconstructPlanar, type VideoMode, type Yuv420Frame } from '@irvis/core';
import type { FrameMetadata } from './frame.ts';

export function analyse(frame: Yuv420Frame, mode: VideoMode, info: FrameMetadata) {
  if (!mode.layout) throw new Error('This mode has no thermal data.');
  const start = performance.now();
  const result = reconstructPlanar(frame, { thermal: mode.layout.thermal });
  const reconstructionMs = performance.now() - start;
  let min = Infinity,
    max = -Infinity,
    sum = 0,
    uncertain = 0;
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < result.raw.length; i++) {
    const value = result.raw[i]!;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    uncertain += result.uncertain[i]!;
    histogram[value >>> 8]!++;
  }
  return {
    info,
    frame: {
      ...frame,
      reconstructed: {
        width: result.width,
        height: result.height,
        raw: result.raw,
        uncertain: result.uncertain,
      },
    } as Yuv420Frame,
    reconstructionMs,
    statistics: {
      centerRaw:
        result.raw[Math.floor(result.height / 2) * result.width + Math.floor(result.width / 2)],
      minRaw: min,
      maxRaw: max,
      meanRaw: sum / result.raw.length,
      uncertainFraction: uncertain / result.raw.length,
      highByteHistogram: histogram,
    },
  };
}
export type Analysis = ReturnType<typeof analyse>;

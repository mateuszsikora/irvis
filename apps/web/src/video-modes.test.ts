import { describe, expect, it } from 'vitest';
import { cameraProfiles } from '@irvis/core';
import { videoModeOptions } from './video-modes.ts';

const profile = cameraProfiles[0]!;

describe('videoModeOptions', () => {
  it('matches a device mode to the profile mode by size and a frame-rate range that holds its rate', () => {
    expect(
      videoModeOptions(profile, [
        { width: 256, height: 384, minFps: 30, maxFps: 30 },
        { width: 256, height: 384, minFps: 9, maxFps: 25 },
        { width: 256, height: 384 },
      ]).map((o) => [o.key, o.label, o.mode?.id]),
    ).toEqual([
      ['device-256x384-30-30', '256 × 384 · 30 fps · image only', undefined],
      ['yuyv-256x384', '256 × 384 · 25 fps', 'yuyv-256x384'],
    ]);
  });

  it('labels a device mode without a frame rate by its size', () => {
    expect(videoModeOptions(profile, [{ width: 640, height: 480 }])).toEqual([
      { key: 'device-640x480-undefined-undefined', label: '640 × 480 · image only' },
    ]);
  });
});

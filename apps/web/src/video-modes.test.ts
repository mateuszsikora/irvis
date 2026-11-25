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

  it('allows the 0.01 fps that cameras are off by, and labels the rate rounded', () => {
    const thirty = { ...profile, videoModes: [{ ...profile.videoModes[0]!, fps: 30 }] };
    expect(
      videoModeOptions(thirty, [
        { width: 256, height: 384, minFps: 30.00003, maxFps: 30.00003 },
        { width: 640, height: 480, minFps: 30.00003, maxFps: 30.00003 },
      ]).map((o) => [o.label, o.mode?.id]),
    ).toEqual([
      ['256 × 384 · 30 fps', 'yuyv-256x384'],
      ['640 × 480 · 30 fps · image only', undefined],
    ]);
    expect(
      videoModeOptions(thirty, [{ width: 256, height: 384, minFps: 30.02, maxFps: 30.02 }])[0]
        ?.mode,
    ).toBeUndefined();
  });

  it('labels a device mode without a frame rate by its size', () => {
    expect(videoModeOptions(profile, [{ width: 640, height: 480 }])).toEqual([
      { key: 'device-640x480-undefined-undefined', label: '640 × 480 · image only' },
    ]);
  });
});

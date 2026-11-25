import { describe, expect, it } from 'vitest';
import { cameraProfiles } from '@irvis/core';
import { videoModeOptions } from './video-modes.ts';

const profile = cameraProfiles[0]!;
const options = (...args: Parameters<typeof videoModeOptions>) =>
  videoModeOptions(...args).map((o) => [o.key, o.label, o.mode?.id]);

describe('videoModeOptions', () => {
  it("lists the profile's modes while the device's are unknown, image-only ones chosen only where they can be shown", () => {
    expect(options(profile, null, true)).toEqual([
      ['yuyv-256x384', '256 × 384 · 25 fps', 'yuyv-256x384'],
      ['yuyv-256x192', '256 × 192 · 25 fps · image only', 'yuyv-256x192'],
    ]);
    expect(options(profile, null, false)).toEqual([
      ['yuyv-256x384', '256 × 384 · 25 fps', 'yuyv-256x384'],
      ['yuyv-256x192', '256 × 192 · 25 fps · image only', undefined],
    ]);
  });

  it('matches a device mode to the profile mode by size and a frame-rate range that holds its rate', () => {
    expect(
      options(
        profile,
        [
          { width: 256, height: 384, minFps: 30, maxFps: 30 },
          { width: 256, height: 384, minFps: 9, maxFps: 25 },
          { width: 256, height: 384 },
          { width: 256, height: 192, minFps: 25, maxFps: 25 },
        ],
        true,
      ),
    ).toEqual([
      ['image-256x384@30', '256 × 384 · 30 fps · image only', 'image-256x384@30'],
      ['yuyv-256x384', '256 × 384 · 25 fps', 'yuyv-256x384'],
      ['yuyv-256x192', '256 × 192 · 25 fps · image only', 'yuyv-256x192'],
    ]);
  });

  it('opens a device mode of its own at the highest rate of its range', () => {
    expect(
      options(
        profile,
        [
          { width: 1280, height: 720, minFps: 5, maxFps: 30 },
          { width: 640, height: 480, minFps: 7.5, maxFps: 7.5 },
        ],
        true,
      ),
    ).toEqual([
      ['image-1280x720@30', '1280 × 720 · 30 fps · image only', 'image-1280x720@30'],
      ['image-640x480@7.5', '640 × 480 · 7.5 fps · image only', 'image-640x480@7.5'],
    ]);
  });

  it('allows the 0.01 fps that cameras are off by, and labels the rate rounded', () => {
    const thirty = { ...profile, videoModes: [{ ...profile.videoModes[0]!, fps: 30 }] };
    expect(
      options(
        thirty,
        [
          { width: 256, height: 384, minFps: 30.00003, maxFps: 30.00003 },
          { width: 640, height: 480, minFps: 30.00003, maxFps: 30.00003 },
        ],
        true,
      ),
    ).toEqual([
      ['yuyv-256x384', '256 × 384 · 30 fps', 'yuyv-256x384'],
      ['image-640x480@30', '640 × 480 · 30 fps · image only', 'image-640x480@30'],
    ]);
    expect(
      videoModeOptions(thirty, [{ width: 256, height: 384, minFps: 30.02, maxFps: 30.02 }], true)[0]
        ?.mode?.layout,
    ).toBeNull();
  });

  it('cannot choose a device mode without a frame rate, nor one that is not packed YUYV, and labels it by its size', () => {
    expect(
      videoModeOptions(
        profile,
        [
          { width: 640, height: 480 },
          { width: 641, height: 480, minFps: 30, maxFps: 30 },
        ],
        true,
      ),
    ).toEqual([
      { key: 'device-640x480-undefined-undefined', label: '640 × 480 · image only' },
      { key: 'device-641x480-30-30', label: '641 × 480 · 30 fps · image only' },
    ]);
  });

  it('keeps image-only device modes unchosen where they cannot be shown', () => {
    expect(options(profile, [{ width: 1280, height: 720, minFps: 30, maxFps: 30 }], false)).toEqual(
      [['image-1280x720@30', '1280 × 720 · 30 fps · image only', undefined]],
    );
  });
});

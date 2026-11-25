import { describe, expect, it } from 'vitest';
import type { CameraProfile } from './cameras/profile.ts';
import { cameraProfiles } from './cameras/index.ts';
import { findVideoMode, imageOnlyMode } from './video-modes.ts';

describe('imageOnlyMode', () => {
  it('names a YUYV mode without temperature data by its size and rounded rate', () => {
    expect(imageOnlyMode(1280, 720, 30.00003)).toEqual({
      id: 'image-1280x720@30',
      width: 1280,
      height: 720,
      fps: 30,
      pixelFormat: 'yuyv',
      layout: null,
    });
    expect(imageOnlyMode(640, 480, 7.5)?.id).toBe('image-640x480@7.5');
  });

  it('refuses sizes and rates ffmpeg should not be asked for', () => {
    for (const [width, height, fps] of [
      [641, 480, 30],
      [0, 480, 30],
      [640, 480.5, 30],
      [8194, 480, 30],
      [640, 480, 0],
      [640, 480, 0.001],
      [640, 480, 1001],
      [640, 480, Number.NaN],
    ] as const)
      expect(imageOnlyMode(width, height, fps)).toBeUndefined();
  });
});

const [infirayP2Pro] = cameraProfiles as [CameraProfile];

describe('findVideoMode', () => {
  it("finds the profile's own mode first, then an image-only mode by its id", () => {
    expect(findVideoMode(infirayP2Pro, 'yuyv-256x384')?.layout).not.toBeNull();
    expect(findVideoMode(infirayP2Pro, 'image-1920x1080@30')).toEqual(
      imageOnlyMode(1920, 1080, 30),
    );
  });

  it('finds nothing for any other id, including another spelling of an image-only id', () => {
    for (const id of [
      '',
      'yuyv-1x1',
      'image-640x480',
      'image-640x480@30.0',
      'image-0640x480@30',
      'image-641x480@30',
      'image-640x480@30 ',
      'image-99999x480@30',
    ])
      expect(findVideoMode(infirayP2Pro, id)).toBeUndefined();
  });
});

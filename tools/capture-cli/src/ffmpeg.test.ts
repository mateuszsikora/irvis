import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  captureArgs,
  findFfmpeg,
  parseDeviceList,
  parseFfmpegVersion,
  parseFramecrc,
  parseInputPixelFormat,
  parsePixelFormats,
  parseSupportedModes,
} from './ffmpeg.ts';

describe('ffmpeg output', () => {
  it('parses the AVFoundation device list', () => {
    const stderr = [
      '[AVFoundation indev @ 0x7722c10140] AVFoundation video devices:',
      '[AVFoundation indev @ 0x7722c10140] [0] FaceTime HD Camera',
      '[AVFoundation indev @ 0x7722c10140] [1] USB Camera',
      '[AVFoundation indev @ 0x7722c10140] [2] Capture screen 0',
      '[AVFoundation indev @ 0x7722c10140] AVFoundation audio devices:',
      '[AVFoundation indev @ 0x7722c10140] [0] MacBook Pro Microphone',
      '[in#0 @ 0x7722c10000] Error opening input: Input/output error',
    ].join('\n');
    expect(parseDeviceList(stderr)).toEqual({
      video: [
        { index: 0, name: 'FaceTime HD Camera' },
        { index: 1, name: 'USB Camera' },
        { index: 2, name: 'Capture screen 0' },
      ],
      audio: [{ index: 0, name: 'MacBook Pro Microphone' }],
    });
  });

  it('parses the supported modes', () => {
    const stderr = [
      '[in#0 @ 0x7506814000] Selected video size (1x1) is not supported by the device.',
      '[in#0 @ 0x7506814000] Supported modes:',
      '[in#0 @ 0x7506814000]   256x384@[25.000000 25.000000]fps',
      '[in#0 @ 0x7506814000]   256x192@[25.000000 25.000000]fps',
    ].join('\n');
    expect(parseSupportedModes(stderr)).toEqual([
      { width: 256, height: 384, minFps: 25, maxFps: 25 },
      { width: 256, height: 192, minFps: 25, maxFps: 25 },
    ]);
  });

  it('parses the supported pixel formats', () => {
    const stderr = [
      '[avfoundation @ 0x1] Selected pixel format (monob) is not supported by the input device.',
      '[avfoundation @ 0x1] Supported pixel formats:',
      '[avfoundation @ 0x1]   uyvy422',
      '[avfoundation @ 0x1]   yuyv422',
      '[avfoundation @ 0x1]   nv12',
      '[avfoundation @ 0x1] Overriding selected pixel format to use uyvy422 instead.',
    ].join('\n');
    expect(parsePixelFormats(stderr)).toEqual({
      supported: ['uyvy422', 'yuyv422', 'nv12'],
      chosen: 'uyvy422',
    });
  });

  it('parses the version and the framecrc list', () => {
    expect(
      parseFfmpegVersion('ffmpeg version 7.1.1 Copyright (c) 2000-2025 the FFmpeg developers\n'),
    ).toBe('7.1.1');
    const crc = [
      '#software: Lavf61.7.100',
      '#tb 0: 1/1000000',
      '#media_type 0: video',
      '0,          0,          0,        1,   196608, 0x1d2c3b4a',
      '0,      40000,      40000,        1,   196608, 0x5e6f7a8b',
    ].join('\n');
    expect(parseFramecrc(crc)).toEqual({
      timeBase: [1, 1000000],
      packets: [
        { pts: 0, size: 196608 },
        { pts: 40000, size: 196608 },
      ],
    });
  });
});

describe('parseInputPixelFormat', () => {
  it('prefers the fallback AVFoundation announces', () => {
    const log = [
      '[avfoundation @ 0x1] Selected pixel format (yuyv422) is not supported by the input device.',
      '[avfoundation @ 0x1] Overriding selected pixel format to use uyvy422 instead.',
    ].join('\n');
    expect(parseInputPixelFormat(log)).toBe('uyvy422');
  });

  it('reads the input stream, not an output stream', () => {
    const log = [
      "Input #0, avfoundation, from '1:none':",
      '  Duration: N/A, start: 1.0, bitrate: N/A',
      '  Stream #0:0: Video: rawvideo (YUY2 / 0x32595559), yuyv422, 256x384, 25 tbr, 1000k tbn',
      "Output #0, rawvideo, to 'pipe:1':",
      '  Stream #0:0: Video: rawvideo (UYVY / 0x59565955), uyvy422, 256x384, q=2-31, 25 tbn',
    ].join('\n');
    expect(parseInputPixelFormat(log)).toBe('yuyv422');
    expect(
      parseInputPixelFormat('Output #0, rawvideo\n  Stream #0:0: Video: rawvideo, nv12'),
    ).toBeNull();
  });
});

describe('captureArgs', () => {
  it('packs pixels without conversion and lists original packets', () => {
    const args = captureArgs({
      deviceIndex: 1,
      width: 256,
      height: 384,
      fps: 25,
      seconds: 10,
      packetsPath: '/tmp/x/packets.framecrc',
    });
    const at = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
    expect(at('-f')).toBe('avfoundation');
    expect(at('-video_size')).toBe('256x384');
    expect(at('-pixel_format')).toBe('yuyv422');
    expect(at('-framerate')).toBe('25');
    expect(at('-t')).toBe('10');
    expect(at('-i')).toBe('1:none');
    expect(args.join(' ')).toContain(
      '-map 0:v -c:v rawvideo -pix_fmt + -fps_mode passthrough -enc_time_base demux -f rawvideo pipe:1',
    );
    expect(args.join(' ')).toContain('-map 0:v -c:v copy -f framecrc /tmp/x/packets.framecrc');
    expect(at('-pix_fmt')).toBe('+');
  });
});

describe('findFfmpeg', () => {
  it('prefers IRVIS_FFMPEG, then PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capture-cli-ffmpeg-'));
    try {
      const fake = join(dir, 'ffmpeg');
      writeFileSync(fake, '#!/bin/sh\n');
      chmodSync(fake, 0o755);
      expect(findFfmpeg({ PATH: `/nonexistent:${dir}` })).toBe(fake);
      expect(findFfmpeg({ IRVIS_FFMPEG: fake, PATH: '' })).toBe(fake);
      expect(() => findFfmpeg({ IRVIS_FFMPEG: join(dir, 'missing'), PATH: dir })).toThrow(
        `IRVIS_FFMPEG=${join(dir, 'missing')} is not an executable file`,
      );
      expect(() => findFfmpeg({ PATH: '/nonexistent' })).toThrow(
        'ffmpeg not found: install it (brew install ffmpeg) or set IRVIS_FFMPEG to its path',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

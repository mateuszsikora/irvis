import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture } from '../src/capture.ts';
import { modeByRows } from '../src/commands.ts';

let dir: string;

/**
 * A stand-in for ffmpeg: answers -version, logs what AVFoundation would
 * after falling back to uyvy422, writes a framecrc header to its last
 * argument and 2.5 frames of the 384 mode to stdout.
 */
const FAKE_FFMPEG = `#!/bin/sh
for a in "$@"; do last="$a"; done
if [ "$2" = "-version" ]; then echo "ffmpeg version 9.9-fake"; exit 0; fi
echo "[avfoundation @ 0x1] Selected pixel format (yuyv422) is not supported by the input device." >&2
echo "[avfoundation @ 0x1] Overriding selected pixel format to use uyvy422 instead." >&2
echo "Input #0, avfoundation, from '1:none':" >&2
echo "  Stream #0:0: Video: rawvideo (UYVY / 0x59565955), uyvy422, 256x384, 25 tbr, 1000k tbn" >&2
echo "#tb 0: 1/1000000" > "$last"
head -c 491520 /dev/zero
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'capture-cli-capture-'));
  writeFileSync(join(dir, 'ffmpeg'), FAKE_FFMPEG);
  chmodSync(join(dir, 'ffmpeg'), 0o755);
});

afterEach(() => {
  chmodSync(dir, 0o755);
  if (existsSync(join(dir, 'out', 'frames'))) chmodSync(join(dir, 'out', 'frames'), 0o755);
  rmSync(dir, { recursive: true, force: true });
});

const options = () => ({
  ffmpeg: join(dir, 'ffmpeg'),
  deviceIndex: 1,
  deviceName: 'USB Camera',
  profileId: 'infiray-p2pro',
  mode: modeByRows('384'),
  seconds: 1,
  out: join(dir, 'out'),
  label: 'fake',
  referenceCelsius: null,
});

describe('capture', () => {
  it('cuts the stream into frames and records what ffmpeg delivered', async () => {
    const meta = await capture(options());
    expect(meta.frames.map((f) => f.file)).toEqual([
      'frames/000000.yuyv.gz',
      'frames/000001.yuyv.gz',
    ]);
    expect(meta.trailingBytes).toBe(98304);
    expect(meta.pixelFormat).toBe('uyvy422');
    expect(meta.ffmpeg.version).toBe('9.9-fake');
    expect(meta.ffmpeg.exitCode).toBe(0);
    expect(meta.timing.firstFrameMs).not.toBeNull();
    const out = join(dir, 'out');
    expect(existsSync(join(out, 'frames', '000001.yuyv.gz'))).toBe(true);
    expect(readFileSync(join(out, 'ffmpeg.log'), 'utf8')).toContain('Stream #0:0');
    expect(readFileSync(join(out, 'packets.framecrc'), 'utf8')).toBe('#tb 0: 1/1000000\n');
    expect(JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'))).toEqual(meta);
  });

  it('fails with a message when a frame cannot be written', async (context) => {
    if (process.getuid?.() === 0) context.skip();
    mkdirSync(join(dir, 'out', 'frames'), { recursive: true });
    chmodSync(join(dir, 'out', 'frames'), 0o500);
    await expect(capture(options())).rejects.toThrow(
      `${join(dir, 'out')}: writing frame 0 failed: EACCES`,
    );
  });
});

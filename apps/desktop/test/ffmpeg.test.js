import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NO_BUNDLED_FFMPEG,
  bundledFfmpeg,
  bundledNotExecutable,
  locateFfmpeg,
} from '../src/ffmpeg.js';

const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
let scratch;
function executable(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, '');
  chmodSync(file, 0o755);
  return file;
}
function setup() {
  scratch = mkdtempSync(join(tmpdir(), 'irvis-ffmpeg-'));
  return {
    resources: join(scratch, 'resources'),
    system: join(scratch, 'bin'),
    configured: join(scratch, 'configured', name),
  };
}
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe('desktop ffmpeg', () => {
  it('keeps the bundled ffmpeg under resources/ffmpeg', () => {
    expect(bundledFfmpeg('/r', 'darwin')).toBe(join('/r', 'ffmpeg', 'ffmpeg'));
    expect(bundledFfmpeg('/r', 'win32')).toBe(join('/r', 'ffmpeg', 'ffmpeg.exe'));
  });

  it('prefers the bundled ffmpeg to PATH', () => {
    const { resources, system } = setup();
    executable(system);
    const bundled = executable(join(resources, 'ffmpeg'));
    expect(locateFfmpeg({ env: { PATH: system }, bundled })).toBe(bundled);
  });

  it('lets IRVIS_FFMPEG override the bundled ffmpeg', () => {
    const { resources, configured } = setup();
    const bundled = executable(join(resources, 'ffmpeg'));
    executable(join(configured, '..'));
    expect(locateFfmpeg({ env: { IRVIS_FFMPEG: configured, PATH: '' }, bundled })).toBe(configured);
    expect(() =>
      locateFfmpeg({ env: { IRVIS_FFMPEG: join(scratch, 'missing'), PATH: '' }, bundled }),
    ).toThrow(/^IRVIS_FFMPEG=.* is not an executable file$/);
  });

  it('falls back to PATH when the package has no ffmpeg', () => {
    const { resources, system } = setup();
    const found = executable(system);
    expect(locateFfmpeg({ env: { PATH: system }, bundled: bundledFfmpeg(resources) })).toBe(found);
  });

  it('explains IRVIS_FFMPEG when neither the package nor PATH has ffmpeg', () => {
    const { resources } = setup();
    expect(() => locateFfmpeg({ env: { PATH: '' }, bundled: bundledFfmpeg(resources) })).toThrow(
      NO_BUNDLED_FFMPEG,
    );
  });

  it.skipIf(process.platform === 'win32')(
    'says when the bundled ffmpeg is present but not executable',
    () => {
      const { resources } = setup();
      const bundled = executable(join(resources, 'ffmpeg'));
      chmodSync(bundled, 0o644);
      expect(() => locateFfmpeg({ env: { PATH: '' }, bundled })).toThrow(
        bundledNotExecutable(bundled),
      );
    },
  );

  it('keeps the capture tool message when running from the repository', () => {
    setup();
    expect(() => locateFfmpeg({ env: { PATH: '' } })).toThrow(/^ffmpeg not found: install it/);
  });
});

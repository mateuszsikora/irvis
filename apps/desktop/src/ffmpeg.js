import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findFfmpeg } from '../../../tools/capture-cli/src/ffmpeg.ts';

/** Where a desktop package keeps the ffmpeg built by ffmpeg/build.sh. */
export function bundledFfmpeg(resourcesPath, platform = process.platform) {
  return join(resourcesPath, 'ffmpeg', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

export const NO_BUNDLED_FFMPEG =
  'This irvis package has no ffmpeg. Install ffmpeg and start irvis with IRVIS_FFMPEG set to its path.';

/** The message when the package's ffmpeg exists but cannot be run. */
export function bundledNotExecutable(path) {
  return `The ffmpeg of this irvis package (${path}) is not an executable file. Reinstall irvis, or start it with IRVIS_FFMPEG set to another ffmpeg.`;
}

/**
 * IRVIS_FFMPEG if set, else the bundled ffmpeg of a package, else the first
 * ffmpeg on PATH. `bundled` is undefined when the app runs from the
 * repository.
 */
export function locateFfmpeg({ env = process.env, bundled } = {}) {
  if (!env.IRVIS_FFMPEG && bundled && isExecutable(bundled)) return bundled;
  try {
    return findFfmpeg(env);
  } catch (error) {
    if (bundled && !env.IRVIS_FFMPEG)
      throw new Error(existsSync(bundled) ? bundledNotExecutable(bundled) : NO_BUNDLED_FFMPEG, {
        cause: error,
      });
    throw error;
  }
}

function isExecutable(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

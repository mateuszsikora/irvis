// The development launcher uses Electron.app; packages set the same key through
// electron-builder.config.mjs (mac.extendInfo).
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
if (process.platform === 'darwin') {
  // Universal, so that the x64 package built on an arm64 Mac carries it too.
  execFileSync('cc', [
    '-arch',
    'arm64',
    '-arch',
    'x86_64',
    '../../tools/capture-cli/iokit-request.c',
    '-framework',
    'IOKit',
    '-framework',
    'CoreFoundation',
    '-o',
    'dist/iokit-request',
  ]);
  const require = createRequire(import.meta.url);
  const executable = require('electron');
  const plist = resolve(dirname(executable), '../Info.plist');
  execFileSync('/usr/bin/plutil', [
    '-replace',
    'NSCameraUsageDescription',
    '-string',
    'irvis uses the camera to display and record thermal images.',
    plist,
  ]);
}

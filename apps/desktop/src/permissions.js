// The development launcher uses Electron.app; packaged apps must carry the same key.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
if (process.platform === 'darwin') {
  execFileSync('cc', [
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

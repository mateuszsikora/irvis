// electron-builder configuration of the desktop packages. Run it through
// `npm run package:desktop` after `npm run ffmpeg:build`; what goes where:
// docs/features/desktop-technical.md#packages
import { Arch } from 'electron-builder';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '../..');
const camera = 'irvis uses the camera to display and record thermal images.';
const systems = { darwin: 'mac', linux: 'linux', win32: 'win' };

/** Stops a package without ffmpeg unless IRVIS_PACKAGE_WITHOUT_FFMPEG=1. */
function requireFfmpeg({ electronPlatformName, arch }) {
  const target = `${systems[electronPlatformName]}-${Arch[arch]}`;
  const exe = electronPlatformName === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  if (existsSync(resolve(import.meta.dirname, 'ffmpeg/dist', target, exe))) return;
  if (process.env.IRVIS_PACKAGE_WITHOUT_FFMPEG === '1') {
    console.warn(`packaging ${target} without ffmpeg; users must set IRVIS_FFMPEG`);
    return;
  }
  throw new Error(
    `apps/desktop/ffmpeg/dist/${target}/${exe} is missing: run npm run ffmpeg:build -- ${target}, ` +
      'or set IRVIS_PACKAGE_WITHOUT_FFMPEG=1 to package without ffmpeg',
  );
}

/** @type {import('electron-builder').Configuration} */
export default {
  // npm hoists electron to the workspace root, where electron-builder does
  // not look; package the version that npm installed.
  electronVersion: createRequire(import.meta.url)('electron/package.json').version,
  appId: 'io.github.mateuszsikora.irvis',
  productName: 'irvis',
  executableName: 'irvis',
  copyright: 'Copyright (c) 2026 Mateusz Sikora',
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  directories: { output: 'release' },
  beforePack: requireFfmpeg,
  // esbuild bundles everything except Electron and node-usb into dist/.
  files: [
    'package.json',
    'dist/main.cjs',
    'dist/preload.cjs',
    '!**/node_modules/usb/{src,libusb,libusb_config,test}/**',
    '!**/node_modules/usb/{binding.gyp,libusb.gypi,CHANGELOG.md}',
    '!**/node_modules/usb/prebuilds/**',
    '**/node_modules/usb/prebuilds/${platform}-*/**',
  ],
  // node-usb loads its N-API prebuild, which works in Electron as it is.
  npmRebuild: false,
  extraResources: [
    { from: '../web/dist', to: 'web' },
    {
      from: 'ffmpeg/dist/${os}-${arch}',
      to: 'ffmpeg',
      filter: ['ffmpeg', 'ffmpeg.exe', 'COPYING.LGPLv2.1', 'README.txt'],
    },
    { from: resolve(repository, 'LICENSE'), to: 'LICENSE.irvis.txt' },
    { from: resolve(repository, 'NOTICE'), to: 'NOTICE.irvis.txt' },
  ],
  mac: {
    target: ['dmg'],
    category: 'public.app-category.utilities',
    // Ad-hoc signature: unsigned for Gatekeeper, but arm64 code must carry
    // a valid signature to run. Signing and notarisation are separate work.
    identity: '-',
    hardenedRuntime: false,
    extendInfo: {
      NSCameraUsageDescription: camera,
      NSMicrophoneUsageDescription: 'irvis records optional microphone audio with a recording.',
    },
    extraResources: [{ from: 'dist/iokit-request', to: 'iokit-request' }],
  },
  win: { target: ['nsis', 'zip'] },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Graphics',
    maintainer: 'Mateusz Sikora <8762997+mateuszsikora@users.noreply.github.com>',
    extraResources: [
      { from: resolve(repository, 'tools/capture-cli/60-irvis.rules'), to: '60-irvis.rules' },
    ],
  },
  deb: {
    // Lets the logged-in user send camera commands without root.
    fpm: [
      `${resolve(repository, 'tools/capture-cli/60-irvis.rules')}=/usr/lib/udev/rules.d/60-irvis.rules`,
    ],
  },
};

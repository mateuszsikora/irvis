// Starts a desktop package built by `npm run package:desktop` and checks what
// the repository build cannot: the resources layout, capture start running
// the bundled ffmpeg found without PATH, node-usb loading the way camera
// control loads it, and IRVIS_FFMPEG taking precedence. Run from apps/desktop:
//
//   node test/package-smoke.mjs [unpacked app directory, e.g. release/mac-arm64]
//                               [--ffmpeg-optional] [--launch <executable>]
//
// --launch starts another executable of the same package, such as the
// AppImage (with APPIMAGE_EXTRACT_AND_RUN=1 when FUSE is missing).
// With --ffmpeg-optional, a package without ffmpeg (packaged with
// IRVIS_PACKAGE_WITHOUT_FFMPEG=1 after its ffmpeg build failed) passes if it
// asks for IRVIS_FFMPEG instead.
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { cameraProfiles } from '@irvis/core';
import { NO_BUNDLED_FFMPEG } from '../src/ffmpeg.js';

const platform = process.platform;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const fallback = {
  darwin: arch === 'arm64' ? 'release/mac-arm64' : 'release/mac',
  linux: 'release/linux-unpacked',
  win32: 'release/win-unpacked',
}[platform];
const args = process.argv.slice(2);
const launchIndex = args.indexOf('--launch');
const launchFile = launchIndex >= 0 ? args.splice(launchIndex, 2)[1] : undefined;
const unpacked = resolve(args.find((a) => !a.startsWith('--')) ?? fallback);
const executable = launchFile
  ? resolve(launchFile)
  : {
      darwin: join(unpacked, 'irvis.app/Contents/MacOS/irvis'),
      linux: join(unpacked, 'irvis'),
      win32: join(unpacked, 'irvis.exe'),
    }[platform];
const resources =
  platform === 'darwin'
    ? join(unpacked, 'irvis.app/Contents/Resources')
    : join(unpacked, 'resources');
const ffmpeg = join(resources, 'ffmpeg', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const withoutFfmpeg = process.argv.includes('--ffmpeg-optional') && !existsSync(ffmpeg);

const bundled = [
  ffmpeg,
  join(resources, 'ffmpeg/COPYING.LGPLv2.1'),
  join(resources, 'ffmpeg/README.txt'),
];
if (withoutFfmpeg) for (const file of bundled) assert.ok(!existsSync(file), `${file} is packaged`);
for (const file of [
  ...(withoutFfmpeg ? [] : bundled),
  join(resources, 'web/index.html'),
  join(resources, 'LICENSE.irvis.txt'),
  join(resources, 'NOTICE.irvis.txt'),
  ...(platform === 'darwin' ? [join(resources, 'iokit-request')] : []),
  ...(platform === 'linux' ? [join(resources, '60-irvis.rules')] : []),
])
  assert.ok(existsSync(file), `${file} is missing from the package`);
if (!withoutFfmpeg)
  assert.match(
    execFileSync(ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8' }),
    /^ffmpeg version 9\.0\.2 /,
  );
const prebuilds = readdirSync(join(resources, 'app.asar.unpacked/node_modules/usb/prebuilds'));
assert.ok(
  prebuilds.length === 1 && prebuilds[0].startsWith(platform + '-'),
  `node-usb prebuilds other than the packaged system's: ${prebuilds.join(', ')}`,
);
if (platform === 'darwin') {
  const plist = join(unpacked, 'irvis.app/Contents/Info.plist');
  const read = (key) =>
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], {
      encoding: 'utf8',
    }).trim();
  assert.equal(
    read('NSCameraUsageDescription'),
    'irvis uses the camera to display and record thermal images.',
  );
  assert.ok(read('NSMicrophoneUsageDescription'));
  // docs/features/desktop-user.md#install-a-package states this minimum.
  assert.equal(read('LSMinimumSystemVersion'), '13.0');
}

// A PATH without any ffmpeg, so that only the bundled one can be found.
const path = (process.env.PATH ?? '')
  .split(delimiter)
  .filter((dir) => !existsSync(join(dir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')))
  .join(delimiter);
const env = { ...process.env, PATH: path };
delete env.IRVIS_FFMPEG;
const mode = cameraProfiles[0].videoModes.find((m) => m.layout);
const selection = {
  profileId: cameraProfiles[0].id,
  modeId: mode.id,
  // No such camera: ffmpeg starts and exits at once, without a camera prompt.
  device: { darwin: '99', linux: '/dev/video99', win32: 'irvis smoke' }[platform],
};
const startError = (options) =>
  window.irvisDesktop.start(options).then(
    () => '',
    (e) => String(e.message),
  );

async function launch(extra) {
  const app = await electron.launch({
    executablePath: executable,
    // CI runners give the unpacked chrome-sandbox no setuid root.
    args: platform === 'linux' ? ['--no-sandbox'] : [],
    env: { ...env, ...extra },
  });
  const stderr = [];
  app.process().stderr.on('data', (chunk) => stderr.push(String(chunk)));
  const page = await app.firstWindow();
  await page.waitForSelector('h1');
  assert.equal(await page.locator('h1').textContent(), 'irvis');
  return { app, page, stderr };
}

let { app, page, stderr } = await launch({});
try {
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  if (withoutFfmpeg)
    assert.ok(
      (await page.evaluate(startError, selection)).endsWith(NO_BUNDLED_FFMPEG),
      'a package without ffmpeg does not ask for IRVIS_FFMPEG',
    );
  else {
    // On macOS and Windows this runs the bundled ffmpeg; Linux reads /dev.
    assert.ok(Array.isArray(await page.evaluate(() => window.irvisDesktop.listDevices())));
    // Capture start opens camera control (node-usb through the same dynamic
    // import as in use) and then spawns the bundled ffmpeg, which exits on
    // the missing camera.
    const ended = await page.evaluate(
      (options) =>
        new Promise((done) => {
          const stop = window.irvisDesktop.subscribe(
            () => {},
            (message) => {
              stop();
              done(message);
            },
          );
          window.irvisDesktop.start(options).catch((e) => done('start: ' + e.message));
        }),
      selection,
    );
    assert.match(ended, /^Capture ended \(\d+\)/, 'capture start did not run the bundled ffmpeg');
    await page.evaluate(() => window.irvisDesktop.stop());
    const reasons = [...stderr.join('').matchAll(/Camera control is unavailable: (.*)/g)].map(
      (m) => m[1],
    );
    // Without a camera node-usb loads and finds none; with one, control opens.
    assert.ok(
      reasons.every((r) => r === 'Camera control requires exactly one matching USB camera'),
      `camera control failed: ${reasons.join('; ')}`,
    );
  }
} finally {
  await app.close();
}

const missing = join(dirname(unpacked), 'no-such-ffmpeg');
({ app, page } = await launch({ IRVIS_FFMPEG: missing }));
try {
  const error = await page.evaluate(startError, selection);
  assert.match(error, /IRVIS_FFMPEG=.*no-such-ffmpeg is not an executable file/);
} finally {
  await app.close();
}
console.log(
  withoutFfmpeg
    ? 'package smoke: resources, node-usb, IRVIS_FFMPEG instructions and precedence passed'
    : 'package smoke: resources, bundled ffmpeg capture start, node-usb and IRVIS_FFMPEG precedence passed',
);

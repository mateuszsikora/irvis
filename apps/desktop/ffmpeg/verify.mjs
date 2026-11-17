// Checks an ffmpeg built by build.sh before it is packaged: version, licence,
// only the expected camera input and the rawvideo codec, and that the capture
// output arguments of src/capture.js return the input bytes unchanged.
//
//   node apps/desktop/ffmpeg/verify.mjs [mac-arm64|mac-x64|linux-x64|win-x64]
//
// The target defaults to the host. What it proves:
// docs/features/desktop-technical.md#bundled-ffmpeg
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { outputArgs } from '../src/capture.js';

const VERSION = '9.0.2';
// The names ffmpeg -devices prints for the input of each system.
const INPUT = { mac: 'avfoundation', linux: 'video4linux2,v4l2', win: 'dshow' };
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const os = { darwin: 'mac', linux: 'linux', win32: 'win' }[process.platform];
const target = process.argv[2] ?? `${os}-${arch}`;
const system = target.split('-')[0];
const dir = join(import.meta.dirname, 'dist', target);
const ffmpeg = join(dir, system === 'win' ? 'ffmpeg.exe' : 'ffmpeg');

function fail(message) {
  console.error(`ffmpeg verify (${target}): ${message}`);
  process.exit(1);
}
function run(args, input) {
  const result = spawnSync(ffmpeg, ['-hide_banner', ...args], {
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`${ffmpeg} did not run: ${result.error.message}`);
  if (result.status !== 0)
    fail(`ffmpeg ${args.join(' ')} exited with ${result.status}:\n${result.stderr}`);
  return result;
}
/** Names in the table that `ffmpeg -encoders`, `-decoders` or `-devices` prints. */
function listed(args) {
  const text = run(args).stdout.toString();
  const body = text.slice(text.lastIndexOf(' --') + 3);
  return body
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[1])
    .filter(Boolean);
}

if (!INPUT[system]) fail('unknown target; use mac-arm64, mac-x64, linux-x64 or win-x64');
for (const file of ['COPYING.LGPLv2.1', 'README.txt'])
  if (!existsSync(join(dir, file))) fail(`${file} is missing; run build.sh ${target}`);

const version = run(['-version']).stdout.toString();
if (!version.startsWith(`ffmpeg version ${VERSION} `)) fail(`not ffmpeg ${VERSION}:\n${version}`);
for (const flag of ['--enable-gpl', '--enable-nonfree'])
  if (version.includes(flag)) fail(`built with ${flag}`);
if (!run(['-L']).stdout.toString().includes('GNU Lesser General Public'))
  fail('ffmpeg -L does not report the LGPL');

const expect = (args, names) => {
  const actual = listed(args).sort();
  if (actual.join() !== [...names].sort().join())
    fail(`ffmpeg ${args[0]} lists ${actual.join(', ')}; expected ${names.join(', ')}`);
};
expect(['-decoders'], ['rawvideo']);
expect(['-encoders'], ['rawvideo']);
expect(['-devices'], [INPUT[system]]);

const width = 256,
  height = 384,
  frames = 3;
const input = randomBytes(width * height * 2 * frames);
const output = run(
  [
    '-nostdin',
    '-f',
    'rawvideo',
    '-pixel_format',
    'yuyv422',
    '-video_size',
    `${width}x${height}`,
    '-framerate',
    '25',
    '-i',
    'pipe:0',
    ...outputArgs(),
  ],
  input,
).stdout;
if (!input.equals(output))
  fail(`passthrough changed the bytes: ${input.length} in, ${output.length} out`);

const readme = readFileSync(join(dir, 'README.txt'), 'utf8');
if (!readme.includes(`ffmpeg ${VERSION} for irvis (${target})`)) fail('README.txt is stale');
console.log(
  `ffmpeg verify (${target}): ffmpeg ${VERSION}, LGPL, ${INPUT[system]} input, rawvideo only, ${frames} YUYV frames passed through unchanged`,
);

// `spike` (npm run spike:m1): the M1 scenarios one after another, then the
// session report. What the owner does at each step: docs/findings/m1.md
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  captureCommand,
  formatDevices,
  listDevices,
  modeByRows,
  probe,
  reportCommand,
  setReference,
} from './commands.ts';
import { CliError } from './errors.ts';
import { type AvDevice, ffmpegVersion } from './ffmpeg.ts';

export interface Scenario {
  readonly id: string;
  readonly mode: '384' | '192';
  readonly seconds: number;
  readonly instructions: string;
  /** Ask for the Android app's centre reading at the same spot. */
  readonly askReference: boolean;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'room',
    mode: '384',
    seconds: 5,
    instructions: 'Point the camera at an empty part of the room, such as a wall 1 to 2 m away.',
    askReference: true,
  },
  {
    id: 'hand',
    mode: '384',
    seconds: 5,
    instructions: 'Hold your open hand about 30 cm in front of the camera, covering the centre.',
    askReference: true,
  },
  {
    id: 'mug',
    mode: '384',
    seconds: 5,
    instructions: 'Point the centre of the image at a mug of hot water, about 50 cm away.',
    askReference: true,
  },
  {
    id: 'static',
    mode: '384',
    seconds: 10,
    instructions:
      'Lay the camera still on a table, facing a plain wall, and do not touch it or move in front of it for 10 s.',
    askReference: false,
  },
  {
    id: 'movement',
    mode: '384',
    seconds: 90,
    instructions:
      'For 90 s, move the camera around the room: people, a window, the hot mug, your hand close up.',
    askReference: false,
  },
  {
    id: 'mode-192',
    mode: '192',
    seconds: 3,
    instructions: 'Point the camera at anything; this checks the 256x192 mode.',
    askReference: false,
  },
];

function timestamp(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** A Celsius reading as typed, with a comma or a dot; null for an empty answer. */
export function parseCelsius(answer: string): number | null {
  const text = answer.trim().replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new CliError(`'${answer}' is not a temperature`);
  return value;
}

/** The index of the first device whose name looks like the thermal camera, or null. */
export function guessDevice(devices: readonly AvDevice[]): number | null {
  return devices.find((d) => /usb camera|thermal|p2|t7/i.test(d.name))?.index ?? null;
}

/**
 * The device index the owner typed: Enter takes the guess. Throws a CliError,
 * after which the spike asks again, for an empty answer without a guess, a
 * non-number, and an index the list does not have.
 */
export function chooseDevice(
  answer: string,
  guess: number | null,
  devices: readonly AvDevice[],
): number {
  const text = answer.trim();
  if (text === '') {
    if (guess === null) throw new CliError('type the index of the thermal camera');
    return guess;
  }
  const index = Number(text);
  if (!Number.isInteger(index) || index < 0) throw new CliError(`'${text}' is not a device index`);
  if (!devices.some((d) => d.index === index)) {
    throw new CliError(`there is no device [${text}] in the list above`);
  }
  return index;
}

export async function spike(ffmpeg: string, out: string | undefined): Promise<string> {
  const session = out ?? join('captures', `m1-${timestamp(new Date())}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let probeText: string;
  let captured = 0;
  const say = (text: string): void => {
    process.stdout.write(`${text}\n`);
  };
  try {
    const version = await ffmpegVersion(ffmpeg);
    say(`irvis M1 spike. ffmpeg: ${ffmpeg} (${version ?? 'unknown version'}). Session: ${session}`);
    const devices = await listDevices(ffmpeg);
    say(formatDevices(devices));
    if (devices.video.length === 0) {
      throw new CliError(
        'no AVFoundation video devices; connect the camera and run the spike again',
      );
    }
    const guess = guessDevice(devices.video);
    let index: number | null = null;
    while (index === null) {
      const answer = await rl.question(
        `Index of the thermal camera${guess === null ? '' : ` [${String(guess)}]`}: `,
      );
      try {
        index = chooseDevice(answer, guess, devices.video);
      } catch (error) {
        if (!(error instanceof CliError)) throw error;
        say(error.message);
      }
    }

    await mkdir(session, { recursive: true });
    say('Probing the device (modes, pixel formats, USB descriptors)...');
    probeText = await probe(ffmpeg, index);
    await writeFile(join(session, 'probe.txt'), probeText);
    say(probeText);

    for (const s of SCENARIOS) {
      say(`\n== ${s.id} (${String(s.seconds)} s, mode ${s.mode})\n${s.instructions}`);
      const go = await rl.question('Press Enter to start, or type s and Enter to skip: ');
      if (go.trim().toLowerCase() === 's') continue;
      let shown = -1;
      let line: string;
      try {
        line = await captureCommand(ffmpeg, {
          deviceIndex: index,
          seconds: s.seconds,
          mode: modeByRows(s.mode),
          out: join(session, s.id),
          label: s.id,
          referenceCelsius: null,
          onFrame: (_i, ms) => {
            const second = Math.floor(ms / 1000);
            if (second !== shown) {
              shown = second;
              process.stdout.write('.');
            }
          },
        });
      } catch (error) {
        if (!(error instanceof CliError)) throw error;
        say(`\n${error.message}`);
        continue;
      }
      captured++;
      say(`\n${line.trimEnd()}`);
      if (s.askReference) {
        for (;;) {
          const reading = await rl.question(
            'Android app centre reading at the same spot, in °C (Enter if you take it later): ',
          );
          try {
            const value = parseCelsius(reading);
            if (value !== null) await setReference(join(session, s.id), value);
            break;
          } catch (error) {
            if (!(error instanceof CliError)) throw error;
            say(error.message);
          }
        }
      }
    }
  } finally {
    rl.close();
  }
  if (captured === 0) {
    return `No captures; the probe is in ${join(session, 'probe.txt')}.\n`;
  }
  const header = [
    `### M1 spike, session \`${session}\``,
    '',
    '<details><summary>Probe</summary>',
    '',
    '```',
    probeText.trimEnd(),
    '```',
    '',
    '</details>',
    '',
  ].join('\n');
  const report = await reportCommand(session, undefined, header);
  return `${report}\nWritten to ${join(session, 'report.md')}. Paste it into the issue; keep the frames local.\n`;
}

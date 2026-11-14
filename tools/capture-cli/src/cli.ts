/**
 * capture-cli: the hardware spike tool for the InfiRay P2 Pro on macOS.
 *
 * Usage:
 *     node tools/capture-cli/src/cli.ts <command> [options]
 *     npm run capture -- <command> [options]
 *     npm run spike:m1
 *
 * Commands, options, output and exit codes: docs/features/capture-cli-user.md
 * How it works: docs/features/capture-cli-technical.md
 */
import { parseArgs } from 'node:util';
import {
  captureCommand,
  formatDevices,
  listDevices,
  modeByRows,
  probe,
  reportCommand,
  requireMacos,
  setReference,
} from './commands.ts';
import { CliError } from './errors.ts';
import { findFfmpeg } from './ffmpeg.ts';
import { parseCelsius, spike } from './spike.ts';

export const USAGE = `Usage: capture-cli <command> [options]

Commands:
  list                                  AVFoundation video devices and their indexes
  probe --device <index>                modes and pixel formats from AVFoundation, USB descriptors from node-usb
  capture --device <index> --seconds <s> --mode 384|192 --out <dir> [--label <text>] [--reference <°C>]
                                        frames as .yuyv.gz and meta.json in <dir>
  report <dir> [--frame <n>]            measure a capture, or every capture in a session directory
  reference <dir> <°C>                  store the Android app's centre reading for a capture
  spike [--out <dir>]                   the interactive M1 scenarios (npm run spike:m1)

Environment:
  IRVIS_FFMPEG                          ffmpeg to run instead of the first ffmpeg on PATH
`;

/** Thrown for a mistake in the command line: printed with the usage, exit code 2. */
export class UsageError extends Error {}

/** The longest capture: ten hours, well inside what setTimeout can wait. */
export const MAX_SECONDS = 36_000;

function integer(name: string, value: string | undefined, min: number): number {
  if (value === undefined || value.trim() === '') throw new UsageError(`${name} is required`);
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw new UsageError(`${name} must be an integer of at least ${String(min)}, not '${value}'`);
  }
  return n;
}

function positiveNumber(name: string, value: string | undefined): number {
  if (value === undefined || value.trim() === '') throw new UsageError(`${name} is required`);
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_SECONDS) {
    throw new UsageError(
      `${name} must be a positive number of at most ${String(MAX_SECONDS)}, not '${value}'`,
    );
  }
  return n;
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') throw new UsageError(`${name} is required`);
  return value;
}

/** Runs one command line and returns what to print. */
export async function main(argv: readonly string[]): Promise<string> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    return USAGE;
  }
  if (command === 'reference') return referenceCommand(rest);
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      strict: true,
      options: {
        device: { type: 'string' },
        seconds: { type: 'string' },
        mode: { type: 'string' },
        out: { type: 'string' },
        label: { type: 'string' },
        reference: { type: 'string' },
        frame: { type: 'string' },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  switch (command) {
    case 'list': {
      requireMacos(command);
      return formatDevices(await listDevices(findFfmpeg()));
    }
    case 'probe': {
      const device = integer('--device', values.device, 0);
      requireMacos(command);
      return probe(findFfmpeg(), device);
    }
    case 'capture': {
      const deviceIndex = integer('--device', values.device, 0);
      const seconds = positiveNumber('--seconds', values.seconds);
      const out = required('--out', values.out);
      let mode;
      try {
        mode = modeByRows(required('--mode', values.mode));
      } catch (error) {
        if (error instanceof CliError) throw new UsageError(error.message);
        throw error;
      }
      requireMacos(command);
      let referenceCelsius: number | null = null;
      if (values.reference !== undefined) {
        try {
          referenceCelsius = parseCelsius(values.reference);
        } catch (error) {
          throw new UsageError(error instanceof Error ? error.message : String(error));
        }
      }
      return captureCommand(findFfmpeg(), {
        deviceIndex,
        seconds,
        mode,
        out,
        label: values.label ?? null,
        referenceCelsius,
      });
    }
    case 'report': {
      const dir = required('<dir>', positionals[0]);
      const frame = values.frame === undefined ? undefined : integer('--frame', values.frame, 0);
      return reportCommand(dir, frame);
    }
    case 'spike': {
      requireMacos(command);
      return spike(findFfmpeg(), values.out);
    }
    default:
      throw new UsageError(`unknown command '${command}'`);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (output) => {
      process.stdout.write(output);
    },
    (error: unknown) => {
      if (error instanceof UsageError) {
        process.stderr.write(`capture-cli: ${error.message}\n\n${USAGE}`);
        process.exitCode = 2;
      } else if (error instanceof CliError) {
        process.stderr.write(`capture-cli: ${error.message}\n`);
        process.exitCode = 1;
      } else {
        process.stderr.write(
          `capture-cli: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    },
  );
}

/**
 * `reference <dir> <°C>`, read without parseArgs, so that a negative reading
 * such as `-5` is a value and not an unknown option.
 */
async function referenceCommand(args: readonly string[]): Promise<string> {
  const values = args.filter((a) => a !== '--');
  if (values.length > 2)
    throw new UsageError(`reference takes <dir> <°C>, not ${values.join(' ')}`);
  const dir = required('<dir>', values[0]);
  let celsius: number | null;
  try {
    celsius = parseCelsius(required('<°C>', values[1]));
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  if (celsius === null) throw new UsageError('<°C> is required');
  await setReference(dir, celsius);
  return `${dir}: Android reading ${String(celsius)} °C stored; run report again\n`;
}

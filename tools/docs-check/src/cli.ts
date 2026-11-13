// Command-line options for check-docs.ts and decisions-index.ts: long options
// with `=VALUE` or a separate value, unique prefixes of long options, `-h`.
import { encodeEscaped } from './text.ts';

export interface Option {
  long: string;
  short?: string;
  metavar?: string;
  help: string;
}

export interface Output {
  /** Standard output. */
  write(text: string): void;
  /** Standard error. */
  writeError(text: string): void;
}

/** Writes to the process's streams; a path that is not UTF-8 goes out as the bytes it was read from. */
export const processOutput: Output = {
  write: (text) => void process.stdout.write(encodeEscaped(text)),
  writeError: (text) => void process.stderr.write(encodeEscaped(text)),
};

function usage(prog: string, options: Option[]): string {
  const parts = options.map((o) => `[${o.short ?? o.long}${o.metavar ? ` ${o.metavar}` : ''}]`);
  return `usage: ${prog} [-h] ${parts.join(' ')}\n`;
}

function help(prog: string, description: string, options: Option[]): string {
  const rows: [string, string][] = [['-h, --help', 'show this help message and exit']];
  for (const o of options) {
    const name = o.long + (o.metavar ? ` ${o.metavar}` : '');
    rows.push([o.short ? `${o.short}, ${name}` : name, o.help]);
  }
  const width = Math.max(...rows.map(([n]) => n.length));
  const lines = rows.map(([n, h]) => `  ${n.padEnd(width)}  ${h}`);
  return `${usage(prog, options)}\n${description}\n\noptions:\n${lines.join('\n')}\n`;
}

export type Parsed = { values: Map<string, string | true> } | { exit: number };

/**
 * Parse `argv`. Returns the values by long option name, or an exit code after
 * printing the help (0) or a usage error (2).
 */
export function parseArgs(
  argv: readonly string[],
  prog: string,
  description: string,
  options: Option[],
  output: Output,
): Parsed {
  const values = new Map<string, string | true>();
  const fail = (message: string): Parsed => {
    output.writeError(`${usage(prog, options)}${prog}: error: ${message}\n`);
    return { exit: 2 };
  };
  const unrecognized: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '-h' || arg === '--help') {
      output.write(help(prog, description, options));
      return { exit: 0 };
    }
    if (arg === '--') {
      unrecognized.push(...argv.slice(i + 1));
      break;
    }
    let option: Option | undefined;
    let inline: string | undefined;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg : arg.slice(0, eq);
      inline = eq === -1 ? undefined : arg.slice(eq + 1);
      const exact = options.find((o) => o.long === name);
      const prefixed = options.filter((o) => o.long.startsWith(name));
      if (exact) option = exact;
      else if (prefixed.length === 1) option = prefixed[0];
      else if (prefixed.length > 1) {
        const names = prefixed.map((o) => o.long + (inline === undefined ? '' : `=${inline}`));
        return fail(`ambiguous option: ${arg} could match ${names.join(', ')}`);
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      option = options.find((o) => o.short === arg);
    }
    if (!option) {
      unrecognized.push(arg);
      continue;
    }
    if (!option.metavar) {
      if (inline !== undefined) {
        return fail(
          `argument ${option.short ? `${option.short}/` : ''}${option.long}: ignored explicit argument '${inline}'`,
        );
      }
      values.set(option.long, true);
      continue;
    }
    const value = inline ?? argv[i + 1];
    if (value === undefined || (inline === undefined && value.startsWith('-'))) {
      return fail(`argument ${option.long}: expected one argument`);
    }
    if (inline === undefined) i++;
    values.set(option.long, value);
  }
  if (unrecognized.length) return fail(`unrecognized arguments: ${unrecognized.join(' ')}`);
  return { values };
}

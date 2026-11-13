import { describe, expect, it } from 'vitest';
import { type Option, parseArgs } from './cli.ts';

const OPTIONS: Option[] = [
  { long: '--base', metavar: 'REF', help: 'base branch' },
  { long: '--verbose', short: '-v', help: 'list the changed files' },
  { long: '--integrity-only', help: 'integrity checks only' },
];

function parse(argv: string[]) {
  let out = '';
  let err = '';
  const result = parseArgs(argv, 'check-docs.ts', 'Check.', OPTIONS, {
    write: (t) => (out += t),
    writeError: (t) => (err += t),
  });
  return { result, out, err };
}

describe('command-line options', () => {
  it('reads values, flags and unique prefixes', () => {
    const { result } = parse(['--base=origin/x', '-v', '--integ']);
    expect(result).toEqual({
      values: new Map<string, string | true>([
        ['--base', 'origin/x'],
        ['--verbose', true],
        ['--integrity-only', true],
      ]),
    });
    expect(parse(['--base', 'main']).result).toEqual({ values: new Map([['--base', 'main']]) });
  });

  it('prints usage errors and exits 2', () => {
    const usage = 'usage: check-docs.ts [-h] [--base REF] [-v] [--integrity-only]\n';
    expect(parse(['--foo', 'x'])).toEqual({
      result: { exit: 2 },
      out: '',
      err: `${usage}check-docs.ts: error: unrecognized arguments: --foo x\n`,
    });
    expect(parse(['--base']).err).toBe(
      `${usage}check-docs.ts: error: argument --base: expected one argument\n`,
    );
    expect(parse(['--base', '-v']).err).toContain('argument --base: expected one argument');
    expect(parse(['--verbose=1']).err).toContain(
      "argument -v/--verbose: ignored explicit argument '1'",
    );
  });

  it('prints the help and exits 0', () => {
    const { result, out } = parse(['-h']);
    expect(result).toEqual({ exit: 0 });
    expect(out).toBe(
      'usage: check-docs.ts [-h] [--base REF] [-v] [--integrity-only]\n\nCheck.\n\noptions:\n' +
        '  -h, --help        show this help message and exit\n' +
        '  --base REF        base branch\n' +
        '  -v, --verbose     list the changed files\n' +
        '  --integrity-only  integrity checks only\n',
    );
  });
});

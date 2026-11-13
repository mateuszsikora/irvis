// Test helpers for the documentation check: a copy of this repository's
// working tree in a temporary git repository. How the tests run and what they
// need: docs/guides/testing.md#what-each-test-file-needs
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect } from 'vitest';

export const REPO = resolve(import.meta.dirname, '../../..');
export const CHECK_SCRIPT = 'tools/docs-check/src/check-docs.ts';
export const INDEX_SCRIPT = 'tools/docs-check/src/decisions-index.ts';

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

/** The test process's environment without CI, SKIP_DOCS_CHECK and GIT_*, plus a fixed git setup. */
export function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === 'CI' || k === 'SKIP_DOCS_CHECK' || k.startsWith('GIT_')) continue;
    env[k] = v;
  }
  return { ...env, ...GIT_ENV, ...extra };
}

function run(cmd: string, args: string[], cwd: string, env = baseEnv()) {
  return spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
}

/**
 * A temporary git repository holding this repository's working tree (tracked
 * and untracked files that git does not ignore), with one commit on `main`
 * and the branch `feature` checked out. Remove it with `removeTemplate`.
 */
export function makeTemplate(): string {
  const top = mkdtempSync(join(tmpdir(), 'docs-check-'));
  const template = join(top, 'template');
  mkdirSync(template);
  const listed = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], REPO);
  expect(listed.status, listed.stderr).toBe(0);
  for (const rel of [...new Set(listed.stdout.split('\0').filter(Boolean))].sort()) {
    const src = join(REPO, rel);
    const dst = join(template, rel);
    let stat;
    try {
      stat = lstatSync(src);
    } catch {
      continue; // deleted in the working tree
    }
    mkdirSync(dirname(dst), { recursive: true });
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(src), dst);
    else cpSync(src, dst, { preserveTimestamps: true });
  }
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['add', '-A'],
    ['commit', '-q', '-m', 'base'],
    ['switch', '-q', '-c', 'feature'],
  ]) {
    const proc = run('git', args, template);
    expect(proc.status, proc.stderr).toBe(0);
  }
  return template;
}

export function removeTemplate(template: string): void {
  rmSync(dirname(template), { recursive: true, force: true });
}

export interface Result {
  code: number | null;
  out: string;
}

/** A fresh copy of the template repository, on branch `feature`. */
export class Repo {
  readonly root: string;
  private readonly top: string;

  constructor(template: string) {
    this.top = mkdtempSync(join(tmpdir(), 'docs-check-'));
    this.root = join(this.top, 'repo');
    cpSync(template, this.root, { recursive: true, verbatimSymlinks: true });
  }

  remove(): void {
    rmSync(this.top, { recursive: true, force: true });
  }

  git(...args: string[]): string {
    const proc = run('git', args, this.root);
    expect(proc.status, proc.stderr).toBe(0);
    return proc.stdout;
  }

  read(rel: string): string {
    return readFileSync(join(this.root, rel), 'utf8');
  }

  write(rel: string, text: string): void {
    mkdirSync(dirname(join(this.root, rel)), { recursive: true });
    writeFileSync(join(this.root, rel), text);
  }

  append(rel: string, text: string): void {
    appendFileSync(join(this.root, rel), text);
  }

  replace(rel: string, old: string, replacement: string): void {
    const text = this.read(rel);
    expect(text, `fixture text not found in ${rel}`).toContain(old);
    this.write(rel, text.split(old).join(replacement));
  }

  commit(...paths: string[]): void {
    if (paths.length) this.git('add', '-A', '--', ...paths);
    else this.git('add', '-A');
    this.git('commit', '-q', '-m', 'change');
  }

  check(args: string[] = [], env: Record<string, string> = {}): Result {
    const proc = run('node', [CHECK_SCRIPT, ...args], this.root, baseEnv(env));
    return { code: proc.status, out: proc.stdout + proc.stderr };
  }

  passes(args: string[] = [], env: Record<string, string> = {}): string {
    const { code, out } = this.check(args, env);
    expect(code, out).toBe(0);
    return out;
  }

  fails(ruleId: string, args: string[] = [], env: Record<string, string> = {}): string {
    const { code, out } = this.check(args, env);
    expect(code, out).toBe(1);
    expect(out).toContain(`[${ruleId}]`);
    return out;
  }

  integrityFails(needle: string): string {
    const out = this.fails('integrity');
    expect(out).toContain(needle);
    return out;
  }

  runIndex(args: string[] = []): Result {
    const proc = run('node', [INDEX_SCRIPT, ...args], this.root);
    return { code: proc.status, out: proc.stdout + proc.stderr };
  }
}

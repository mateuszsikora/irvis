import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Repo, baseEnv, makeTemplate, removeTemplate } from './repo.ts';

let template: string;
let repo: Repo;

beforeAll(() => {
  template = makeTemplate();
});
afterAll(() => removeTemplate(template));
beforeEach(() => {
  repo = new Repo(template);
});
afterEach(() => repo.remove());

describe('paths that are not UTF-8', () => {
  // Byte 0xff never occurs in UTF-8. APFS (macOS) refuses such a name with
  // EILSEQ; Linux file systems, as in CI, store it.
  const name = Buffer.concat([Buffer.from('caf'), Buffer.from([0xff]), Buffer.from('.ts')]);

  function create(): boolean {
    try {
      writeFileSync(Buffer.concat([Buffer.from(repo.root + '/'), name]), 'x\n');
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EILSEQ') return false;
      throw e;
    }
  }

  it('are printed with their own bytes', (ctx) => {
    if (!create()) ctx.skip();
    const proc = spawnSync('node', [join(repo.root, 'tools/docs-check/src/check-docs.ts'), '-v'], {
      cwd: repo.root,
      env: baseEnv(),
    });
    expect(proc.status).toBe(1);
    expect(proc.stdout.includes(Buffer.concat([Buffer.from('  '), name, Buffer.from('\n')]))).toBe(
      true,
    );
    expect(
      proc.stdout.includes(Buffer.concat([Buffer.from('    '), name, Buffer.from('\n')])),
    ).toBe(true);
    expect(proc.stdout.toString()).toContain('[F0]');
  });
});

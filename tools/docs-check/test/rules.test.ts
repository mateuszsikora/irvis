import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXCLUDE } from '../src/check-docs.ts';
import { Repo, makeTemplate, removeTemplate } from './repo.ts';

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

// .prettierignore stands for any path a rule owns: rule C3 owns it and accepts
// either guide.
const OWNED = '.prettierignore';

function touchOwned(): void {
  repo.append(OWNED, '\n# touched\n');
}

function touchDevGuide(): void {
  repo.append('docs/guides/development.md', '\nTouched.\n');
}

describe('rules', () => {
  it('no changes pass', () => {
    repo.passes();
  });

  it('owned path without doc fails', () => {
    touchOwned();
    repo.commit();
    const out = repo.fails('C3');
    expect(out).toContain(
      '✗ Root TypeScript configuration changed: update docs/guides/development.md',
    );
    expect(out).toContain('    .prettierignore');
    expect(out).toContain('AGENTS.md');
    expect(out).toContain('docs/guides/documentation.md');
  });

  it('owned path with doc passes', () => {
    touchOwned();
    touchDevGuide();
    repo.commit();
    repo.passes();
  });

  it('tests only change passes', () => {
    repo.append('tools/docs-check/test/rules.test.ts', '\n// touched\n');
    repo.write('tools/docs-check/test/data/fixture.txt', 'data\n');
    repo.commit();
    repo.passes();
  });

  it('untracked source counts', () => {
    repo.write('.github/workflows/extra.yml', 'name: extra\n');
    repo.fails('C2');
  });

  it('untracked doc counts', () => {
    repo.write('src/app.ts', 'export {};\n');
    repo.commit();
    repo.write('docs/features/app-technical.md', '# App\n\nWhat it does.\n');
    repo.passes();
  });

  it('staged doc counts', () => {
    touchOwned();
    repo.commit();
    touchDevGuide();
    repo.git('add', 'docs/guides/development.md');
    repo.passes();
  });

  it('unstaged doc counts', () => {
    touchOwned();
    repo.commit();
    touchDevGuide();
    repo.passes();
  });

  it('staged source counts', () => {
    touchOwned();
    repo.git('add', OWNED);
    repo.fails('C3');
  });

  it('unstaged source counts', () => {
    touchOwned();
    repo.fails('C3');
  });

  it('every exclusion needs no doc', () => {
    const samples = [
      'src/app.test.js',
      'web/package-lock.json',
      'LICENSE',
      '.gitignore',
      'docs/notes.md',
      'README.md',
      'AGENTS.md',
      'CONTRIBUTING.md',
      '.github/pull_request_template.md',
      '.claude/settings.json',
      'packages/core/test/helpers.ts',
      'tools/capture-cli/e2e/cli.ts',
      'fixtures/p2pro/frame.yuv',
      'NOTICE',
    ];
    for (const [rx] of EXCLUDE) {
      expect(
        samples.some((p) => new RegExp(rx, 'u').test(p)),
        `no sample for ${rx}`,
      ).toBe(true);
    }
    for (const p of samples) {
      if (existsSync(join(repo.root, p))) repo.append(p, '\n');
      else repo.write(p, p.endsWith('.md') ? '# sample\n' : 'x\n');
    }
    repo.commit();
    repo.passes();
  });

  it('deletion needs doc', () => {
    repo.git('rm', '-q', OWNED);
    repo.commit();
    repo.fails('C3');
  });

  it('package source is not excluded', () => {
    repo.write('packages/core/src/test/frames.ts', 'export const frames = [];\n');
    repo.write('packages/core/testing.ts', 'export {};\n');
    const out = repo.fails('F2');
    expect(out).toContain('    packages/core/src/test/frames.ts');
    expect(out).toContain('    packages/core/testing.ts');
  });

  it('rename needs doc', () => {
    repo.git('mv', '.github/workflows/ci.yml', '.github/workflows/pr.yml');
    repo.commit();
    const out = repo.fails('C2');
    expect(out).toContain('.github/workflows/ci.yml');
  });
});

describe('base branch', () => {
  it('no merge base exits 2', () => {
    repo.git('switch', '-q', '--orphan', 'unrelated');
    repo.git('checkout', 'feature', '--', '.');
    repo.commit();
    const { code, out } = repo.check();
    expect(code, out).toBe(2);
    expect(out).toContain('docs-check: HEAD and main have no merge base');
  });

  it('no base exits 2', () => {
    repo.git('branch', '-m', 'main', 'trunk');
    const { code, out } = repo.check();
    expect(code, out).toBe(2);
    expect(out).toContain('no base branch: neither origin/main nor main exists; pass --base REF');
  });

  it('missing base ref exits 2', () => {
    const { code, out } = repo.check(['--base', 'nope']);
    expect(code, out).toBe(2);
    expect(out).toContain("base ref 'nope' does not exist");
  });

  it('base option', () => {
    repo.git('branch', '-m', 'main', 'trunk');
    touchOwned();
    repo.commit();
    const out = repo.fails('C3', ['--base', 'trunk']);
    expect(out).toContain('against trunk');
  });

  it('origin main before main', () => {
    const base = repo.git('rev-parse', 'main').trim();
    touchOwned();
    repo.commit();
    repo.git('branch', '-f', 'main', 'HEAD');
    repo.git('update-ref', 'refs/remotes/origin/main', base);
    const out = repo.fails('C3');
    expect(out).toContain('against origin/main');
    repo.passes(['--base', 'main']);
  });
});

describe('TypeScript rules', () => {
  it('core needs core doc', () => {
    repo.write('packages/core/src/frames.ts', 'export {};\n');
    repo.commit();
    const out = repo.fails('F2');
    expect(out).not.toContain('[F4]');
    repo.append('docs/features/core-technical.md', '\nTouched.\n');
    repo.passes();
  });

  it('cameras need cameras doc not core doc', () => {
    repo.write('packages/core/src/cameras/index.ts', 'export {};\n');
    repo.append('docs/features/core-technical.md', '\nTouched.\n');
    repo.commit();
    const out = repo.fails('F4');
    expect(out).not.toContain('[F2]');
    repo.append('docs/features/cameras-user.md', '\nTouched.\n');
    repo.passes();
  });

  it('web app and netlify need web app doc', () => {
    for (const path of ['apps/web/src/App.tsx', 'netlify.toml']) {
      repo.write(path, 'x\n');
      repo.fails('F3');
      repo.git('checkout', '-q', '--', path);
    }
    repo.write('netlify.toml', 'x\n');
    repo.append('docs/features/web-app-technical.md', '\nTouched.\n');
    repo.passes();
  });

  it('root configuration needs a guide', () => {
    for (const path of [
      'tsconfig.base.json',
      'tsconfig.json',
      'eslint.config.js',
      'vitest.config.ts',
      '.prettierrc.json',
      '.prettierignore',
      '.nvmrc',
      '.npmrc',
    ]) {
      repo.write(path, 'x\n');
      repo.fails('C3');
      repo.git('checkout', '-q', '--', path);
    }
    repo.write('tsconfig.base.json', 'x\n');
    repo.append('docs/guides/development.md', '\nTouched.\n');
    repo.passes();
  });

  it('package test helpers need no doc', () => {
    repo.append('packages/core/test/profiles.ts', '\n// touched\n');
    repo.append('packages/core/src/cameras/index.test.ts', '\n// touched\n');
    repo.commit();
    repo.passes();
  });
});

describe('carve-outs', () => {
  it('pr template needs no doc', () => {
    repo.append('.github/pull_request_template.md', '\n<!-- touched -->\n');
    repo.commit();
    repo.passes();
  });

  it('new file in github dir is owned', () => {
    repo.write('.github/CODEOWNERS', '* @someone\n');
    repo.commit();
    repo.fails('C2');
  });

  it('check script needs its docs', () => {
    repo.append('tools/docs-check/src/check-docs.ts', '\n// touched\n');
    touchDevGuide();
    repo.commit();
    repo.fails('F1');
  });

  it('check script with technical doc passes', () => {
    repo.append('tools/docs-check/src/decisions-index.ts', '\n// touched\n');
    repo.append('docs/features/docs-contract-technical.md', '\nTouched.\n');
    repo.commit();
    repo.passes();
  });

  it('agent tooling needs no doc', () => {
    repo.write('.claude/rules/example.md', '# Example\n');
    repo.append('AGENTS.md', '\nTouched.\n');
    repo.commit();
    repo.passes();
  });
});

describe('catch-all', () => {
  it('unowned path needs new feature doc', () => {
    repo.write('src/app.ts', 'export {};\n');
    repo.append('docs/features/docs-contract-user.md', '\n');
    repo.commit();
    const out = repo.fails('F0');
    expect(out).toContain('    src/app.ts');
  });

  it('new feature doc satisfies catch all', () => {
    repo.write('src/app.ts', 'export {};\n');
    repo.write('docs/features/app-user.md', '# App\n\nWhat it does.\n');
    repo.commit();
    repo.passes();
  });

  it('moved doc is not new', () => {
    repo.write('src/app.ts', 'export {};\n');
    repo.git('mv', 'docs/features/docs-contract-user.md', 'docs/features/app-user.md');
    repo.commit();
    repo.fails('F0');
  });

  it('deleting unowned path needs no new doc', () => {
    repo.git('switch', '-q', 'main');
    repo.write('src/app.ts', 'export {};\n');
    repo.write('docs/features/app-user.md', '# App\n\nWhat it does.\n');
    repo.commit();
    repo.git('switch', '-q', '-C', 'feature');
    repo.git('rm', '-q', 'src/app.ts', 'docs/features/app-user.md');
    repo.commit();
    repo.passes();
  });

  it('new script is caught', () => {
    repo.write('scripts/release.sh', 'echo release\n');
    touchDevGuide();
    repo.commit();
    repo.fails('F0');
  });
});

describe('skip', () => {
  it('skip works locally', () => {
    touchOwned();
    const out = repo.passes([], { SKIP_DOCS_CHECK: '1' });
    expect(out).toContain('skipped because SKIP_DOCS_CHECK=1');
  });

  it('skip ignored in ci', () => {
    touchOwned();
    const out = repo.fails('C3', [], { SKIP_DOCS_CHECK: '1', CI: 'true' });
    expect(out).toContain('docs-check: SKIP_DOCS_CHECK is ignored because CI is set');
  });
});

describe('output', () => {
  it('success message', () => {
    touchOwned();
    touchDevGuide();
    repo.commit();
    const out = repo.passes();
    expect(out.trim()).toMatch(
      /^docs-check: 2 changed files since main \([0-9a-f]{7,}\), each with the documentation it needs$/,
    );
  });

  it('verbose marks filtered files', () => {
    repo.append('tools/docs-check/test/repo.ts', '\n// touched\n');
    const out = repo.passes(['-v']);
    expect(out).toContain(
      'tools/docs-check/test/repo.ts  (left out: Test helpers and end-to-end tests of a package)',
    );
  });
});

describe('integrity only', () => {
  it('integrity only needs no base', () => {
    repo.git('branch', '-m', 'main', 'trunk');
    touchOwned();
    const out = repo.passes(['--integrity-only']);
    expect(out.trim()).toMatch(/^docs-check: integrity checks pass on \d+ files$/);
  });

  it('integrity only fails on broken link', () => {
    repo.append('docs/guides/testing.md', '\nSee [x](missing.md).\n');
    const out = repo.fails('integrity', ['--integrity-only']);
    expect(out).toContain('docs-check: integrity checks failed:');
  });
});

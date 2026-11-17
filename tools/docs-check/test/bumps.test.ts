import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../src/check-docs.ts';
import { Repo, baseEnv, makeTemplate, removeTemplate } from './repo.ts';

let template: string;
let repo: Repo;

beforeAll(() => {
  template = makeTemplate();
});
afterAll(() => removeTemplate(template));
afterEach(() => repo.remove());

describe('version-bump filter', () => {
  const WORKFLOW = '.github/workflows/ci.yml';

  beforeEach(() => {
    repo = new Repo(template);
  });

  it('bump only passes', () => {
    repo.replace(WORKFLOW, 'actions/checkout@v7', 'actions/checkout@v6.0.2');
    repo.commit();
    const out = repo.passes(['-v']);
    expect(out).toContain(`${WORKFLOW}  (left out: version bump only)`);
  });

  it('bump with other change fails', () => {
    repo.replace(WORKFLOW, 'actions/checkout@v7', 'actions/checkout@v6');
    repo.replace(WORKFLOW, 'timeout-minutes: 5', 'timeout-minutes: 6');
    repo.commit();
    repo.fails('C2');
  });

  it('changed action name is not a bump', () => {
    repo.replace(WORKFLOW, 'actions/checkout@v7', 'someone/checkout@v7');
    repo.commit();
    repo.fails('C2');
  });

  it('moved uses line is not a bump', () => {
    // The TypeScript job is the only one with the npm cache.
    const setup =
      '      - uses: actions/setup-node@v7\n        with:\n          node-version-file: .nvmrc\n          cache: npm\n';
    repo.replace(WORKFLOW, `      - uses: actions/checkout@v7\n${setup}`, setup);
    repo.replace(
      WORKFLOW,
      '      - name: Documentation integrity',
      '      - uses: actions/checkout@v7\n      - name: Documentation integrity',
    );
    repo.commit();
    repo.fails('C2');
  });

  it('crashing filter fails', () => {
    repo.append('.prettierignore', '\n# touched\n');
    repo.append('docs/guides/development.md', '\nTouched.\n');
    repo.commit();
    let out = '';
    const code = main([], {
      root: repo.root,
      env: baseEnv(),
      write: (text) => (out += text),
      isVersionBump: () => {
        throw new Error('filter bug');
      },
    });
    expect(code, out).toBe(1);
    expect(out).toContain(
      '✗ version-bump filter failed on .prettierignore (Error: filter bug); ' +
        'the check fails instead of guessing [filter]',
    );
  });
});

describe('package.json bumps', () => {
  const MANIFEST = `{
  "name": "irvis",
  "private": true,
  "packageManager": "npm@11.0.0",
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
`;

  beforeEach(() => {
    repo = new Repo(template);
    repo.git('switch', '-q', 'main');
    repo.write('package.json', MANIFEST);
    repo.write('packages/core/package.json', MANIFEST.replace('"irvis"', '"@irvis/core"'));
    repo.commit();
    repo.git('switch', '-q', '-C', 'feature');
  });

  it('dependency bump passes', () => {
    repo.replace('package.json', '"react": "^19.0.0"', '"react": "^19.1.0"');
    repo.replace('package.json', '"vitest": "^3.0.0"', '"vitest": "^3.2.4"');
    repo.commit();
    const out = repo.passes(['-v']);
    expect(out).toContain('package.json  (left out: version bump only)');
  });

  it('reformatted bump in a package passes', () => {
    const path = 'packages/core/package.json';
    const text = repo.read(path).replace('"^5.6.0"', '"^5.7.2"');
    repo.write(path, JSON.stringify(JSON.parse(text), null, 4) + '\n');
    repo.commit();
    repo.passes();
  });

  it('engines change fails', () => {
    repo.replace('package.json', '"node": ">=22"', '"node": ">=24"');
    repo.commit();
    const out = repo.fails('C3');
    expect(out).toContain('    package.json');
  });

  it('package manager change fails', () => {
    repo.replace('package.json', '"npm@11.0.0"', '"npm@11.1.0"');
    repo.commit();
    repo.fails('C3');
  });

  it('bump with engines change fails', () => {
    repo.replace('package.json', '"react": "^19.0.0"', '"react": "^19.1.0"');
    repo.replace('package.json', '"node": ">=22"', '"node": ">=24"');
    repo.commit();
    repo.fails('C3');
  });

  it('added dependency fails', () => {
    repo.replace(
      'package.json',
      '"react": "^19.0.0"',
      '"react": "^19.0.0",\n    "react-dom": "^19.0.0"',
    );
    repo.commit();
    repo.fails('C3');
  });

  it('removed dependency fails', () => {
    repo.replace('package.json', '"react": "^19.0.0"', '"react": "^19.1.0"');
    repo.replace(
      'package.json',
      '"typescript": "^5.6.0",\n    "vitest": "^3.0.0"',
      '"typescript": "^5.6.0"',
    );
    repo.commit();
    repo.fails('C3');
  });

  it('alias change fails', () => {
    for (const source of [
      'npm:preact@^10.0.0',
      'github:someone/react',
      'file:../vendor/react',
      'workspace:*',
      'someone/react',
    ]) {
      repo.replace('package.json', '"react": "^19.0.0"', `"react": "${source}"`);
      repo.fails('C3');
      repo.replace('package.json', `"react": "${source}"`, '"react": "^19.0.0"');
    }
  });

  it('dependency moved to another field fails', () => {
    repo.replace(
      'package.json',
      '"react": "^19.0.0"\n',
      '"react": "^19.0.0",\n    "vitest": "^3.0.0"\n',
    );
    repo.replace(
      'package.json',
      '"typescript": "^5.6.0",\n    "vitest": "^3.0.0"',
      '"typescript": "^5.6.0"',
    );
    repo.commit();
    repo.fails('C3');
  });

  it('other value type is not a bump', () => {
    repo.replace('package.json', '"private": true', '"private": 1');
    repo.commit();
    repo.fails('C3');
  });

  it('invalid json is not a bump', () => {
    repo.replace('package.json', '"react": "^19.0.0"', '"react": "^19.1.0",');
    repo.commit();
    const out = repo.fails('C3');
    expect(out).not.toContain('[filter]');
  });
});

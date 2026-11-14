import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { integrity } from '../src/check-docs.ts';
import { REPO, Repo, makeTemplate, removeTemplate } from './repo.ts';

// The section sign, spelled out so this file cites no section itself.
const SECT = '\u00a7';
// "docs" and the rest of a path are kept apart where a fixture holds a broken
// reference, so this file's own comments hold none.
const DOCS = 'docs';

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

describe('integrity', () => {
  const GUIDE = 'docs/guides/testing.md';

  it('broken link fails', () => {
    repo.append(GUIDE, '\nSee [x](missing.md).\n');
    repo.integrityFails('points to a missing file: docs/guides/missing.md');
  });

  it('broken anchor fails', () => {
    repo.append(GUIDE, '\nSee [x](development.md#no-such-heading).\n');
    repo.integrityFails('points to a missing heading: docs/guides/development.md#no-such-heading');
  });

  it('link outside repository fails', () => {
    repo.append(GUIDE, '\nSee [x](../../../outside.md).\n');
    repo.integrityFails('points outside the repository');
  });

  it('wrong case fails', () => {
    repo.append(GUIDE, '\nSee [x](Development.md).\n');
    repo.integrityFails('points to a missing file: docs/guides/Development.md');
  });

  it('code is ignored', () => {
    repo.append(GUIDE, '\n```md\n[x](missing.md)\n```\n\nInline: `[x](missing.md)`.\n');
    repo.passes();
  });

  it('valid anchor passes', () => {
    repo.append(GUIDE, '\nSee [x](../decisions/README.md#documentation-contract).\n');
    repo.passes();
  });

  it('docs path in code span must exist', () => {
    repo.append(GUIDE, '\nUpdate `docs/guides/nope.md`.\n');
    repo.integrityFails('points to a missing file: docs/guides/nope.md');
  });

  it('comment reference must exist', () => {
    repo.write('tools/docs-check/test/helper.ts', `// see ${DOCS}/guides/testing.md#nope\n`);
    repo.integrityFails('points to a missing heading: docs/guides/testing.md#nope');
  });

  it('line number link fails', () => {
    repo.append(GUIDE, '\nSee [d](../decisions/docs.md#L3).\n');
    repo.integrityFails('uses a line number (#L3)');
  });

  it('line number text fails', () => {
    repo.append(GUIDE, '\nSee docs/decisions/docs.md:12 for why.\n');
    repo.integrityFails("'docs/decisions/docs.md:12' refers to a line number");
  });

  it('line number in comment fails', () => {
    repo.write('tools/docs-check/test/helper.ts', `// why: ${DOCS}/decisions/docs.md` + ':12\n');
    repo.integrityFails('refers to a line number');
  });

  it('section citation of unknown doc fails', () => {
    repo.append(GUIDE, `\nAs the plan ${SECT}4.2 says.\n`);
    repo.integrityFails(`'plan ${SECT}4.2' cites an unknown document`);
  });

  it('section citation needs heading', () => {
    repo.write('docs/design.md', '# Design\n\n## 1. Scope\n\nText.\n');
    repo.append(GUIDE, `\nSee ../design.md ${SECT}1 and ../design.md ${SECT}2.\n`);
    const out = repo.integrityFails('docs/design.md has no heading for section 2');
    expect(out).not.toContain('section 1');
  });

  it('section alias resolves', () => {
    repo.write('docs/design.md', '# Design\n\n## 4.2 Limits\n\nText.\n');
    repo.write('tools/docs-check/test/helper.ts', `// as design ${SECT}4.2 says\n`);
    expect(integrity(repo.root, { sectionAliases: { design: 'docs/design.md' } })).toEqual([]);
  });

  it('stale decisions index fails', () => {
    repo.append(
      'docs/decisions/docs.md',
      '\n## Something new was decided\n\nStatus: decided\n\nWhy.\n',
    );
    repo.integrityFails('docs/decisions/README.md is stale');
    const { code, out } = repo.runIndex();
    expect(code, out).toBe(0);
    repo.passes();
  });

  it('unlisted decision file fails', () => {
    repo.write('docs/decisions/other.md', '# Other\n');
    repo.integrityFails('docs/decisions/other.md is not listed in DOMAINS');
  });

  it('map row differs fails', () => {
    repo.replace('docs/features/README.md', 'CI or GitHub configuration changed:', 'CI changed:');
    repo.integrityFails('rule C2: message differs from RULES');
  });

  it('map row missing fails', () => {
    repo.write(
      'docs/features/README.md',
      repo.read('docs/features/README.md').replace(/^\| C2 \|.*\n/gm, ''),
    );
    repo.integrityFails('rule C2 from RULES is missing from the ownership-map table');
  });

  it('map row extra fails', () => {
    repo.replace('docs/features/README.md', '| C2 |', '| C9 | `^x$` | `^y$` | Extra |\n| C2 |');
    repo.integrityFails('rule C9 is not in RULES');
  });

  it('map row twice fails', () => {
    const text = repo.read('docs/features/README.md');
    const row = /^\| C2 \|.*\n/m.exec(text)?.[0] ?? '';
    expect(row).not.toBe('');
    repo.write(
      'docs/features/README.md',
      text.replace(row, () => row + row),
    );
    repo.integrityFails('rule C2 appears twice');
  });

  it('map regex not code span fails', () => {
    repo.replace(
      'docs/features/README.md',
      '| F4 | `^packages/core/src/cameras/` |',
      '| F4 | ^packages/core/src/cameras/ |',
    );
    repo.integrityFails('rule F4: write both regexes as code spans');
  });

  it('map unescaped pipe fails', () => {
    repo.replace(
      'docs/features/README.md',
      '`^packages/core/src/cameras/`',
      '`^packages/core|src/cameras/`',
    );
    repo.integrityFails('ownership-map row needs 4 cells, has 5');
  });

  it('exclusion twice fails', () => {
    repo.replace(
      'docs/features/README.md',
      '| `^\\.gitignore$` | Git ignore list |\n',
      '| `^\\.gitignore$` | Git ignore list |\n| `^\\.gitignore$` | Git ignore list |\n',
    );
    repo.integrityFails('appears twice');
  });

  it('exclusion differs fails', () => {
    repo.replace('docs/features/README.md', '| Licence |', '| Licence file |');
    repo.integrityFails('reason differs from EXCLUDE');
  });

  it('duplicate invariant fails', () => {
    repo.append(
      'docs/invariants.md',
      '\n- **1.** A second rule one.\n  - `tools/docs-check/test/rules.test.ts::rules::no changes pass`\n',
    );
    repo.integrityFails('invariant 1 is already used');
  });

  it('ordered list invariant fails', () => {
    repo.append('docs/invariants.md', '\n1. An ordered item.\n');
    repo.integrityFails('list item is not of the form');
  });

  it('invariant without test fails', () => {
    repo.append('docs/invariants.md', '\n- **99.** No test enforces this.\n');
    repo.integrityFails('invariant 99 names no test');
  });

  it('invariant with missing test fails', () => {
    repo.append(
      'docs/invariants.md',
      '\n- **99.** A rule.\n  - `tools/docs-check/test/rules.test.ts::rules::nope`\n',
    );
    repo.integrityFails(
      'invariant 99: tools/docs-check/test/rules.test.ts::rules::nope: ' +
        'no it("nope") or test("nope") in tools/docs-check/test/rules.test.ts',
    );
  });

  it('struck invariant needs no test', () => {
    repo.append(
      'docs/invariants.md',
      '\n- **99.** ~~A retired rule.~~ Retired because it stopped holding.\n',
    );
    repo.passes();
  });
});

describe('Vitest ids', () => {
  const SPEC = 'packages/core/src/vitest-ids-fixture.test.ts';

  beforeEach(() => {
    repo.write(
      SPEC,
      `import { describe, expect, it, test } from "vitest";

describe("decodeYUYV", () => {
  describe("thermal half", () => {
    it("reads lo and hi bytes", () => {
      expect(1).toBe(1);
    });
  });
  test(
    'keeps the "image" half',
    () => {},
  );
  it("says \\"don\\'t\\" \\u00e9", () => {});
  it(\`template \${1}\`, () => {});
  it.each([1, 2])("each %i", () => {});
  it("con" + "cat", () => {});
});

describe("encodeYUYV", () => {
  it("round-trips", () => {});
});
`,
    );
  });

  function addId(testId: string): void {
    repo.append('docs/invariants.md', `\n- **99.** A rule.\n  - \`${SPEC}::${testId}\`\n`);
  }

  it('vitest id passes', () => {
    addId('decodeYUYV::thermal half::reads lo and hi bytes');
    for (const testId of [
      'decodeYUYV::keeps the "image" half',
      'decodeYUYV::says "don\'t" \u00e9',
      'encodeYUYV::round-trips',
      'round-trips',
    ]) {
      repo.append('docs/invariants.md', `  - \`${SPEC}::${testId}\`\n`);
    }
    repo.passes();
  });

  it('vitest id with missing name fails', () => {
    addId('decodeYUYV::reads nothing');
    repo.integrityFails(`no it("reads nothing") or test("reads nothing") in ${SPEC}`);
  });

  it('vitest id with missing describe fails', () => {
    addId('decode::reads lo and hi bytes');
    repo.integrityFails(`no describe("decode") in ${SPEC}`);
  });

  it('vitest id out of order fails', () => {
    addId('thermal half::decodeYUYV::reads lo and hi bytes');
    repo.integrityFails(
      `describe("decodeYUYV") does not come after describe("thermal half") in ${SPEC}`,
    );
  });

  it('vitest id needs a plain literal', () => {
    for (const name of ['template ${1}', 'each %i', 'con']) {
      addId(`decodeYUYV::${name}`);
      repo.integrityFails(`no it("${name}") or test("${name}")`);
      repo.replace(
        'docs/invariants.md',
        `\n- **99.** A rule.\n  - \`${SPEC}::decodeYUYV::${name}\`\n`,
        '',
      );
    }
  });

  it('vitest id with wrong nesting passes', () => {
    // Known limitation: names are found in order, not in their real nesting.
    // "round-trips" is under encodeYUYV, not under decodeYUYV.
    addId('decodeYUYV::round-trips');
    repo.passes();
  });
});

describe('this repository', () => {
  it('integrity of this repository', () => {
    expect(integrity(REPO)).toEqual([]);
  });
});

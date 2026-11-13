import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// The import rule for the check's own code, run on snippets as if they were
// files of tools/docs-check/src/. Type-aware rules are off: the files do not exist.
const ROOT = resolve(import.meta.dirname, '../../..');
const eslint = new ESLint({ cwd: ROOT, overrideConfig: [tseslint.configs.disableTypeChecked] });

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, filePath) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse');
}

const SRC = 'tools/docs-check/src/probe.ts';

describe('docs-check imports', () => {
  it('allow Node built-ins and relative paths', async () => {
    const code =
      "import { readFileSync } from 'node:fs';\nimport { strip } from './text.ts';\n" +
      'export const x = [readFileSync, strip];\n';
    expect(await ruleIds(SRC, code)).toEqual([]);
  });

  it('reject packages, bare Node names and import()', async () => {
    for (const code of [
      "import { describe } from 'vitest';",
      "import ts from 'typescript';",
      "import fs from 'fs';",
      "export const m = import('node:fs');",
    ]) {
      expect(await ruleIds(SRC, `${code}\nexport {};\n`), code).toContain(
        code.includes('import(') ? 'no-restricted-syntax' : 'no-restricted-imports',
      );
    }
  });

  it('do not apply to the tests', async () => {
    const code = "import { describe } from 'vitest';\nexport const d = describe;\n";
    expect(await ruleIds('tools/docs-check/src/probe.test.ts', code)).toEqual([]);
  });
});

import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// The ESLint rules from the architecture decisions, run on snippets as if
// they were files of core. Type-aware rules are off: the files do not exist.
const ROOT = resolve(import.meta.dirname, '../../..');
const eslint = new ESLint({ cwd: ROOT, overrideConfig: [tseslint.configs.disableTypeChecked] });

async function problems(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, filePath) });
  return (result?.messages ?? []).map((m) => `${m.ruleId ?? 'parse'}: ${m.message}`);
}

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  return (await problems(filePath, code)).map((p) => p.slice(0, p.indexOf(':')));
}

const ANALYSIS = 'packages/core/src/analysis/probe.ts';
const CORE = 'packages/core/src/probe.ts';
const DISABLE = 'eslint-disable-next-line no-restricted-syntax';

describe('core imports', () => {
  it('rejects Node modules', async () => {
    for (const code of [
      "import { readFileSync } from 'node:fs';",
      "import fs from 'fs';",
      "import { join } from 'path/posix';",
    ]) {
      expect(await ruleIds(CORE, `${code}\nexport {};\n`), code).toContain('no-restricted-imports');
    }
  });

  it('rejects the UI, media and backend packages', async () => {
    for (const name of [
      '@irvis/ui',
      '@irvis/media',
      '@irvis/backend-browser',
      '@irvis/backend-replay',
    ]) {
      expect(await ruleIds(CORE, `import '${name}';\n`), name).toEqual(['no-restricted-imports']);
    }
  });

  it('rejects packages that core does not declare', async () => {
    for (const code of [
      "import { useState } from 'react';\nexport { useState };",
      "import type { Plugin } from 'vite';\nexport type { Plugin };",
      "export { describe } from 'vitest';",
      "import { deflate } from 'fflate/node';\nexport { deflate };",
    ]) {
      expect(await ruleIds(CORE, `${code}\n`), code).toEqual(['no-restricted-imports']);
    }
  });

  it('rejects dynamic import()', async () => {
    const code = "export async function f() {\n  return import('react');\n}\n";
    for (const path of [CORE, ANALYSIS]) {
      expect(await ruleIds(path, code), path).toEqual(['no-restricted-syntax']);
    }
  });

  it('allows relative imports', async () => {
    const code =
      "import type { ThermalFrame } from './frames.ts';\nimport { x } from '../y.ts';\nexport type { ThermalFrame };\nexport { x };\n";
    expect(await ruleIds('packages/core/src/cameras/probe.ts', code)).toEqual([]);
  });

  it('allows vitest only in tests next to the code', async () => {
    const code = "import { it } from 'vitest';\nit('x', () => {});\n";
    expect(await ruleIds('packages/core/src/cameras/probe.test.ts', code)).toEqual([]);
    expect(await ruleIds('packages/core/src/cameras/probe.test.ts', "import 'node:fs';\n")).toEqual(
      ['no-restricted-imports'],
    );
  });

  it('allows only the synchronous fflate functions', async () => {
    expect(
      await ruleIds(
        CORE,
        "import { zlibSync, unzlibSync } from 'fflate';\nexport { zlibSync, unzlibSync };\n",
      ),
    ).toEqual([]);
    expect(await ruleIds(CORE, "import { deflate } from 'fflate';\nexport { deflate };\n")).toEqual(
      ['no-restricted-imports'],
    );
    expect(await ruleIds(CORE, "import * as fflate from 'fflate';\nexport { fflate };\n")).toEqual([
      'no-restricted-imports',
    ]);
  });

  it('leaves other packages alone', async () => {
    expect(
      await ruleIds(
        'apps/web/src/probe.ts',
        "import { join } from 'node:path';\nexport const p = join('a');\n",
      ),
    ).toEqual([]);
  });
});

describe('Math allow-list', () => {
  it('allows correctly rounded functions in measurement code', async () => {
    const code =
      'export const f = (x: number) => Math.sqrt(Math.abs(x)) * Math.PI + Math.fround(x);\n';
    for (const dir of ['analysis', 'corrections', 'cameras', 'irvis', 'reconstruction']) {
      expect(await ruleIds(`packages/core/src/${dir}/probe.ts`, code), dir).toEqual([]);
    }
  });

  it('rejects approximated functions and indirect access', async () => {
    for (const code of [
      'export const f = (x: number) => Math.pow(x, 4);',
      'export const f = (x: number) => Math.exp(x);',
      "export const f = (x: number) => Math['sqrt'](x);",
      'export const m = Math;',
      'export const { log } = Math;',
      'export const f = (x: number) => globalThis.Math.sqrt(x);',
      'export const f = (x: number) => x ** 4;',
      'export function f(x: number) { x **= 2; return x; }',
    ]) {
      expect(await ruleIds(ANALYSIS, `${code}\n`), code).toContain('no-restricted-syntax');
    }
  });

  it('does not apply outside measurement code', async () => {
    expect(
      await ruleIds(CORE, 'export const f = (x: number) => Math.pow(x, 4) + x ** 2;\n'),
    ).toEqual([]);
  });

  it('lets a disable comment suppress the rule', async () => {
    const code = `// ${DISABLE} -- docs/decisions/architecture.md#measurement-code-uses-only-correctly-rounded-arithmetic\nexport const f = (x: number) => Math.exp(x);\n`;
    expect(await problems(ANALYSIS, code)).toEqual([]);
  });
});

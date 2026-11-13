// ESLint flat config. What each block enforces and why:
// docs/guides/development.md#lint-and-format
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Core imports only its own files and fflate: no Node modules, no other irvis
// package, nothing hoisted into node_modules by another workspace.
// docs/decisions/architecture.md#core-uses-only-apis-that-browsers-and-node-share
const CORE_IMPORT_MESSAGE =
  'Core imports only its own files (relative paths) and fflate (docs/decisions/architecture.md#core-uses-only-apis-that-browsers-and-node-share).';
const CORE_TEST_IMPORT_MESSAGE =
  'Tests in packages/core/src/ import only relative paths, fflate and vitest; tests that need Node go to packages/core/test/ (docs/guides/testing.md#add-a-typescript-test).';

// fflate's synchronous API; the asynchronous one starts Workers.
const FFLATE_SYNC = [
  'deflateSync',
  'inflateSync',
  'gzipSync',
  'gunzipSync',
  'zlibSync',
  'unzlibSync',
  'compressSync',
  'decompressSync',
  'zipSync',
  'unzipSync',
  'strToU8',
  'strFromU8',
  'Deflate',
  'Inflate',
  'Gzip',
  'Gunzip',
  'Zlib',
  'Unzlib',
  'Compress',
  'Decompress',
  'Zip',
  'ZipDeflate',
  'ZipPassThrough',
  'Unzip',
  'UnzipInflate',
  'UnzipPassThrough',
  'EncodeUTF8',
  'DecodeUTF8',
  'FlateError',
];

// Members of Math that ECMAScript requires to be exact or correctly rounded:
// docs/decisions/architecture.md#measurement-code-uses-only-correctly-rounded-arithmetic
export const MATH_ALLOWED = [
  'abs',
  'min',
  'max',
  'floor',
  'ceil',
  'round',
  'trunc',
  'sign',
  'sqrt',
  'fround',
  'imul',
  'clz32',
  'PI',
  'E',
  'SQRT2',
  'SQRT1_2',
  'LN2',
  'LN10',
  'LOG2E',
  'LOG10E',
];

// import() would get past no-restricted-imports. Flat config replaces a rule's
// options instead of merging them, so the measurement block repeats this.
const NO_DYNAMIC_IMPORT = {
  selector: 'ImportExpression',
  message:
    'Core does not load modules with import(); use a static import (docs/decisions/architecture.md#core-uses-only-apis-that-browsers-and-node-share).',
};

export const MEASUREMENT_DIRS = ['analysis', 'corrections', 'cameras', 'irvis', 'reconstruction'];

const MATH_MESSAGE =
  'engines may approximate it, so readings would differ between Chrome and Safari. ' +
  'An exception is an eslint-disable comment naming its decision ' +
  '(docs/decisions/architecture.md#measurement-code-uses-only-correctly-rounded-arithmetic).';

const MATH_RULES = [
  {
    selector: `MemberExpression[object.name='Math'][computed=false]:not([property.name=/^(${MATH_ALLOWED.join('|')})$/])`,
    message: `Math member outside the allow-list: ${MATH_MESSAGE}`,
  },
  {
    selector: "MemberExpression[object.name='Math'][computed=true]",
    message: `Math accessed with a computed name: ${MATH_MESSAGE}`,
  },
  {
    selector: "Identifier[name='Math']:not(MemberExpression > Identifier.object)",
    message: `Math used other than as Math.<name>: ${MATH_MESSAGE}`,
  },
  {
    selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
    message: `The ** operator: ${MATH_MESSAGE}`,
  },
];

export default defineConfig(
  {
    // ESLint does not read .gitignore; these are the ignored paths it would otherwise lint.
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/', '.context/', '.claude/worktrees/'],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.d.ts'],
    rules: { 'no-var': 'off' },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ regex: '^(?!\\.{1,2}/|fflate$)', message: CORE_IMPORT_MESSAGE }],
          paths: [
            {
              name: 'fflate',
              allowImportNames: FFLATE_SYNC,
              message:
                'Core uses only the synchronous fflate functions (docs/decisions/architecture.md#core-uses-only-apis-that-browsers-and-node-share).',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', NO_DYNAMIC_IMPORT],
    },
  },
  {
    files: ['packages/core/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^(?!\\.{1,2}/|fflate$|vitest$)', message: CORE_TEST_IMPORT_MESSAGE },
          ],
          paths: [
            {
              name: 'fflate',
              allowImportNames: FFLATE_SYNC,
              message:
                'Core uses only the synchronous fflate functions (docs/decisions/architecture.md#core-uses-only-apis-that-browsers-and-node-share).',
            },
          ],
        },
      ],
    },
  },
  {
    // Exceptions are disable comments that name a decision; ESLint cannot
    // enforce that against its own directives, so a test does:
    // packages/core/test/eslint-directives.test.ts
    files: MEASUREMENT_DIRS.map((d) => `packages/core/src/${d}/**/*.ts`),
    rules: {
      'no-restricted-syntax': ['error', NO_DYNAMIC_IMPORT, ...MATH_RULES],
    },
  },
);

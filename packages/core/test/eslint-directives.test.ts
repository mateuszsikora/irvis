import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';

// An exception to a lint rule in core is a disable comment that names the
// rules it disables and the decision that allows it. ESLint cannot enforce
// this itself: a directive can silence the very rule that checks directives.
// docs/features/core-technical.md#configuration
const ROOT = resolve(import.meta.dirname, '../../..');
const SRC = join(ROOT, 'packages/core/src');

const DIRECTIVE =
  /^(eslint-disable-next-line|eslint-disable-line|eslint-disable|eslint-enable|eslint-env|eslint|globals|global|exported)(?=\s|$)/;
const DECISION = /docs\/decisions\/[a-z0-9_-]+\.md#[a-z0-9_-]+/;

/** Problems with the ESLint directive comments of one file, as `<file>:<line>: <problem>`. */
export function directiveProblems(file: string, code: string): string[] {
  const { comments = [] } = parse(code, { comment: true, loc: true, jsx: file.endsWith('.tsx') });
  const out: string[] = [];
  for (const comment of comments) {
    const text = comment.value.trim();
    const match = DIRECTIVE.exec(text);
    if (!match) continue;
    const [keyword] = match;
    const where = `${file}:${String(comment.loc.start.line)}`;
    // In a // comment ESLint honours only these two; any other keyword there is plain text.
    const lineDirective =
      keyword === 'eslint-disable-line' || keyword === 'eslint-disable-next-line';
    if (String(comment.type) === 'Line' && !lineDirective) continue;
    if (keyword === 'eslint-enable') continue;
    if (!keyword.startsWith('eslint-disable')) {
      out.push(`${where}: inline configuration ("${keyword} ...") is not allowed in core`);
      continue;
    }
    const [head = '', reason = ''] = text.split(/\s-{2,}\s/, 2);
    if (head.slice(keyword.length).trim() === '') {
      out.push(`${where}: "${keyword}" without rule names disables every rule; name the rules`);
    }
    if (!DECISION.test(reason)) {
      out.push(
        `${where}: "${keyword}" names no decision; add "-- docs/decisions/<file>.md#<decision>"`,
      );
    }
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const DECIDED =
  'docs/decisions/architecture.md#measurement-code-uses-only-correctly-rounded-arithmetic';
const CODE = 'Math.exp(x);';

describe('eslint directives in core', () => {
  it('name their rules and a decision in every file of packages/core/src', () => {
    const problems = sourceFiles(SRC).flatMap((path) =>
      directiveProblems(relative(ROOT, path), readFileSync(path, 'utf8')),
    );
    expect(problems).toEqual([]);
  });

  it('accepts a disable comment with rules and a decision', () => {
    for (const code of [
      `${CODE} // eslint-disable-line no-restricted-syntax -- ${DECIDED}`,
      `// eslint-disable-next-line no-restricted-syntax -- needed for Planck, see ${DECIDED}\n${CODE}`,
      `/* eslint-disable no-restricted-syntax -- ${DECIDED} */\n${CODE}\n/* eslint-enable no-restricted-syntax */`,
    ]) {
      expect(directiveProblems('p.ts', code), code).toEqual([]);
    }
  });

  it('rejects a disable comment without rules', () => {
    for (const code of [
      `${CODE} // eslint-disable-line`,
      `/* eslint-disable -- ${DECIDED} */\n${CODE}`,
      `/* eslint-disable */\n${CODE}`,
    ]) {
      expect(directiveProblems('p.ts', code).join('\n'), code).toContain('without rule names');
    }
  });

  it('rejects a disable comment without a decision', () => {
    for (const code of [
      `${CODE} // eslint-disable-line no-restricted-syntax`,
      `// eslint-disable-next-line no-restricted-syntax -- needed for the Planck curve\n${CODE}`,
      `/* eslint-disable no-restricted-syntax, irvis/anything */\n${CODE}`,
    ]) {
      expect(directiveProblems('p.ts', code).join('\n'), code).toContain('names no decision');
    }
  });

  it('rejects inline configuration', () => {
    for (const [comment, keyword] of [
      ['/* eslint no-restricted-syntax: "off" */', 'eslint'],
      ['/* eslint-env node */', 'eslint-env'],
      ['/* global Math */', 'global'],
      ['/* globals Math */', 'globals'],
      ['/* exported f */', 'exported'],
    ]) {
      expect(directiveProblems('p.ts', `${comment}\n${CODE}`), comment).toEqual([
        `p.ts:1: inline configuration ("${keyword} ...") is not allowed in core`,
      ]);
    }
  });

  it('ignores comments and strings that only mention eslint', () => {
    const code = [
      '// see the eslint-disable rules in the guide',
      '// exported for the tests',
      '// global offset of the thermal rows',
      '// eslint-disable has no effect in a line comment',
      '// eslint no-restricted-syntax: "off" is plain text here too',
      "export const s = '// eslint-disable-line';",
      '',
    ].join('\n');
    expect(directiveProblems('p.ts', code)).toEqual([]);
  });
});

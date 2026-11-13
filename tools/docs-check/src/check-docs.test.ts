import { describe, expect, it } from 'vitest';
import {
  EXCLUDE,
  GitError,
  RULES,
  excluded,
  jsUnescape,
  missingTest,
  parseTestId,
} from './check-docs.ts';

describe('check-docs helpers', () => {
  it('compiles every rule and exclusion as a Unicode regex', () => {
    for (const rule of RULES) {
      expect(() => new RegExp(rule.source, 'u'), rule.id).not.toThrow();
      expect(() => new RegExp(rule.docs, 'u'), rule.id).not.toThrow();
    }
    for (const [rx] of EXCLUDE) expect(() => new RegExp(rx, 'u'), rx).not.toThrow();
    expect(excluded('tools/docs-check/test/repo.ts')).toBe(
      'Test helpers and end-to-end tests of a package',
    );
    expect(excluded('tools/docs-check/src/check-docs.ts')).toBeNull();
  });

  it('GitError names itself in messages', () => {
    const e = new GitError('git diff failed');
    expect(`${e.name}: ${e.message}`).toBe('GitError: git diff failed');
  });

  it('jsUnescape resolves escapes as JavaScript does', () => {
    expect(jsUnescape('say \\"hi\\" \\\'x\\\'')).toBe('say "hi" \'x\'');
    expect(jsUnescape('\\n\\t\\b\\f\\v\\r\\0\\\\')).toBe('\n\t\b\f\v\r\0\\');
    expect(jsUnescape('\\x41\\u00e9\\u{1F600}\\ud83d\\ude00')).toBe('A\u00e9\u{1f600}\u{1f600}');
    expect(jsUnescape('\\q\\u12\\x4')).toBe('qu12x4');
    expect(jsUnescape('\\u{110000}')).toBe('\u{10ffff}');
  });

  it('parseTestId splits at :: and rejects ambiguous names', () => {
    expect(parseTestId('a.test.ts::d::it')).toEqual(['a.test.ts', ['d', 'it']]);
    expect(parseTestId('a.test.ts::say "hi"')).toEqual(['a.test.ts', ['say "hi"']]);
    for (const bad of [
      'a.test.ts',
      '::x',
      'c:/a.ts::x',
      'a.ts::',
      'a.ts:::x',
      'a.ts::x:',
      'a.ts::d::::x',
    ]) {
      expect(parseTestId(bad), bad).toBeNull();
    }
  });

  it('missingTest finds the names in order and reports what is missing', () => {
    const body =
      'describe("A", () => {\n  it(\'x\', () => {});\n});\ndescribe("B", () => { test("y", f) });\n';
    expect(missingTest('p.ts', body, ['A', 'x'])).toBeNull();
    expect(missingTest('p.ts', body, ['B', 'y'])).toBeNull();
    expect(missingTest('p.ts', body, ['A', 'y'])).toBeNull(); // nesting is not verified
    expect(missingTest('p.ts', body, ['B', 'x'])).toBe(
      'it("x") or test("x") does not come after describe("B") in p.ts',
    );
    expect(missingTest('p.ts', body, ['C', 'x'])).toBe('no describe("C") in p.ts');
    expect(missingTest('p.ts', body, ['say "hi"'])).toBe(
      'no it("say \\"hi\\"") or test("say \\"hi\\"") in p.ts',
    );
  });
});

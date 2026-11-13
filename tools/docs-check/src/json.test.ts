import { describe, expect, it } from 'vitest';
import { canonical, jsonEquals, loadJson } from './json.ts';

const load = (text: string) => loadJson(Buffer.from(text, 'utf8'));
const canon = (text: string) => {
  const value = load(text);
  expect(value, text).not.toBeNull();
  return canonical(value);
};

describe('package.json reader', () => {
  it('rejects a repeated key in any object', () => {
    expect(load('{"a": 1, "a": 1}')).toBeNull();
    expect(load('{"x": {"b": 1, "b": 2}}')).toBeNull();
    expect(load('[{"c": 1}, {"c": 1}]')).not.toBeNull();
  });

  it('rejects what JSON does not allow and accepts NaN and Infinity', () => {
    for (const bad of [
      '[1,]',
      '{"a":1,}',
      '{"a": 01}',
      '\ufeff{}',
      '{"a": "x\ty"}',
      '{"a": "\\x"}',
      '-',
      '',
      '{} x',
    ]) {
      expect(load(bad), bad).toBeNull();
    }
    for (const good of [' {"a": NaN} ', '[-Infinity, Infinity]', '"\\ud800"', '1e400', '-0.0']) {
      expect(load(good), good).not.toBeNull();
    }
    expect(loadJson(Buffer.from([0x7b, 0xff, 0x7d]))).toBeNull();
  });

  it('canonical keeps true and 1, and 1 and 1.0, apart but ignores key order', () => {
    expect(canon('{"a": true}')).not.toBe(canon('{"a": 1}'));
    expect(canon('{"a": 1}')).not.toBe(canon('{"a": 1.0}'));
    expect(canon('{"a": 1E2}')).toBe(canon('{"a": 100.0}'));
    expect(canon('{"a": 1E2}')).not.toBe(canon('{"a": 100}'));
    expect(canon('{"a": -0.0}')).not.toBe(canon('{"a": 0.0}'));
    expect(canon('{"a": 1, "b": [2, {"c": null}]}')).toBe(canon('{"b": [2, {"c": null}], "a": 1}'));
    expect(canon('{"a": 12345678901234567890123}')).not.toBe(
      canon('{"a": 12345678901234567890124}'),
    );
  });

  it('jsonEquals compares numbers by value, with true equal to 1', () => {
    const eq = (a: string, b: string) => jsonEquals(load(a), load(b));
    expect(eq('1', 'true')).toBe(true);
    expect(eq('1', '1.0')).toBe(true);
    expect(eq('0', 'false')).toBe(true);
    expect(eq('9007199254740993', '9007199254740992.0')).toBe(false);
    expect(eq('NaN', 'NaN')).toBe(false);
    expect(eq('{"a": [1, 2]}', '{"a": [1.0, 2]}')).toBe(true);
    expect(eq('"1"', '1')).toBe(false);
    expect(eq('null', 'false')).toBe(false);
  });
});

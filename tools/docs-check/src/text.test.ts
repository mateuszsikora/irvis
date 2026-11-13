import { describe, expect, it } from 'vitest';
import {
  compareCodePoints,
  decodeEscaped,
  dirnamePath,
  encodeEscaped,
  joinPath,
  normPath,
  repr,
  splitLines,
  strip,
  unquote,
} from './text.ts';

describe('text helpers', () => {
  it('strip removes the whitespace str.isspace knows, not a byte order mark', () => {
    expect(strip('\x1c\x1f \u00a0\u3000x\u2028\t')).toBe('x');
    expect(strip('\ufeffx ')).toBe('\ufeffx');
    expect(strip('  x  ', ' ')).toBe('x');
  });

  it('splitLines splits at every line boundary and keeps a final empty line once', () => {
    expect(splitLines('a\r\nb\rc\vd\fe\x1cf\x85g\u2028h\u2029i\n')).toEqual('abcdefghi'.split(''));
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    expect(splitLines('\u000bx')).toEqual(['', 'x']);
  });

  it('repr quotes values as the messages show them', () => {
    expect(repr('plain')).toBe("'plain'");
    expect(repr("it's")).toBe('"it\'s"');
    expect(repr('both \' and "')).toBe("'both \\' and \"'");
    expect(repr('tab\there\nnl\\')).toBe("'tab\\there\\nnl\\\\'");
    expect(repr('\x00\x7f\x9f\u00a0\u200b\u2028 \u00e9\u{1f600}')).toBe(
      "'\\x00\\x7f\\x9f\\xa0\\u200b\\u2028 \u00e9\u{1f600}'",
    );
    expect(repr('\u{e0001}\udc80')).toBe("'\\U000e0001\\udc80'");
  });

  it('compareCodePoints orders characters above U+FFFF after U+E000 to U+FFFF', () => {
    const items = ['\u{1f600}', '\uffff', 'a', '\ue000'];
    expect(items.sort(compareCodePoints)).toEqual(['a', '\ue000', '\uffff', '\u{1f600}']);
    expect(compareCodePoints('ab', 'a')).toBeGreaterThan(0);
  });

  it('decodeEscaped keeps bytes that are not UTF-8 and encodeEscaped restores them', () => {
    const bytes = Buffer.from([0x61, 0xff, 0xe2, 0x82, 0x41, 0xc3, 0xb3, 0xed, 0xa0, 0x80]);
    const text = decodeEscaped(bytes);
    expect(text).toBe('a\udcff\udce2\udc82A\u00f3\udced\udca0\udc80');
    expect(encodeEscaped(text).equals(bytes)).toBe(true);
    expect(decodeEscaped(Buffer.from('\u{1f600}\ufeff', 'utf8'))).toBe('\u{1f600}\ufeff');
  });

  it('path helpers follow POSIX path rules', () => {
    expect(normPath('')).toBe('.');
    expect(normPath('a/./b/../c/')).toBe('a/c');
    expect(normPath('../a/../../b')).toBe('../../b');
    expect(normPath('//a//b')).toBe('//a/b');
    expect(normPath('///a')).toBe('/a');
    expect(normPath('/..')).toBe('/');
    expect(dirnamePath('docs/guides/x.md')).toBe('docs/guides');
    expect(dirnamePath('x.md')).toBe('');
    expect(dirnamePath('//x')).toBe('//');
    expect(joinPath('docs', 'x.md')).toBe('docs/x.md');
    expect(joinPath('', 'x.md')).toBe('x.md');
    expect(joinPath('docs', '/x.md')).toBe('/x.md');
  });

  it('unquote decodes percent escapes as UTF-8 and keeps invalid ones', () => {
    expect(unquote('a%20b')).toBe('a b');
    expect(unquote('%C3%B3%zz%4')).toBe('\u00f3%zz%4');
    expect(unquote('%e2%82x')).toBe('\ufffdx');
    expect(unquote('\u00f3%41')).toBe('\u00f3A');
    expect(unquote('%%41')).toBe('%A');
  });
});

// Text, path and file helpers with the exact semantics the documentation
// check was specified with: Unicode-aware word, digit and space classes,
// line splitting, string quoting, code point order, paths that are not valid
// UTF-8. Why each one exists: docs/features/docs-contract-technical.md#text-semantics
import { readFileSync } from 'node:fs';

/** Regex class body: whitespace as `str.isspace` defines it (not JS `\s`, which adds U+FEFF and drops U+001C to U+001F). */
export const SPACE = String.raw`\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000`;
/** Regex class body: a word character, Unicode-aware (JS `\w` is ASCII only). */
export const WORD = String.raw`\p{L}\p{N}_`;
/** Regex: a decimal digit in any script (JS `\d` is ASCII only). */
export const DIGIT = String.raw`\p{Nd}`;

const SPACE_SET = new Set(
  [9, 10, 11, 12, 13, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f]
    .concat([0x205f, 0x3000])
    .concat(Array.from({ length: 11 }, (_, i) => 0x2000 + i))
    .map((c) => String.fromCharCode(c)),
);

/** Strip whitespace, or the given characters, from both ends. */
export function strip(text: string, chars?: string): string {
  return rstrip(lstrip(text, chars), chars);
}

export function lstrip(text: string, chars?: string): string {
  const drop = (c: string) => (chars === undefined ? SPACE_SET.has(c) : chars.includes(c));
  let i = 0;
  while (i < text.length && drop(text[i]!)) i++;
  return text.slice(i);
}

export function rstrip(text: string, chars?: string): string {
  const drop = (c: string) => (chars === undefined ? SPACE_SET.has(c) : chars.includes(c));
  let i = text.length;
  while (i > 0 && drop(text[i - 1]!)) i--;
  return text.slice(0, i);
}

// eslint-disable-next-line no-control-regex -- U+001C to U+001E are line boundaries too
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/u;

/** Lines without their terminators, split at every Unicode line boundary; a final terminator ends the last line. */
export function splitLines(text: string): string[] {
  const lines = text.split(LINE_BREAK);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Length in code points, not UTF-16 code units. */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** Compare by code point, as a sorted list of paths is ordered (JS sorts by UTF-16 code unit). */
export function compareCodePoints(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x === y) continue;
    if (x >= 0xd800 && y >= 0xd800) {
      // Surrogates stand for code points above U+FFFF, so they sort after U+E000..U+FFFF.
      x = x >= 0xe000 ? x - 0x800 : x + 0x2000;
      y = y >= 0xe000 ? y - 0x800 : y + 0x2000;
    }
    return x - y;
  }
  return a.length - b.length;
}

export function sorted(items: Iterable<string>): string[] {
  return [...items].sort(compareCodePoints);
}

const NOT_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

function hex(code: number, width: number): string {
  return code.toString(16).padStart(width, '0');
}

/** A string literal as messages quote values: in '...', or in "..." when the text holds ' and no ". */
export function repr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === quote || ch === '\\') out += '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (code < 0x20 || code === 0x7f) out += '\\x' + hex(code, 2);
    else if (code < 0x7f || ch === ' ' || !NOT_PRINTABLE.test(ch)) out += ch;
    else if (code <= 0xff) out += '\\x' + hex(code, 2);
    else if (code <= 0xffff) out += '\\u' + hex(code, 4);
    else out += '\\U' + hex(code, 8);
  }
  return out + quote;
}

// ---------------------------------------------------------------------------
// Bytes that are not valid UTF-8 (git paths, file names)
// ---------------------------------------------------------------------------

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Length of the valid UTF-8 sequence at `i`, or 0. */
function sequenceLength(bytes: Uint8Array, i: number): number {
  const b = bytes[i]!;
  const cont = (k: number, lo = 0x80, hi = 0xbf) => {
    const c = bytes[i + k];
    return c !== undefined && c >= lo && c <= hi;
  };
  if (b < 0x80) return 1;
  if (b >= 0xc2 && b <= 0xdf) return cont(1) ? 2 : 0;
  if (b === 0xe0) return cont(1, 0xa0) && cont(2) ? 3 : 0;
  if (b === 0xed) return cont(1, 0x80, 0x9f) && cont(2) ? 3 : 0;
  if (b >= 0xe1 && b <= 0xef) return cont(1) && cont(2) ? 3 : 0;
  if (b === 0xf0) return cont(1, 0x90) && cont(2) && cont(3) ? 4 : 0;
  if (b === 0xf4) return cont(1, 0x80, 0x8f) && cont(2) && cont(3) ? 4 : 0;
  if (b >= 0xf1 && b <= 0xf3) return cont(1) && cont(2) && cont(3) ? 4 : 0;
  return 0;
}

/** Decode UTF-8, turning each byte that is not part of a valid sequence into U+DC80..U+DCFF ("surrogateescape"). */
export function decodeEscaped(bytes: Uint8Array): string {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch {
    // fall through to the byte-by-byte decoder
  }
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const n = sequenceLength(bytes, i);
    if (n === 0) {
      out += String.fromCharCode(0xdc00 + bytes[i]!);
      i += 1;
    } else {
      out += STRICT_UTF8.decode(bytes.subarray(i, i + n));
      i += n;
    }
  }
  return out;
}

const ESCAPED_BYTE = /[\udc80-\udcff]/u;

/** True if `text` holds a byte that `decodeEscaped` could not decode. */
export function hasEscapedBytes(text: string): boolean {
  return ESCAPED_BYTE.test(text);
}

/** The bytes `decodeEscaped` read `text` from. */
export function encodeEscaped(text: string): Buffer {
  if (!hasEscapedBytes(text)) return Buffer.from(text, 'utf8');
  const parts: Buffer[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    parts.push(
      code >= 0xdc80 && code <= 0xdcff ? Buffer.from([code - 0xdc00]) : Buffer.from(ch, 'utf8'),
    );
  }
  return Buffer.concat(parts);
}

/**
 * A text file as UTF-8 with its newlines (`\r\n`, `\r`) turned into `\n`, or
 * null if it cannot be read or is not UTF-8. A byte order mark stays in the text.
 */
export function readText(path: string | Buffer): string | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return null;
  }
  try {
    return STRICT_UTF8.decode(bytes).replace(/\r\n?/g, '\n');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// POSIX paths, as the check resolves links (node:path differs on trailing
// slashes and on a leading "//")
// ---------------------------------------------------------------------------

export function joinPath(a: string, b: string): string {
  if (b.startsWith('/')) return b;
  if (!a || a.endsWith('/')) return a + b;
  return a + '/' + b;
}

export function dirnamePath(p: string): string {
  let head = p.slice(0, p.lastIndexOf('/') + 1);
  if (head && head !== '/'.repeat(head.length)) head = rstrip(head, '/');
  return head;
}

export function basenamePath(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

export function normPath(p: string): string {
  if (!p) return '.';
  let initial = p.startsWith('/') ? 1 : 0;
  if (initial && p.startsWith('//') && !p.startsWith('///')) initial = 2;
  const out: string[] = [];
  for (const comp of p.split('/')) {
    if (comp === '' || comp === '.') continue;
    if (comp !== '..' || (!initial && !out.length) || out[out.length - 1] === '..') out.push(comp);
    else if (out.length) out.pop();
  }
  return '/'.repeat(initial) + out.join('/') || '.';
}

// ---------------------------------------------------------------------------
// URL percent-decoding
// ---------------------------------------------------------------------------

const LENIENT_UTF8 = new TextDecoder('utf-8', { ignoreBOM: true });
const HEX2 = /^[0-9A-Fa-f]{2}$/;

/** Percent-decode a link target: each run of ASCII characters is decoded as UTF-8, invalid bytes become U+FFFD, a `%` without two hex digits stays. */
export function unquote(text: string): string {
  if (!text.includes('%')) return text;
  // eslint-disable-next-line no-control-regex -- every ASCII character, controls included
  return text.replace(/[\x00-\x7f]+/g, (run) => {
    const bytes: number[] = [];
    for (let i = 0; i < run.length; i++) {
      const pair = run.slice(i + 1, i + 3);
      if (run[i] === '%' && HEX2.test(pair)) {
        bytes.push(parseInt(pair, 16));
        i += 2;
      } else {
        bytes.push(run.charCodeAt(i));
      }
    }
    return LENIENT_UTF8.decode(new Uint8Array(bytes));
  });
}

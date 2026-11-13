// A JSON reader for the package.json bump filter. JSON.parse cannot serve:
// it keeps the last of two equal keys, and it reads 1, 1.0 and 1e0 as the
// same number. docs/features/docs-contract-technical.md#version-bump-filter
import { sorted } from './text.ts';

/** A parsed JSON value. Objects keep their keys in file order; numbers keep whether they were integers. */
export type Json =
  | null
  | boolean
  | string
  | { kind: 'int'; value: bigint }
  | { kind: 'float'; value: number }
  | Json[]
  | JsonObject;

export interface JsonObject {
  kind: 'object';
  entries: Map<string, Json>;
}

class JsonError extends Error {}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const NUMBER_RE = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

class Parser {
  private pos = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  parseDocument(): Json {
    this.skip();
    const value = this.value();
    this.skip();
    if (this.pos !== this.text.length) throw new JsonError('extra data');
    return value;
  }

  private skip(): void {
    while (this.pos < this.text.length && WHITESPACE.has(this.text[this.pos]!)) this.pos++;
  }

  private literal(word: string): boolean {
    if (!this.text.startsWith(word, this.pos)) return false;
    this.pos += word.length;
    return true;
  }

  private value(): Json {
    const c = this.text[this.pos];
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"') return this.string();
    if (this.literal('null')) return null;
    if (this.literal('true')) return true;
    if (this.literal('false')) return false;
    // Non-standard constants that the specified reader accepts.
    if (this.literal('NaN')) return { kind: 'float', value: NaN };
    if (this.literal('Infinity')) return { kind: 'float', value: Infinity };
    if (this.literal('-Infinity')) return { kind: 'float', value: -Infinity };
    NUMBER_RE.lastIndex = this.pos;
    const m = NUMBER_RE.exec(this.text);
    if (!m) throw new JsonError('expecting value');
    this.pos += m[0].length;
    if (m[1] === undefined && m[2] === undefined) return { kind: 'int', value: BigInt(m[0]) };
    return { kind: 'float', value: Number(m[0]) };
  }

  private object(): JsonObject {
    this.pos++; // {
    const entries = new Map<string, Json>();
    this.skip();
    if (this.text[this.pos] === '}') {
      this.pos++;
      return { kind: 'object', entries };
    }
    for (;;) {
      this.skip();
      if (this.text[this.pos] !== '"') throw new JsonError('expecting property name');
      const key = this.string();
      this.skip();
      if (this.text[this.pos] !== ':') throw new JsonError("expecting ':'");
      this.pos++;
      this.skip();
      const value = this.value();
      if (entries.has(key)) throw new JsonError('duplicate key');
      entries.set(key, value);
      this.skip();
      const c = this.text[this.pos++];
      if (c === '}') return { kind: 'object', entries };
      if (c !== ',') throw new JsonError("expecting ',' delimiter");
    }
  }

  private array(): Json[] {
    this.pos++; // [
    const items: Json[] = [];
    this.skip();
    if (this.text[this.pos] === ']') {
      this.pos++;
      return items;
    }
    for (;;) {
      this.skip();
      items.push(this.value());
      this.skip();
      const c = this.text[this.pos++];
      if (c === ']') return items;
      if (c !== ',') throw new JsonError("expecting ',' delimiter");
    }
  }

  private string(): string {
    this.pos++; // "
    let out = '';
    for (;;) {
      const c = this.text[this.pos++];
      if (c === undefined) throw new JsonError('unterminated string');
      if (c === '"') return out;
      if (c < ' ') throw new JsonError('invalid control character');
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.text[this.pos++];
      if (e === undefined) throw new JsonError('unterminated string');
      if (e === 'u') {
        const hex = this.text.slice(this.pos, this.pos + 4);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) throw new JsonError('invalid \\uXXXX escape');
        this.pos += 4;
        out += String.fromCharCode(parseInt(hex, 16));
      } else if (Object.hasOwn(ESCAPES, e)) {
        out += ESCAPES[e]!;
      } else {
        throw new JsonError('invalid escape');
      }
    }
  }
}

/** Parsed JSON, or null if `bytes` is not UTF-8 JSON with unique keys in every object. */
export function loadJson(bytes: Uint8Array): Json | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  try {
    return new Parser(text).parseDocument();
  } catch (e) {
    if (e instanceof JsonError) return null;
    throw e;
  }
}

export function isObject(value: Json | undefined): value is JsonObject {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'object'
  );
}

/**
 * Equal for equal JSON values: key order does not matter, but true and 1,
 * and 1 and 1.0, differ.
 */
export function canonical(value: Json): string {
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value.kind === 'int') return value.value.toString();
  if (value.kind === 'float') {
    const v = value.value;
    return `f${Object.is(v, -0) ? '-0' : String(v)}`;
  }
  const keys = sorted(value.entries.keys());
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value.entries.get(k)!)}`).join(',')}}`;
}

/** A number, or a boolean as 0 or 1, for comparing numbers of different kinds. */
function numeric(value: Json): { int: bigint } | { float: number } | null {
  if (typeof value === 'boolean') return { int: value ? 1n : 0n };
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    if (value.kind === 'int') return { int: value.value };
    if (value.kind === 'float') return { float: value.value };
  }
  return null;
}

/**
 * Equality of two values as the specification compares unchanged
 * dependency values: numbers compare by value whatever their kind, and
 * true equals 1.
 */
export function jsonEquals(a: Json, b: Json): boolean {
  const na = numeric(a);
  const nb = numeric(b);
  if (na && nb) {
    if ('int' in na && 'int' in nb) return na.int === nb.int;
    if ('float' in na && 'float' in nb) return na.float === nb.float;
    const i = 'int' in na ? na.int : (nb as { int: bigint }).int;
    const f = 'float' in na ? na.float : (nb as { float: number }).float;
    return Number.isInteger(f) && BigInt(f) === i;
  }
  if (na || nb) return false;
  if (a === null || b === null || typeof a === 'string' || typeof b === 'string') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => jsonEquals(x, b[i]!))
    );
  }
  if (!isObject(a) || !isObject(b) || a.entries.size !== b.entries.size) return false;
  for (const [k, v] of a.entries) {
    const w = b.entries.get(k);
    if (w === undefined || !jsonEquals(v, w)) return false;
  }
  return true;
}

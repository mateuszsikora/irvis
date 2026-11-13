// Markdown helpers shared by check-docs.ts and decisions-index.ts: the subset
// of CommonMark the check needs, and GitHub's heading anchors.
// docs/features/docs-contract-technical.md#data-flow
import { SPACE, WORD, codePointLength, lstrip, splitLines, strip } from './text.ts';

export type LineKind = 'text' | 'code' | 'front';

/** One line of a Markdown file: its number (from 1), its text and its kind. */
export type Line = readonly [n: number, line: string, kind: LineKind];

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/u;
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+([^\n]*?))?(?:[ \t]+#+)?[ \t]*$/u;
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/u;
const NOT_PARAGRAPH_RE = /^ {0,3}(?:[-*+>|]|\p{Nd}+[.)]|#)/u;
const HTML_ID_RE = new RegExp(
  String.raw`<[a-zA-Z][^>]*?[${SPACE}](?:id|name)[${SPACE}]*=[${SPACE}]*["']([^"']+)["']`,
  'gu',
);
// `[^\n]`, not `.`: the specified `.` also matches \r, U+2028 and U+2029.
const CODE_SPAN_RE = /(`+)([^\n]+?)\1/gu;

/**
 * Split Markdown into lines labelled "text", "code" (inside a fenced block,
 * fence lines included) or "front" (YAML front matter at the top of the file).
 */
export function scan(text: string): Line[] {
  const lines = splitLines(text);
  const out: Line[] = [];
  let i = 0;
  if (lines.length && strip(lines[0]!) === '---') {
    for (let j = 1; j < lines.length; j++) {
      const s = strip(lines[j]!);
      if (s === '---' || s === '...') {
        for (let k = 0; k <= j; k++) out.push([k + 1, lines[k]!, 'front']);
        i = j + 1;
        break;
      }
    }
  }
  let fence: string | null = null;
  for (let n = i; n < lines.length; n++) {
    const line = lines[n]!;
    if (fence === null) {
      const m = FENCE_RE.exec(line);
      if (m) {
        fence = m[1]!;
        out.push([n + 1, line, 'code']);
        continue;
      }
      out.push([n + 1, line, 'text']);
    } else {
      out.push([n + 1, line, 'code']);
      const stripped = strip(line);
      if (
        stripped &&
        [...stripped].every((c) => c === fence![0]) &&
        stripped.length >= fence.length &&
        line.length - lstrip(line, ' ').length <= 3
      ) {
        fence = null;
      }
    }
  }
  return out;
}

/**
 * A code span's text as CommonMark renders it: one space comes off each end
 * when both ends have one and the content is not only spaces.
 */
export function codeSpanText(content: string): string {
  if (
    content.length >= 2 &&
    content.startsWith(' ') &&
    content.endsWith(' ') &&
    strip(content, ' ')
  ) {
    return content.slice(1, -1);
  }
  return content;
}

const UNDERSCORE_RE = new RegExp(String.raw`(?<![${WORD}\0])_+|_+(?![${WORD}\0])`, 'gu');

/**
 * Reduce inline Markdown in a heading to the text GitHub renders. Code spans
 * keep their content literally (`<T>` stays <T>, `_x` stays _x), also inside
 * link text ([`x`](y.md) is x).
 */
export function plainHeadingText(text: string): string {
  const spans: string[] = [];
  let out = text.replace(CODE_SPAN_RE, (_m, _ticks, content: string) => {
    spans.push(codeSpanText(content));
    return `\0${spans.length - 1}\0`;
  });
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1');
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1');
  out = out.replace(/\[([^\]]*)\]\[[^\]]*\]/gu, '$1');
  out = out.replace(/<[^>\0]+>/gu, '');
  out = out.replace(/[*~]+/gu, '');
  out = out.replace(UNDERSCORE_RE, '');
  out = out.replace(/\0([0-9]+)\0/gu, (_m, i: string) => spans[Number(i)] ?? '');
  return strip(out);
}

const SLUG_KEEP = /^[\p{L}\p{N}\p{Mn}\p{Mc}\p{Pc} _-]$/u;

/** GitHub's anchor for a heading (without the -1, -2 suffix for duplicates). */
export function slugify(text: string): string {
  let out = '';
  for (const ch of plainHeadingText(text).toLowerCase()) {
    if (SLUG_KEEP.test(ch)) out += ch === ' ' ? '-' : ch;
  }
  return out;
}

export interface Heading {
  level: number;
  text: string;
  slug: string;
  /** Line number of the heading text. */
  line: number;
  /** Last line of the heading (the underline for setext). */
  endLine: number;
}

/**
 * All ATX and setext headings outside fenced code and front matter, with
 * GitHub's unique anchors.
 */
export function headings(text: string): Heading[] {
  const raw: [level: number, text: string, line: number, end: number][] = [];
  const rows = scan(text);
  rows.forEach(([n, line, kind], idx) => {
    if (kind !== 'text') return;
    let m = ATX_RE.exec(line);
    if (m) {
      raw.push([m[1]!.length, strip(m[2] ?? ''), n, n]);
      return;
    }
    m = SETEXT_RE.exec(line);
    if (m && idx > 0) {
      const [pn, prev, pkind] = rows[idx - 1]!;
      const last = raw[raw.length - 1];
      if (
        pkind === 'text' &&
        strip(prev) &&
        !NOT_PARAGRAPH_RE.test(prev) &&
        !SETEXT_RE.test(prev) &&
        !(last && last[2] === pn)
      ) {
        raw.push([m[1]![0] === '=' ? 1 : 2, strip(prev), pn, n]);
      }
    }
  });
  const seen = new Map<string, number>();
  return raw.map(([level, htext, line, endLine]) => {
    const base = slugify(htext);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { level, text: htext, slug: count === 0 ? base : `${base}-${count}`, line, endLine };
  });
}

/** Every anchor a link into this Markdown file may use. */
export function anchors(text: string): Set<string> {
  const found = new Set(headings(text).map((h) => h.slug));
  for (const [, line, kind] of scan(text)) {
    if (kind !== 'text') continue;
    for (const m of line.matchAll(HTML_ID_RE)) found.add(m[1]!);
  }
  return found;
}

/** Each code span in `line` replaced by as many spaces as it has characters. */
export function stripCodeSpans(line: string): string {
  return line.replace(CODE_SPAN_RE, (m) => ' '.repeat(codePointLength(m)));
}

/** The contents of the code spans in `line`, stripped. */
export function codeSpans(line: string): string[] {
  return [...line.matchAll(CODE_SPAN_RE)].map((m) => strip(m[2]!));
}

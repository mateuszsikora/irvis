/**
 * Documentation contract check: every behaviour change carries its documentation.
 *
 * Usage:
 *     node tools/docs-check/src/check-docs.ts [--base REF] [-v]
 *     node tools/docs-check/src/check-docs.ts --integrity-only
 *     npm run docs-check [-- --base REF -v]
 *
 * The check compares the working tree with the merge base of HEAD and the base
 * branch (--base REF; by default origin/main, else main). The changed set is
 * the union of the commits since the merge base, staged and unstaged changes,
 * and untracked files that git does not ignore. For every rule in RULES whose
 * source regex matches a changed path, some changed path must match the rule's
 * documentation regex. The catch-all rule (F0) matches the paths that no other
 * rule owns and needs a feature document that is new since the merge base.
 *
 * Paths that match EXCLUDE (tests, docs, agent tooling, ...) and files whose
 * diff only changes versions (BUMP_FILTERS, line by line; JSON_BUMP_FILTERS,
 * on the parsed JSON) are left out of the source side.
 * Integrity checks on the whole tree run every time: relative links and
 * anchors, references to docs/ in code comments, no line-number references,
 * section citations, the decisions index, the ownership-map tables in
 * docs/features/README.md against RULES and EXCLUDE, and docs/invariants.md.
 *
 * Exit codes:
 *     0  every changed path has its documentation and the integrity checks pass
 *        (with --integrity-only: the integrity checks pass; no base is needed)
 *     1  at least one rule or integrity check failed
 *     2  no base: neither the --base ref nor origin/main nor main exists, there
 *        is no merge base, or git failed; or an unknown command-line option
 *
 * Environment:
 *     SKIP_DOCS_CHECK=1  skip the check locally (work in progress). Ignored, with
 *                        a message, when CI is set.
 *
 * Node built-ins only, so `node` runs it without `npm ci`. How to write the
 * documentation: docs/guides/documentation.md.
 * How this script works: docs/features/docs-contract-technical.md.
 */
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { type Output, parseArgs, processOutput } from './cli.ts';
import { check as checkIndex, GENERATOR as INDEX_GENERATOR } from './decisions-index.ts';
import { type Json, type JsonObject, canonical, isObject, jsonEquals, loadJson } from './json.ts';
import { type Heading, anchors, codeSpans, headings, scan, stripCodeSpans } from './markdown.ts';
import {
  DIGIT,
  SPACE,
  WORD,
  basenamePath,
  decodeEscaped,
  dirnamePath,
  encodeEscaped,
  hasEscapedBytes,
  joinPath,
  lstrip,
  normPath,
  readText,
  repr,
  sorted,
  splitLines,
  strip,
  unquote,
} from './text.ts';

export const SCRIPT = 'tools/docs-check/src/check-docs.ts';

export interface Rule {
  id: string;
  source: string;
  docs: string;
  message: string;
  catchAll?: boolean;
}

// The ownership map. Source of truth; docs/features/README.md restates it and
// this script fails when the two differ. AGENTS.md restates it for agents.
export const RULES: readonly Rule[] = [
  {
    id: 'F0',
    source: String.raw`.*`,
    docs: String.raw`^docs/features/[^/]+-(user|technical)\.md$`,
    message:
      'Path owned by no rule: add new feature documents (docs/features/NAME-user.md and ' +
      'docs/features/NAME-technical.md) and add the path to the ownership map',
    catchAll: true,
  },
  {
    id: 'F1',
    source: String.raw`^tools/docs-check/`,
    docs: String.raw`^(docs/features/docs-contract-(user|technical)\.md|docs/guides/documentation\.md|AGENTS\.md)$`,
    message:
      'Documentation check or decisions index changed: update docs/features/docs-contract-technical.md ' +
      '(or docs/features/docs-contract-user.md, docs/guides/documentation.md), and AGENTS.md if RULES changed',
  },
  {
    id: 'F2',
    source: String.raw`^packages/core/(?!src/cameras/)`,
    docs: String.raw`^docs/features/core-(user|technical)\.md$`,
    message: 'Core changed: update docs/features/core-technical.md (or docs/features/core-user.md)',
  },
  {
    id: 'F3',
    source: String.raw`^(apps/web/|netlify\.toml$)`,
    docs: String.raw`^docs/features/web-app-(user|technical)\.md$`,
    message:
      'Web app or its Netlify configuration changed: update docs/features/web-app-technical.md ' +
      '(or docs/features/web-app-user.md)',
  },
  {
    id: 'F4',
    source: String.raw`^packages/core/src/cameras/`,
    docs: String.raw`^docs/features/cameras-(user|technical)\.md$`,
    message:
      'Camera registry or profile schema changed: update docs/features/cameras-technical.md ' +
      '(or docs/features/cameras-user.md)',
  },
  {
    id: 'C2',
    source: String.raw`^\.github/(?!pull_request_template\.md$)`,
    docs: String.raw`^docs/guides/development\.md$`,
    message: 'CI or GitHub configuration changed: update docs/guides/development.md',
  },
  {
    id: 'C3',
    source: String.raw`^(package\.json|tsconfig(\.[^/]+)?\.json|(eslint|vitest)\.config\.[cm]?[jt]s|\.prettierrc(\.[^/]+)?|\.prettierignore|\.nvmrc|\.npmrc)$`,
    docs: String.raw`^docs/guides/(development|testing)\.md$`,
    message:
      'Root TypeScript configuration changed: update docs/guides/development.md ' +
      '(or docs/guides/testing.md for the Vitest configuration)',
  },
];

// Paths left out of the source side on purpose: [regex, why]. Their changes
// never require documentation; they still count on the documentation side.
export const EXCLUDE: readonly (readonly [string, string])[] = [
  [String.raw`(^|/)[^/]+\.(test|spec)\.[^/]+$`, 'Test files kept next to the code they test'],
  [
    String.raw`(^|/)([^/]+\.lock|package-lock\.json|pnpm-lock\.yaml|go\.sum)$`,
    'Lock files: generated from a manifest that a rule owns',
  ],
  [String.raw`^(LICEN[CS]E|COPYING)([.-][^/]*)?$`, 'Licence'],
  [String.raw`^\.gitignore$`, 'Git ignore list'],
  [String.raw`^docs/`, 'Documentation'],
  [String.raw`^README\.md$`, 'Root README, an entry point into docs/'],
  [String.raw`^(AGENTS|CLAUDE)\.md$`, 'Agent instructions; CLAUDE.md is a symlink to AGENTS.md'],
  [String.raw`^CONTRIBUTING\.md$`, 'Contribution rules'],
  [String.raw`^\.github/pull_request_template\.md$`, 'Pull request template'],
  [String.raw`^\.(agents|claude)/`, 'Agent tooling: skills and agent settings'],
  [
    String.raw`^(packages|apps|tools)/[^/]+/(test|e2e)/`,
    'Test helpers and end-to-end tests of a package',
  ],
  [String.raw`^fixtures/`, 'Test data'],
  [String.raw`^NOTICE$`, 'Attribution notices, next to the licence'],
];

// Files whose diff may change only versions: [path regex, line regex]. A
// line regex marks the version with the group `v`, and may mark a trailing
// comment that also holds the version with the group `c`. A pin that the
// documentation states must not match the line regex.
export const BUMP_FILTERS: readonly (readonly [string, string])[] = [
  [
    String.raw`^\.github/workflows/[^/]+\.ya?ml$`,
    String.raw`[${SPACE}]*(?:-[${SPACE}]+)?uses:[${SPACE}]*["']?[${WORD}.\-/]+@(?<v>[${WORD}.\-]+)["']?(?<c>[${SPACE}]+#[^\n]*)?[${SPACE}]*`,
  ],
];

// JSON files whose change may touch only the values inside some top-level
// objects: [path regex, field names]. Compared on the parsed JSON, not line by
// line, because a JSON line does not say which object it belongs to.
export const JSON_BUMP_FILTERS: readonly (readonly [string, readonly string[]])[] = [
  [
    String.raw`(^|/)package\.json$`,
    ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'],
  ],
];

// Words that cite a document by section number (a word, the section sign,
// a number) -> the document's path. Empty: no such document exists yet.
export const SECTION_ALIASES: Readonly<Record<string, string>> = {};

export const INVARIANTS = 'docs/invariants.md';
export const MAP_FILE = 'docs/features/README.md';
const MAP_HEADER = ['#', 'source path regex', 'doc path regex', 'message'];
const EXCLUDE_HEADER = ['path regex', 'why'];

const FOOTER =
  'What to update: the "You changed / You must also update" table in AGENTS.md ' +
  '(section "Documentation contract").\n' +
  'How to write it: docs/guides/documentation.md.';

const HASH_COMMENT = new Set(
  'py sh bash zsh yml yaml toml cfg ini mk rb pl r conf makefile dockerfile gitignore gitattributes editorconfig'.split(
    ' ',
  ),
);
const SLASH_COMMENT = new Set(
  'js jsx ts tsx mjs cjs go rs c h cc cpp hpp java kt kts swift cs scala dart php css scss less'.split(
    ' ',
  ),
);
const DASH_COMMENT = new Set(['sql', 'lua', 'hs']);
const HTML_COMMENT = new Set(['html', 'htm', 'xml', 'svg', 'vue']);

const S = SPACE;
const W = WORD;
const D = DIGIT;
/** A regex from a pattern written with the Unicode-aware classes above. */
const rx = (source: string, flags = '') => new RegExp(source, `u${flags}`);

const LINK_RE = rx(
  String.raw`!?\[(?:[^\[\]]|\[[^\[\]]*\])*\]\([${S}]*(<[^>]*>|[^${S}()]+(?:\([^${S}()]*\)[^${S}()]*)*)(?:[${S}]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[${S}]*\)`,
  'g',
);
const REFDEF_RE = rx(String.raw`^ {0,3}\[[^\]]+\]:[${S}]*(<[^>]*>|[^${S}]+)`);
const DOCS_REF_RE = rx(
  String.raw`(?<![${W}/.\-])(?:\./)?(docs/[${W}./\-]+?\.md)(?:#([${W}\-]+))?(?![${W}])`,
  'g',
);
const DOCS_SPAN_RE = rx(String.raw`^(?:\./)?(docs/[a-z0-9_./\-]+\.md)(?:#([a-z0-9_\-]+))?$`);
const MESSAGE_DOC_RE = rx(String.raw`docs/[a-z0-9_./\-]+\.md`, 'g');
const LINE_REF_RE = rx(String.raw`[${W}./\-]+\.md(?::${D}+|#L${D}+)(?![${W}])`, 'g');
const SECTION_RE = rx(
  String.raw`(?:(?<doc>[${W}./\-]+\.md)|(?<alias>(?<![${W}])[A-Za-z][${W}\-]*))[${S}]*\u00a7[${S}]*(?<sec>${D}+(?:\.${D}+)*)`,
  'g',
);
const EXTERNAL_RE = rx(String.raw`^(?:[a-zA-Z][a-zA-Z0-9+.\-]*:|//)`);
const LINE_FRAGMENT_RE = rx(String.raw`^L${D}+(?:-L${D}+)?$`);
const INVARIANT_RE = rx(String.raw`^- \*\*(${D}+)\.\*\* [^${S}]`);
const TEST_ID_RE = rx(String.raw`^[${S}]+- \x60([^\x60]+)\x60[${S}]*$`);
// describe("..."), it("...") or test("...") with a plain string literal as the
// whole first argument. No template literals, no .each/.only/.skip.
const JS_CALL_RE = rx(
  String.raw`(?<![${W}$.])(describe|it|test)[${S}]*\([${S}]*(?:"((?:[^"\\\n]|\\[^\n])*)"|'((?:[^'\\\n]|\\[^\n])*)')[${S}]*[,)]`,
  'g',
);
const LIST_ITEM_RE = rx(String.raw`^([${S}]*)(?:[\-*+]|${D}+[.)])(?:[${S}]|$)`);
const DELIMITER_ROW_RE = rx(String.raw`^:?-+:?$`);
const CODE_CELL_RE = rx(String.raw`^(\x60+) ?([^\n]*?) ?\1$`);

const compiled = new Map<string, RegExp>();
/** `pattern` found anywhere in `text`, as RULES, EXCLUDE and the filters match paths. */
function search(pattern: string, text: string): boolean {
  let re = compiled.get(pattern);
  if (!re) compiled.set(pattern, (re = rx(pattern)));
  return re.test(text);
}

export class GitError extends Error {
  // Shown in the [filter] message, as `GitError: <message>`.
  override name = 'GitError';
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

interface GitResult {
  status: number;
  stdout: Buffer;
}

export function git(root: string, args: string[], ok: readonly number[] = [0]): GitResult {
  const proc = spawnSync('git', ['-C', root, ...args], { maxBuffer: 1 << 30 });
  const status = proc.status ?? -1;
  if (proc.error || !ok.includes(status)) {
    const why = proc.error ? proc.error.message : new TextDecoder().decode(proc.stderr);
    throw new GitError(`git ${args.join(' ')} failed: ${strip(why)}`);
  }
  return { status, stdout: proc.stdout };
}

function gitText(result: GitResult): string {
  return strip(result.stdout.toString('utf8'));
}

/** NUL-separated git output, decoded so that a path that is not UTF-8 keeps its bytes. */
function zlist(result: GitResult): string[] {
  const out: string[] = [];
  let start = 0;
  const buf = result.stdout;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0) {
      if (i > start) out.push(decodeEscaped(buf.subarray(start, i)));
      start = i + 1;
    }
  }
  return out;
}

function resolveRef(root: string, ref: string): string | null {
  const proc = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], [0, 1, 128]);
  return proc.status === 0 ? gitText(proc) : null;
}

/** [ref name, merge-base sha]. Throws GitError with a message for exit 2. */
export function findBase(root: string, base: string | undefined): [string, string] {
  const candidates = base ? [base] : ['origin/main', 'main'];
  for (const ref of candidates) {
    if (resolveRef(root, ref)) {
      const proc = git(root, ['merge-base', 'HEAD', ref], [0, 1]);
      if (proc.status !== 0) throw new GitError(`HEAD and ${ref} have no merge base`);
      return [ref, gitText(proc)];
    }
  }
  if (base) throw new GitError(`base ref '${base}' does not exist`);
  throw new GitError('no base branch: neither origin/main nor main exists; pass --base REF');
}

export function changedFiles(root: string, mb: string): string[] {
  const paths = new Set<string>();
  const add = (r: GitResult) => zlist(r).forEach((p) => paths.add(p));
  add(git(root, ['diff', '--name-only', '-z', '--no-renames', mb, 'HEAD']));
  add(git(root, ['diff', '--name-only', '-z', '--no-renames', 'HEAD']));
  add(git(root, ['diff', '--name-only', '-z', '--no-renames', '--cached']));
  add(git(root, ['ls-files', '-z', '--others', '--exclude-standard']));
  return sorted(paths);
}

/** Files added since the merge base (a git mv is a rename, not an addition), plus untracked files. */
export function newFiles(root: string, mb: string): Set<string> {
  const paths = new Set(
    zlist(git(root, ['diff', '--name-only', '-z', '--find-renames', '--diff-filter=A', mb])),
  );
  zlist(git(root, ['ls-files', '-z', '--others', '--exclude-standard'])).forEach((p) =>
    paths.add(p),
  );
  return paths;
}

/** The bytes of `root/rel` as a file system path, also when `rel` is not UTF-8. */
function fsPath(root: string, rel: string): Buffer {
  return encodeEscaped(rel ? `${root}/${rel}` : root);
}

type Kind = 'file' | 'link' | 'other' | 'missing';

function kindOf(root: string, rel: string): Kind {
  try {
    const stat = lstatSync(fsPath(root, rel));
    return stat.isSymbolicLink() ? 'link' : stat.isFile() ? 'file' : 'other';
  } catch {
    return 'missing';
  }
}

/** Tracked and untracked, not ignored, regular files (symlinks are skipped). */
export function treeFiles(root: string): string[] {
  const listed = zlist(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']));
  return sorted(new Set(listed)).filter((p) => kindOf(root, p) === 'file');
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export function excluded(path: string): string | null {
  for (const [pattern, why] of EXCLUDE) {
    if (search(pattern, path)) return why;
  }
  return null;
}

function withoutVersion(m: RegExpExecArray): string {
  const line = m.input;
  const spans = (['v', 'c'] as const)
    .map((g) => m.indices?.groups?.[g])
    .filter((s): s is [number, number] => s !== undefined)
    .sort((a, b) => a[0] - b[0]);
  let out = '';
  let pos = 0;
  for (const [start, end] of spans) {
    out += line.slice(pos, start);
    pos = end;
  }
  return out + line.slice(pos);
}

/** A string without ':' or '/': a semver range or a dist-tag (^19.1.0, >=1 <2, latest, *), not a package source (npm:, file:, workspace:, github:, git+https://..., user/repo). */
function isVersionRange(value: Json | undefined): boolean {
  return typeof value === 'string' && !value.includes(':') && !value.includes('/');
}

/**
 * True if `path` (merge base -> working tree) is JSON on both sides and only
 * version ranges of existing keys inside `fields` changed.
 */
export function isJsonVersionBump(
  root: string,
  mb: string,
  path: string,
  fields: readonly string[],
): boolean {
  if (hasEscapedBytes(path)) return false; // git takes the path as an argument, which must be UTF-8
  const oldProc = git(root, ['show', `${mb}:${path}`], [0, 128]);
  if (oldProc.status !== 0 || kindOf(root, path) !== 'file') return false; // added, deleted or not a regular file
  const o = loadJson(oldProc.stdout);
  const n = loadJson(readFileSync(fsPath(root, path)));
  if (!isObject(o) || !isObject(n)) return false;
  const rest = (d: JsonObject): Json => ({
    kind: 'object',
    entries: new Map([...d.entries].filter(([k]) => !fields.includes(k))),
  });
  if (canonical(rest(o)) !== canonical(rest(n))) return false;
  let bumped = false;
  for (const field of fields) {
    if (o.entries.has(field) !== n.entries.has(field)) return false;
    if (!o.entries.has(field)) continue;
    const of = o.entries.get(field);
    const nf = n.entries.get(field);
    if (!isObject(of) || !isObject(nf) || of.entries.size !== nf.entries.size) return false;
    if ([...of.entries.keys()].some((k) => !nf.entries.has(k))) return false;
    for (const [name, ov] of of.entries) {
      const nv = nf.entries.get(name)!;
      if (jsonEquals(ov, nv)) continue;
      if (!isVersionRange(ov) || !isVersionRange(nv)) return false;
      bumped = true;
    }
  }
  return bumped;
}

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * True if the change to `path` (merge base -> working tree) only changes
 * versions: per JSON_BUMP_FILTERS, or else every changed line is a version
 * line of BUMP_FILTERS and the lines differ only in their versions.
 */
export function isVersionBump(root: string, mb: string, path: string): boolean {
  const fields = JSON_BUMP_FILTERS.find(([px]) => search(px, path))?.[1];
  if (fields !== undefined) return isJsonVersionBump(root, mb, path, fields);
  const lx = BUMP_FILTERS.find(([px]) => search(px, path))?.[1];
  if (lx === undefined) return false;
  if (hasEscapedBytes(path)) return false; // git takes the path as an argument, which must be UTF-8
  const lineRx = rx(`^(?:${lx})$`, 'd');
  const diff = git(root, [
    'diff',
    '-U0',
    '--no-renames',
    '--no-color',
    '--no-ext-diff',
    mb,
    '--',
    path,
  ]).stdout;
  const hunks: [string[], string[]][] = [];
  for (const raw of splitLines(STRICT_UTF8.decode(diff))) {
    const last = hunks[hunks.length - 1];
    if (raw.startsWith('@@')) hunks.push([[], []]);
    else if (last && raw.startsWith('-')) last[0].push(raw.slice(1));
    else if (last && raw.startsWith('+')) last[1].push(raw.slice(1));
  }
  if (!hunks.length) return false;
  for (const [removed, added] of hunks) {
    // Each hunk replaces lines one for one, in place: a line moved to
    // another place shows up as a hunk without its counterpart.
    if (removed.length !== added.length) return false;
    for (let i = 0; i < removed.length; i++) {
      const old = removed[i]!;
      const now = added[i]!;
      const mo = lineRx.exec(old);
      const mn = lineRx.exec(now);
      if (!mo || !mn || old === now || withoutVersion(mo) !== withoutVersion(mn)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Broken rules with the source paths that triggered them. The catch-all
 * skips deleted paths: removing code no rule owns needs no new document.
 */
export function evaluate(
  sources: readonly string[],
  changed: readonly string[],
  added: ReadonlySet<string>,
  deleted: ReadonlySet<string> = new Set(),
): [Rule, string[]][] {
  const broken: [Rule, string[]][] = [];
  const regular = RULES.filter((r) => !r.catchAll);
  for (const rule of RULES) {
    let hits: string[];
    let documented: boolean;
    if (rule.catchAll) {
      hits = sources.filter(
        (p) =>
          !deleted.has(p) && search(rule.source, p) && !regular.some((r) => search(r.source, p)),
      );
      documented = [...added].some((d) => search(rule.docs, d));
    } else {
      hits = sources.filter((p) => search(rule.source, p));
      documented = changed.some((d) => search(rule.docs, d));
    }
    if (hits.length && !documented) broken.push([rule, hits]);
  }
  return broken;
}

// ---------------------------------------------------------------------------
// Integrity checks
// ---------------------------------------------------------------------------

/** Read-only view of the files in the working tree, with caches. */
class Tree {
  readonly root: string;
  readonly files: string[];
  private readonly texts = new Map<string, string | null>();
  private readonly anchorSets = new Map<string, Set<string>>();
  private readonly listings = new Map<string, Set<string>>();

  constructor(root: string) {
    this.root = root;
    this.files = treeFiles(root);
  }

  text(rel: string): string | null {
    if (!this.texts.has(rel)) this.texts.set(rel, readText(fsPath(this.root, rel)));
    return this.texts.get(rel)!;
  }

  /** Exact-case existence, so a link that only works on a case-insensitive disk fails. */
  exists(rel: string): boolean {
    let cur = '';
    for (const part of rel.split('/')) {
      if (part === '' || part === '.') continue;
      if (!this.listings.has(cur)) {
        let names = new Set<string>();
        try {
          names = new Set(
            readdirSync(fsPath(this.root, cur), { encoding: 'buffer' }).map((b) =>
              decodeEscaped(b),
            ),
          );
        } catch {
          // not a directory
        }
        this.listings.set(cur, names);
      }
      if (!this.listings.get(cur)!.has(part)) return false;
      cur = joinPath(cur, part);
    }
    return true;
  }

  anchors(rel: string): Set<string> {
    if (!this.anchorSets.has(rel)) this.anchorSets.set(rel, anchors(this.text(rel) ?? ''));
    return this.anchorSets.get(rel)!;
  }

  headings(rel: string): Heading[] {
    return headings(this.text(rel) ?? '');
  }
}

/** [line number, line without code spans, code span contents] outside fenced code. */
function markdownLines(text: string): [number, string, string[]][] {
  return scan(text)
    .filter(([, , kind]) => kind === 'text')
    .map(([n, line]) => [n, stripCodeSpans(line), codeSpans(line)]);
}

function commentMarkers(path: string): string[] | null {
  const base = basenamePath(path).toLowerCase();
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : base;
  if (HASH_COMMENT.has(ext) || HASH_COMMENT.has(base)) return ['#'];
  if (SLASH_COMMENT.has(ext)) return ['//', '/*'];
  if (DASH_COMMENT.has(ext)) return ['--'];
  if (HTML_COMMENT.has(ext)) return ['<!--'];
  return null;
}

/** [line number, comment text] for each line of a code file that holds a comment. */
function commentLines(path: string, text: string): [number, string][] {
  const markers = commentMarkers(path);
  if (!markers) return [];
  const out: [number, string][] = [];
  splitLines(text).forEach((line, i) => {
    if (markers.includes('/*') && lstrip(line).startsWith('*')) {
      out.push([i + 1, line]);
      return;
    }
    const positions = markers.map((m) => line.indexOf(m)).filter((p) => p !== -1);
    if (positions.length) out.push([i + 1, line.slice(Math.min(...positions))]);
  });
  return out;
}

function checkTarget(
  tree: Tree,
  src: string,
  n: number,
  target: string,
  frag: string | null,
  what: string,
): string | null {
  const rel = target ? normPath(target) : target;
  if (rel.startsWith('../') || rel === '..')
    return `${src}:${n}: ${what} points outside the repository`;
  if (rel && !tree.exists(rel)) return `${src}:${n}: ${what} points to a missing file: ${rel}`;
  if (frag && LINE_FRAGMENT_RE.test(frag)) {
    return `${src}:${n}: ${what} uses a line number (#${frag}); link the heading anchor or name the symbol`;
  }
  const file = rel || src;
  if (frag && file.endsWith('.md') && !tree.anchors(file).has(frag)) {
    return `${src}:${n}: ${what} points to a missing heading: ${file}#${frag}`;
  }
  return null;
}

function lineRefProblems(src: string, n: number, text: string): string[] {
  return [...text.matchAll(LINE_REF_RE)].map(
    (m) => `${src}:${n}: '${m[0]}' refers to a line number; use the heading anchor`,
  );
}

function checkLinks(tree: Tree): string[] {
  const problems: string[] = [];
  for (const src of tree.files) {
    if (!src.endsWith('.md')) continue;
    const text = tree.text(src);
    if (text === null) continue;
    const here = dirnamePath(src);
    for (const [n, line, spans] of markdownLines(text)) {
      const targets = [...line.matchAll(LINK_RE)].map((m) => m[1]!);
      const def = REFDEF_RE.exec(line);
      if (def) targets.push(def[1]!);
      for (const raw of targets) {
        const target = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
        if (EXTERNAL_RE.test(target)) continue;
        const hash = target.indexOf('#');
        const path = unquote(hash === -1 ? target : target.slice(0, hash));
        const frag = unquote(hash === -1 ? '' : target.slice(hash + 1)) || null;
        const rel = path.startsWith('/') ? lstrip(path, '/') : path ? joinPath(here, path) : '';
        const p = checkTarget(tree, src, n, rel, frag, `link '${target}'`);
        if (p) problems.push(p);
      }
      for (const span of spans) {
        const m = DOCS_SPAN_RE.exec(span);
        if (!m) continue;
        const p = checkTarget(tree, src, n, m[1]!, m[2] ?? null, `\`${span}\``);
        if (p) problems.push(p);
      }
      problems.push(...lineRefProblems(src, n, line));
    }
  }
  return problems;
}

function checkCodeRefs(tree: Tree): string[] {
  const problems: string[] = [];
  for (const src of tree.files) {
    if (src.endsWith('.md')) continue;
    const text = tree.text(src);
    if (text === null) continue;
    for (const [n, comment] of commentLines(src, text)) {
      for (const m of comment.matchAll(DOCS_REF_RE)) {
        const p = checkTarget(tree, src, n, m[1]!, m[2] ?? null, `reference '${m[0]}'`);
        if (p) problems.push(p);
      }
      problems.push(...lineRefProblems(src, n, comment));
    }
  }
  return problems;
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

function checkSectionCitations(tree: Tree, aliases: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  for (const src of tree.files) {
    const text = tree.text(src);
    if (text === null) continue;
    let lines: [number, string][];
    let here: string;
    if (src.endsWith('.md')) {
      lines = markdownLines(text).map(([n, line]) => [n, line]);
      here = dirnamePath(src);
    } else {
      lines = commentLines(src, text);
      here = '';
    }
    for (const [n, line] of lines) {
      for (const m of line.matchAll(SECTION_RE)) {
        const cite = m[0];
        const {
          doc: docName,
          alias,
          sec,
        } = m.groups as { doc?: string; alias?: string; sec: string };
        let doc: string;
        if (docName !== undefined) {
          doc = normPath(joinPath(here, docName));
          if (!tree.exists(doc)) doc = normPath(docName);
        } else if (alias !== undefined && Object.hasOwn(aliases, alias)) {
          doc = aliases[alias]!;
        } else {
          problems.push(
            `${src}:${n}: '${cite}' cites an unknown document; cite the file path ` +
              `or add '${alias}' to SECTION_ALIASES in ${SCRIPT}`,
          );
          continue;
        }
        if (!tree.exists(doc)) {
          problems.push(`${src}:${n}: '${cite}' cites a missing file: ${doc}`);
          continue;
        }
        const heading = rx(String.raw`^\u00a7?[${S}]*${escapeRegExp(sec)}(?:[.):${S}]|$)`);
        if (!tree.headings(doc).some((h) => heading.test(h.text))) {
          problems.push(`${src}:${n}: '${cite}': ${doc} has no heading for section ${sec}`);
        }
      }
    }
  }
  return problems;
}

function splitRow(line: string): string[] {
  let s = strip(line);
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/u).map((c) => strip(c).replaceAll('\\|', '|'));
}

function tableAfterHeader(text: string, header: readonly string[]): [number, string[]][] | null {
  let rows: [number, string[]][] | null = null;
  for (const [n, line, kind] of scan(text)) {
    if (rows === null) {
      if (kind === 'text' && lstrip(line).startsWith('|')) {
        const cells = splitRow(line).map((c) => c.toLowerCase());
        if (cells.length === header.length && cells.every((c, i) => c === header[i])) rows = [];
      }
      continue;
    }
    if (kind !== 'text' || !lstrip(line).startsWith('|')) break;
    const cells = splitRow(line);
    if (cells.every((c) => DELIMITER_ROW_RE.test(c))) continue;
    rows.push([n, cells]);
  }
  return rows;
}

function codeCell(cell: string): string | null {
  const m = CODE_CELL_RE.exec(cell);
  return m ? m[2]! : null;
}

function checkMap(tree: Tree): string[] {
  const problems: string[] = [];
  const text = tree.text(MAP_FILE);
  if (text === null) return [`${MAP_FILE} is missing; it must hold the ownership map`];
  let rows = tableAfterHeader(text, MAP_HEADER);
  if (rows === null) {
    problems.push(`${MAP_FILE}: no ownership-map table with columns: ${MAP_HEADER.join(' | ')}`);
    rows = [];
  }
  const table = new Map<string, [number, string, string, string]>();
  for (const [n, cells] of rows) {
    if (cells.length !== 4) {
      problems.push(`${MAP_FILE}:${n}: ownership-map row needs 4 cells, has ${cells.length}`);
      continue;
    }
    const [rid, src, doc, msg] = cells as [string, string, string, string];
    const srcCode = codeCell(src);
    const docCode = codeCell(doc);
    if (srcCode === null || docCode === null) {
      problems.push(`${MAP_FILE}:${n}: rule ${rid}: write both regexes as code spans`);
      continue;
    }
    if (table.has(rid)) problems.push(`${MAP_FILE}:${n}: rule ${rid} appears twice`);
    table.set(rid, [n, srcCode, docCode, msg]);
  }
  for (const rule of RULES) {
    const row = table.get(rule.id);
    if (!row) {
      problems.push(
        `${MAP_FILE}: rule ${rule.id} from RULES is missing from the ownership-map table`,
      );
      continue;
    }
    const [n, src, doc, msg] = row;
    for (const [field, mine, theirs] of [
      ['source regex', rule.source, src],
      ['doc regex', rule.docs, doc],
      ['message', rule.message, msg],
    ] as const) {
      if (mine !== theirs) {
        problems.push(
          `${MAP_FILE}:${n}: rule ${rule.id}: ${field} differs from RULES ` +
            `(RULES: ${repr(mine)}, table: ${repr(theirs)})`,
        );
      }
    }
  }
  const ids = new Set(RULES.map((r) => r.id));
  for (const [rid, [n]] of table) {
    if (!ids.has(rid)) problems.push(`${MAP_FILE}:${n}: rule ${rid} is not in RULES in ${SCRIPT}`);
  }

  let exRows = tableAfterHeader(text, EXCLUDE_HEADER);
  if (exRows === null) {
    problems.push(`${MAP_FILE}: no exclusions table with columns: ${EXCLUDE_HEADER.join(' | ')}`);
    exRows = [];
  }
  const listed = new Map<string, [number, string]>();
  for (const [n, cells] of exRows) {
    const pattern = cells.length === 2 ? codeCell(cells[0]!) : null;
    if (pattern === null) {
      problems.push(`${MAP_FILE}:${n}: exclusion row needs 2 cells, the regex as a code span`);
      continue;
    }
    if (listed.has(pattern))
      problems.push(`${MAP_FILE}:${n}: exclusion ${repr(pattern)} appears twice`);
    listed.set(pattern, [n, cells[1]!]);
  }
  const excludeMap = new Map(EXCLUDE);
  for (const [pattern, why] of EXCLUDE) {
    const row = listed.get(pattern);
    if (!row) {
      problems.push(
        `${MAP_FILE}: exclusion ${repr(pattern)} from EXCLUDE is missing from the exclusions table`,
      );
    } else if (row[1] !== why) {
      problems.push(
        `${MAP_FILE}:${row[0]}: exclusion ${repr(pattern)}: reason differs from EXCLUDE ` +
          `(EXCLUDE: ${repr(why)}, table: ${repr(row[1])})`,
      );
    }
  }
  for (const [pattern, [n]] of listed) {
    if (!excludeMap.has(pattern)) {
      problems.push(`${MAP_FILE}:${n}: exclusion ${repr(pattern)} is not in EXCLUDE in ${SCRIPT}`);
    }
  }

  for (const rule of RULES) {
    for (const [doc] of rule.message.matchAll(MESSAGE_DOC_RE)) {
      if (!tree.exists(doc))
        problems.push(`${SCRIPT}: rule ${rule.id}: its message names a missing file: ${doc}`);
    }
  }
  return problems;
}

interface Invariant {
  n: number;
  num: string;
  struck: boolean;
  ids: [string, string[]][];
}

function checkInvariants(tree: Tree): string[] {
  const text = tree.text(INVARIANTS);
  if (text === null) return [`${INVARIANTS} is missing`];
  const problems: string[] = [];
  const seen = new Map<string, number>();
  let current: Invariant | null = null;
  const items: Invariant[] = [];
  for (const [n, line, kind] of scan(text)) {
    if (kind !== 'text') continue;
    const m = LIST_ITEM_RE.exec(line);
    if (!m) continue;
    if (m[1] === '') {
      const im = INVARIANT_RE.exec(line);
      if (!im) {
        problems.push(
          `${INVARIANTS}:${n}: list item is not of the form '- **<N>.** <rule>': ${strip(line)}`,
        );
        current = null;
        continue;
      }
      const num = im[1]!;
      if (seen.has(num))
        problems.push(
          `${INVARIANTS}:${n}: invariant ${num} is already used on line ${seen.get(num)}`,
        );
      if (!seen.has(num)) seen.set(num, n);
      // The match ends with the first character of the rule text.
      const rest = line.slice(im.index + im[0].length - [...im[0]].at(-1)!.length);
      current = { n, num, struck: rest.startsWith('~~'), ids: [] };
      items.push(current);
    } else {
      const tm = TEST_ID_RE.exec(line);
      const tid = tm ? parseTestId(tm[1]!) : null;
      if (tid === null || current === null) {
        problems.push(
          `${INVARIANTS}:${n}: nested item is not a test id under an invariant ` +
            `('  - \`path::test_name\`'): ${strip(line)}`,
        );
        continue;
      }
      current.ids.push(tid);
    }
  }
  for (const { n, num, struck, ids } of items) {
    if (struck) continue;
    if (!ids.length) {
      problems.push(
        `${INVARIANTS}:${n}: invariant ${num} names no test; a rule no test enforces ` +
          'belongs in the technical document as a note',
      );
    }
    for (const [path, names] of ids) {
      const tid = [path, ...names].join('::');
      const body = tree.exists(path) ? tree.text(path) : null;
      if (body === null) {
        problems.push(`${INVARIANTS}:${n}: invariant ${num}: test file ${path} does not exist`);
        continue;
      }
      const missing = missingTest(path, body, names);
      if (missing) problems.push(`${INVARIANTS}:${n}: invariant ${num}: ${tid}: ${missing}`);
    }
  }
  return problems;
}

/**
 * [path, names] from `path::name::...`, or null if it is not a test id. A
 * name is any text without `::` that neither starts nor ends with `:` (so the
 * split is unambiguous).
 */
export function parseTestId(text: string): [string, string[]] | null {
  const [path, ...names] = text.split('::');
  if (!path || path.includes(':') || !names.length) return null;
  const ok = names.every((name) => name && !name.startsWith(':') && !name.endsWith(':'));
  return ok ? [path, names] : null;
}

const JS_ESCAPES: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '0': '\0',
};
const JS_ESCAPE_RE = /\\(?:x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|([^\n]))/gu;

/**
 * The value of a JS string literal's body: \n, \t, \xHH, \uHHHH, \u{H...} and
 * the rest resolved; any other escaped character stands for itself, as in JS.
 * Surrogate pairs from \uHHHH\uHHHH make one character.
 */
export function jsUnescape(raw: string): string {
  return raw.replace(
    JS_ESCAPE_RE,
    (_m, x?: string, braced?: string, u?: string, other?: string) => {
      const hex = x ?? braced ?? u;
      if (hex !== undefined) return String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff));
      return Object.hasOwn(JS_ESCAPES, other!) ? JS_ESCAPES[other!]! : other!;
    },
  );
}

const jsCallCache = new Map<string, [string, string][]>();

/** [function, literal value] for each describe/it/test call, in file order. */
function jsCalls(body: string): [string, string][] {
  let calls = jsCallCache.get(body);
  if (!calls) {
    calls = [...body.matchAll(JS_CALL_RE)].map((m) => [m[1]!, jsUnescape(m[2] ?? m[3]!)]);
    jsCallCache.set(body, calls);
  }
  return calls;
}

/**
 * Null if `path::names` is a test that exists, else what is missing: the
 * names before the last must be describe(...) literals and the last an
 * it(...) or test(...) literal, appearing in this order in `body`. Text
 * search, not a parse: nesting is not verified.
 */
export function missingTest(path: string, body: string, names: readonly string[]): string | null {
  const calls = jsCalls(body);
  let pos = 0;
  let prev: string | null = null;
  for (const [i, name] of names.entries()) {
    const kinds = i === names.length - 1 ? ['it', 'test'] : ['describe'];
    const quoted = JSON.stringify(name);
    const label = kinds.map((k) => `${k}(${quoted})`).join(' or ');
    let found = -1;
    for (let j = pos; j < calls.length; j++) {
      if (kinds.includes(calls[j]![0]) && calls[j]![1] === name) {
        found = j;
        break;
      }
    }
    if (found === -1) {
      if (prev && calls.some(([k, lit]) => kinds.includes(k) && lit === name)) {
        return `${label} does not come after ${prev} in ${path}`;
      }
      return `no ${label} in ${path}`;
    }
    pos = found + 1;
    prev = `${calls[found]![0]}(${quoted})`;
  }
  return null;
}

export interface IntegrityOptions {
  /** Replaces SECTION_ALIASES. */
  sectionAliases?: Readonly<Record<string, string>>;
}

export function integrity(root: string, options: IntegrityOptions = {}): string[] {
  const tree = new Tree(root);
  return [
    ...checkLinks(tree),
    ...checkCodeRefs(tree),
    ...checkSectionCitations(tree, options.sectionAliases ?? SECTION_ALIASES),
    ...checkIndex(root).map((p) => `${p} (${INDEX_GENERATOR} --check)`),
    ...checkMap(tree),
    ...checkInvariants(tree),
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export interface MainOptions {
  /** Repository root; by default `git rev-parse --show-toplevel` in the working directory. */
  root?: string;
  /** Environment; by default process.env. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Receives everything the check prints; by default standard output and standard error. */
  write?: (text: string) => void;
  /** Replaces isVersionBump (tests). */
  isVersionBump?: typeof isVersionBump;
}

export function main(
  argv: readonly string[] = process.argv.slice(2),
  options: MainOptions = {},
): number {
  const output: Output = options.write
    ? { write: options.write, writeError: options.write }
    : processOutput;
  const print = (line = '') => output.write(`${line}\n`);
  const parsed = parseArgs(
    argv,
    'check-docs.ts',
    'Check that every behaviour change carries its documentation.',
    [
      { long: '--base', metavar: 'REF', help: 'base branch (default: origin/main, else main)' },
      { long: '--verbose', short: '-v', help: 'list the changed files' },
      {
        long: '--integrity-only',
        help: 'run only the whole-tree integrity checks (no base needed)',
      },
    ],
    output,
  );
  if ('exit' in parsed) return parsed.exit;
  const base = parsed.values.get('--base') as string | undefined;
  const verbose = parsed.values.has('--verbose');
  const env = options.env ?? process.env;
  const bumpFilter = options.isVersionBump ?? isVersionBump;

  if (env['SKIP_DOCS_CHECK'] === '1') {
    if (env['CI']) {
      print('docs-check: SKIP_DOCS_CHECK is ignored because CI is set');
    } else {
      print('docs-check: skipped because SKIP_DOCS_CHECK=1 (local only; CI always runs the check)');
      return 0;
    }
  }

  let root: string;
  let ref: string;
  let mergeBase: string;
  let short: string;
  let changed: string[];
  let added: Set<string>;
  try {
    root = options.root ?? gitText(git(process.cwd(), ['rev-parse', '--show-toplevel']));
    if (parsed.values.has('--integrity-only')) {
      const problems = integrity(root);
      if (problems.length) {
        print('docs-check: integrity checks failed:');
        for (const p of problems) print(`✗ ${p} [integrity]`);
        print();
        print(FOOTER);
        return 1;
      }
      print(`docs-check: integrity checks pass on ${plural(treeFiles(root).length, 'file')}`);
      return 0;
    }
    [ref, mergeBase] = findBase(root, base);
    short = gitText(git(root, ['rev-parse', '--short', mergeBase]));
    changed = changedFiles(root, mergeBase);
    added = newFiles(root, mergeBase);
  } catch (e) {
    if (e instanceof GitError) {
      print(`docs-check: ${e.message}`);
      return 2;
    }
    throw e;
  }

  const failures: string[] = [];
  const sources: string[] = [];
  const notes = new Map<string, string>();
  for (const path of changed) {
    const why = excluded(path);
    if (why) {
      notes.set(path, `left out: ${why}`);
      continue;
    }
    let bump: boolean;
    try {
      bump = bumpFilter(root, mergeBase, path);
    } catch (e) {
      // A broken filter must fail the check, never pass it.
      const name = e instanceof Error ? e.name : typeof e;
      const message = e instanceof Error ? e.message : String(e);
      failures.push(
        `✗ version-bump filter failed on ${path} (${name}: ${message}); ` +
          'the check fails instead of guessing [filter]',
      );
      bump = false;
    }
    if (bump) {
      notes.set(path, 'left out: version bump only');
      continue;
    }
    sources.push(path);
  }

  if (verbose) {
    print(`docs-check: changed since ${ref} (${short}):`);
    for (const path of changed) {
      const note = notes.get(path);
      print(`  ${path}${note ? `  (${note})` : ''}`);
    }
  }

  const deleted = new Set(changed.filter((p) => kindOf(root, p) === 'missing'));
  for (const [rule, hits] of evaluate(sources, changed, added, deleted)) {
    failures.push(`✗ ${rule.message} [${rule.id}]`);
    failures.push(...hits.map((p) => `    ${p}`));
  }
  failures.push(...integrity(root).map((p) => `✗ ${p} [integrity]`));

  if (failures.length) {
    print(`docs-check: failed against ${ref} (${short}):`);
    for (const f of failures) print(f);
    print();
    print(FOOTER);
    return 1;
  }
  print(
    `docs-check: ${plural(changed.length, 'changed file')} since ${ref} (${short}), ` +
      'each with the documentation it needs',
  );
  return 0;
}

if (import.meta.main) process.exitCode = main();

# Documentation contract: technical

For whoever changes `tools/docs-check/`, the workspace that holds the documentation check and the decisions index generator. What the user sees is in [docs-contract-user.md](docs-contract-user.md); how to write documents is in the [documentation guide](../guides/documentation.md).

## Data flow

The workspace is TypeScript that Node 26 runs directly with type stripping. Its modules import only Node built-ins and each other, so it runs on a fresh clone without `npm ci` ([decision](../decisions/docs.md#the-check-uses-only-node-built-ins-and-runs-with-node-type-stripping)).

| Module | Holds |
| --- | --- |
| `src/check-docs.ts` | `RULES`, `EXCLUDE`, `BUMP_FILTERS`, `JSON_BUMP_FILTERS`, `SECTION_ALIASES`; the git calls, the filters, the rules, the integrity checks and `main` |
| `src/decisions-index.ts` | `DOMAINS`, `parseDecisions`, `render`, `check` and its own `main` |
| `src/markdown.ts` | `scan`, `headings`, `anchors`, `slugify`, `plainHeadingText`, `codeSpanText`, `stripCodeSpans`, `codeSpans` |
| `src/text.ts` | Character classes, whitespace, line splitting, quoting, ordering, paths that are not UTF-8, POSIX paths, percent-decoding ([text semantics](#text-semantics)) |
| `src/json.ts` | `loadJson`, `canonical`, `jsonEquals`, for the `package.json` bump filter |
| `src/cli.ts` | `parseArgs` (the command-line options of both scripts) and `processOutput` |

Each script calls its `main` only when Node runs it as the entry point (`import.meta.main`), so the tests import the modules without running them, and sets `process.exitCode` to the code `main` returns.

`src/check-docs.ts`, `main(argv, options)`:

1. `parseArgs` reads `--base REF`, `-v`/`--verbose`, `--integrity-only` and `-h`/`--help`. An unknown option prints the usage and returns 2.
2. If `SKIP_DOCS_CHECK` is `1` and `CI` is empty, print the skip message and return 0. If `CI` is set, print that the variable is ignored and go on. `options.env` replaces `process.env` (tests).
3. `git rev-parse --show-toplevel` in the working directory gives the root (`options.root` replaces it in tests). With `--integrity-only`, `main` runs step 9 alone and returns; no base is resolved.
4. `findBase(root, base)` resolves `--base REF`, or else the first of `origin/main` and `main` that exists, and returns the ref name and `git merge-base HEAD <ref>`. It never tries another branch. It throws `GitError` when nothing resolves; `main` prints the message and returns 2.
5. `changedFiles(root, mb)` is the union of `git diff --name-only -z --no-renames <mb> HEAD` (commits), `git diff --name-only -z --no-renames HEAD` (unstaged), `git diff --name-only -z --no-renames --cached` (staged) and `git ls-files -z --others --exclude-standard` (untracked), sorted by code point. With `--no-renames`, a move is a deletion plus an addition, so both paths count.
6. `newFiles(root, mb)` is `git diff --name-only -z --find-renames --diff-filter=A <mb>` (merge base against the working tree, so committed and staged additions count) plus the untracked files. Git pairs a deleted file with an added one when their content is at least 50% similar, so a file moved with `git mv`, or a new file copied from a deleted one, is a rename there, not an addition.
7. Each changed path goes through `excluded(path)` (the `EXCLUDE` list) and then `isVersionBump(root, mb, path)` (`options.isVersionBump` replaces it in tests). What is left is the source side. An exception from the filter adds a `[filter]` failure and keeps the path on the source side.
8. `evaluate(sources, changed, added, deleted)` checks each rule in `RULES`. A regular rule is broken when some source path matches `Rule.source` (a search anywhere in the path) and no changed path matches `Rule.docs`. The catch-all rule (`catchAll: true`, F0) takes only source paths that no regular rule matches and that still exist in the working tree (`main` passes the deleted ones in `deleted`), and looks for its documents in `added` (from `newFiles`) instead of `changed`.
9. `integrity(root)` runs on every file from `git ls-files --cached --others --exclude-standard` that exists and is not a symlink (so `CLAUDE.md` is not read twice). The checks are listed under [Integrity checks](#integrity-checks).
10. Failures are printed with the footer and the exit code is 1; otherwise the success line and 0. `options.write` receives everything `main` prints (tests); by default it goes to standard output, and usage errors to standard error.

`src/decisions-index.ts`, `main(argv, options)`: `render(root, DOMAINS)` reads `docs/decisions/<stem>.md` for each stem in `DOMAINS`, runs `parseDecisions` on it and builds the index text. Without `--check` it writes `docs/decisions/README.md`, unless a decision file is malformed. With `--check`, `check(root, DOMAINS)` compares the file with the rendered text and lists files missing from `DOMAINS` and `DOMAINS` entries without a file. The root is the directory three levels above the module (`options.root` replaces it, and `options.domains` replaces `DOMAINS`, in tests). `check-docs.ts` calls `check` for its integrity checks.

Markdown parsing, in `src/markdown.ts`, shared by both scripts:

- `scan(text)` labels each line `front` (YAML front matter: the file starts with `---` and a later line is `---` or `...`), `code` (inside a fence of three or more backticks or tildes, fence lines included) or `text`.
- `headings(text)` finds ATX headings (`# ...` to `###### ...`, optional closing `#`s) and setext headings (a paragraph line followed by `===` or `---`) in `text` lines. A line starting with a list marker, `>`, `|` or `#` is not a setext title.
- `slugify(text)` computes GitHub's anchor: inline Markdown reduced to its text (`plainHeadingText`: links and images become their text, HTML tags and `*`, `~` and emphasis `_` go, code spans keep their content literally, with one space taken off each end when both ends have one, as CommonMark does), lowercased, every character removed except letters, numbers, combining marks, connector punctuation, `-`, `_` and space, then each space replaced by `-`. `headings` appends `-1`, `-2` to repeated slugs, as GitHub does.
- `anchors(text)` is the set of heading slugs plus `id="..."` and `name="..."` values of HTML tags.

### Text semantics

The check was first written in Python, and documents quote its messages and link the anchors it computes. Where JavaScript behaves differently, `src/text.ts` and `src/json.ts` keep the behaviour the check was specified with, so the port changed no message, anchor or result:

- **Character classes.** JavaScript's `\w`, `\d` and `\b` are ASCII only. `WORD` (`\p{L}\p{N}_`), `DIGIT` (`\p{Nd}`) and `SPACE` replace `\w`, `\d` and `\s` in every regex of `check-docs.ts`, `markdown.ts` and `decisions-index.ts`, all compiled with the `u` flag, and a word boundary is a lookbehind for `WORD`. So a heading `Zażółć` keeps its letters in the slug, and `١٢` is a section number. `SPACE` is the whitespace of Python's `str.isspace`: it includes U+001C to U+001F and leaves out U+FEFF, which JavaScript's `\s` does the other way round. Where `.` must also match `\r`, U+2028 and U+2029, the regex says `[^\n]`.
- **Whitespace and lines.** `strip`, `lstrip` and `rstrip` remove `SPACE`, not a byte order mark. `splitLines` splits at `\n`, `\r\n`, `\r`, `\v`, `\f`, U+001C to U+001E, U+0085, U+2028 and U+2029, so line numbers in messages count those as line ends. `readText` reads a file as UTF-8 (a file that is not UTF-8 is not read), turns `\r\n` and `\r` into `\n`, and keeps a byte order mark.
- **Quoting.** `repr` quotes the regexes and values in the ownership-map messages: in `'...'`, or in `"..."` when the text holds `'` and no `"`; `\`, the quote, tab, newline and carriage return escaped; other control and unprintable characters as `\xHH`, `\uHHHH` or `\UHHHHHHHH`.
- **Order.** `compareCodePoints` sorts paths by code point; JavaScript's default sort compares UTF-16 code units and puts characters above U+FFFF before U+E000 to U+FFFF.
- **Paths that are not UTF-8.** git output is read as bytes (`-z`) and decoded by `decodeEscaped`, which turns every byte that is not part of a valid UTF-8 sequence into one of U+DC80 to U+DCFF. `encodeEscaped` turns them back, so file system calls and the printed output use the path's own bytes. Node cannot pass such bytes to git as an argument, so the version-bump filters never treat such a path as a bump: it stays on the source side and needs its documentation. (The Python version could pass the bytes, so a pure version bump in such a file passed there.)
- **POSIX paths.** `normPath`, `joinPath` and `dirnamePath` resolve link targets. `node:path` differs: it keeps a trailing slash and collapses a leading `//`.
- **Percent-decoding.** `unquote` decodes each run of ASCII characters in a link target as UTF-8 with invalid bytes as U+FFFD, and leaves a `%` without two hex digits as it is; `decodeURIComponent` throws on both.
- **JSON.** `JSON.parse` keeps the last of two equal keys and reads `1`, `1.0` and `1e0` as one number. `loadJson` parses into a tree that keeps integers (as `bigint`) and floats apart, and returns null for a repeated key in any object, for input that is not UTF-8, and for a byte order mark; it accepts `NaN`, `Infinity` and `-Infinity`. `canonical` keeps `true` and `1`, and `1` and `1.0`, apart and ignores key order. `jsonEquals`, used for the unchanged-value test, compares numbers by value, so `1`, `1.0` and `true` are equal there.
- **Unicode version.** The classes follow the Unicode version of the running Node (17.0 in Node 26.13); the Python version used its interpreter's (16.0 in Python 3.14). Characters added in Unicode 17 now count as letters, digits or printable.

### Integrity checks

| Function | What fails |
| --- | --- |
| `checkLinks` | In `.md` files, outside fenced code and with code spans removed: an inline link, image or reference definition whose relative target does not exist (compared case-sensitively, so a link that only works on macOS fails), leaves the repository, uses a `#L<n>` fragment, or names a heading the target `.md` file does not have. A code span that is exactly a lowercase `docs/<path>.md` path, with or without an anchor, is checked the same way. Any `<file>.md:<n>` or `<file>.md#L<n>` in the text fails. Links with a scheme (`https:`, `mailto:`) or starting with `//` are skipped. A leading `/` means the repository root. |
| `checkCodeRefs` | In comments of other files: a `docs/<path>.md` or `docs/<path>.md#anchor` reference to a missing file or heading, and any `.md:<n>` or `.md#L<n>`. The comment marker comes from the extension (`HASH_COMMENT`, `SLASH_COMMENT`, `DASH_COMMENT`, `HTML_COMMENT`); a line is a comment from its first marker on. Files with another extension are not read. |
| `checkSectionCitations` | In Markdown text and in comments: `<file>.md §<n>` whose file has no heading starting with `<n>` (optionally `§<n>`), and `<word> §<n>` where `<word>` is not in `SECTION_ALIASES`. |
| `check` from `decisions-index.ts` | The decisions index is stale, a decision file is not in `DOMAINS`, a `DOMAINS` entry has no file, or a decision has no valid `Status:` line. |
| `checkMap` | The ownership-map table or the exclusions table in `docs/features/README.md` is missing, or differs from `RULES` or `EXCLUDE` (a missing, extra, duplicated or different row), or a `docs/<path>.md` path named in a rule message does not exist. |
| `checkInvariants` | See [docs/invariants.md](#docsinvariantsmd). |

### Version-bump filter

`isVersionBump(root, mb, path)` first looks for a `JSON_BUMP_FILTERS` entry whose path regex matches, then for a `BUMP_FILTERS` entry. A path that matches neither is never a bump, and neither is a path that is not valid UTF-8 ([text semantics](#text-semantics)).

**Line filters.** `BUMP_FILTERS` pairs a path regex with a line regex. For a changed path that matches a path regex, `isVersionBump` reads `git diff -U0 --no-renames --no-color --no-ext-diff <mb> -- <path>` (merge base against the working tree). The path is a pure bump only if there is at least one hunk, every hunk removes as many lines as it adds, and each removed line and the added line at the same position in the hunk both match the line regex in full, differ, and are equal once the groups `v` (the version) and `c` (a trailing comment) are cut out. Pairing by position means a `uses:` line moved to another job is not a bump: its removal and its addition land in different hunks. An untracked file has no diff against the merge base and is never a bump.

| Path regex | Line regex matches |
| --- | --- |
| `^\.github/workflows/[^/]+\.ya?ml$` | `uses: <owner>/<action>@<version>`, optionally after `- `, optionally quoted, optionally followed by `# <comment>` |

**JSON filters.** `JSON_BUMP_FILTERS` pairs a path regex with the names of top-level fields whose values may change. `isJsonVersionBump` reads the file at the merge base (`git show <mb>:<path>`) and in the working tree, and parses both with `loadJson`. The path is a pure bump only if:

- the file exists on both sides as a regular file, and both sides are UTF-8 JSON objects without a repeated key in any object;
- every top-level field outside the list is equal on both sides (compared with `canonical`, so `true` and `1` differ, `1` and `1.0` differ, and key order does not matter);
- each listed field is present on both sides or on neither; where present, it is an object on both sides with the same keys;
- every value that differs (by `jsonEquals`) is a version range on both sides (`isVersionRange`: a string without `:` and without `/`, such as `^19.1.0`, `>=1 <2`, `latest` or `*`); a value that names a package source (`npm:preact@^10`, `file:../x`, `workspace:*`, `github:user/repo`, `git+https://...`, `user/repo`) is not a version, on either side;
- at least one value differs.

An unchanged value is not checked, so a `workspace:*` dependency next to a bumped one does not stop the bump.

A dependency that is added, removed or moved to another field is not a bump, and neither is a change that only reformats the file. A file that does not parse is not a bump either: it stays on the source side, and the check does not fail with `[filter]`. Formatting, indentation and key order are ignored, so a bump that also reformats the file still passes.

| Path regex | Fields whose version ranges may change |
| --- | --- |
| `(^\|/)package\.json$` | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` |

`engines`, `packageManager`, `scripts`, `workspaces` and every other field are compared in full, so a change to them needs the document that states them. Lock files are left out by `EXCLUDE`, not by this filter.

No other file pins versions yet. When one does (a hook configuration), add a pair. A pin that the documentation states, such as a toolchain version, must not match a line regex or be in a JSON field list, so a change to it still needs the document. [Why `package.json` is parsed](../decisions/docs.md#packagejson-bumps-are-compared-as-parsed-json).

## Schema

**`Rule`** (interface in `src/check-docs.ts`):

| Field | Meaning |
| --- | --- |
| `id` | `F<n>` for a feature, `C<n>` for something cross-cutting (CI, build file, scripts). Shown as `[<id>]`. |
| `source` | Regex searched in each source-side path. |
| `docs` | Regex searched in each changed path (in each new path for the catch-all). |
| `message` | Printed after `✗`; names the document to update. Every `docs/<path>.md` path in it must exist. |
| `catchAll` | `true` only for F0. |

**`EXCLUDE`**: list of `[regex, why]`. **`BUMP_FILTERS`**: list of `[path regex, line regex]`. **`JSON_BUMP_FILTERS`**: list of `[path regex, top-level field names]`. **`SECTION_ALIASES`**: word to document path, empty. The regexes in `RULES` and `EXCLUDE` are compiled with the `u` flag and searched anywhere in the path; they are equal to the cells of the tables in `docs/features/README.md` as strings, so they use no class from [text semantics](#text-semantics).

**Ownership-map table** in `docs/features/README.md`: the first table whose header cells are `#`, `source path regex`, `doc path regex`, `message` (case-insensitive). One row per rule, in any order. The regex cells are code spans. In every cell `\|` stands for `|`. The message cell is plain text and must equal `Rule.message` character for character.

**Exclusions table** in the same file: header `path regex`, `why`. The regex cell is a code span; the reason equals the second element of the `EXCLUDE` entry.

### docs/invariants.md

Every list item outside fenced code is checked:

- A top-level item is `- **<N>.** <rule>`. Any other top-level list item (an ordered `1.`, a bullet without a number) fails. A number appears once.
- A nested item is a test id: `  - ` followed by a code span (`TEST_ID_RE`) holding `<path>::<name>`, with one or more names. `parseTestId` splits it at `::`. The path must not be empty and must not contain `:`. A name is any text without a backtick and without `::` that neither starts nor ends with `:`. The file must exist.
- **Vitest**: a test id names Vitest tests, as in `packages/core/src/yuyv.test.ts::decodeYUYV::reads lo and hi bytes`; there is no other kind since the Python tests were removed in #30. `missingTest` lists the calls `describe(...)`, `it(...)` and `test(...)` whose whole first argument is one string literal in `"` or `'` (`JS_CALL_RE`; `jsCalls` caches the list per file content). Every name before the last must equal a `describe` literal and the last an `it` or `test` literal, and they must appear in the file in that order, each after the previous one. The literal's value is compared exactly with the name, after `jsUnescape` resolves its escapes as JavaScript does (`\"`, `\'`, `\\`, `\n`, `\t` and the other one-letter escapes, `\xHH`, `\uHHHH`, `\u{H...}`; any other escaped character stands for itself), so the name is the one Vitest shows: `it("say \"hi\"")` is `<path>::say "hi"`. A template literal, a concatenation, `it.each`, and calls with a modifier such as `it.only` or `describe.skip` are not found.
- **Known limitation of the Vitest search:** the check imports only Node built-ins, so it has no TypeScript parser, and it does not verify the real nesting. `describe("A", ...)` followed by a separate `describe("B", () => { it("x") })` lets `<path>::A::x` pass, although `x` is in `B` (`tools/docs-check/test/integrity.test.ts::Vitest ids::vitest id with wrong nesting passes`). Calls inside comments and strings count too. Review checks that a Vitest test id names the test that enforces the rule. [Why there is no parser](../decisions/docs.md#vitest-test-ids-are-checked-by-text-search).
- An invariant whose text starts with `~~` is retired and may have no test ids. Every other invariant needs at least one.

**Decision file** `docs/decisions/<stem>.md`: each `##` heading (ATX or setext) is one decision. The first non-blank line after it must match `^Status: (decided|postponed|superseded)( \(#N(, #N)*\))?$`. Other heading levels are ignored.

**Decisions index** `docs/decisions/README.md`: a `# Decisions index` title, a paragraph that starts `Generated by` and says not to edit by hand, then per `DOMAINS` entry a `## <title>` and a table `Decision | File | Status`. The decision cell links `<stem>.md#<slug>`; the status cell is the status with its references in parentheses. A domain without decisions gets `No decisions yet.`

## Interfaces

`node tools/docs-check/src/check-docs.ts [--base REF] [-v] [--integrity-only]`, or `npm run docs-check -- [--base REF] [-v] [--integrity-only]`:

| Option | Default | Effect |
| --- | --- | --- |
| `--base REF` (also `--base=REF`) | `origin/main`, else `main` | Base branch for the merge base. A missing ref exits 2. |
| `-v`, `--verbose` | off | Print each changed file before the result, with `(left out: <why>)` or `(left out: version bump only)` for the ones not on the source side. |
| `--integrity-only` | off | Run only the integrity checks. No base is needed, and `--base` and `-v` have no effect. |
| `-h`, `--help` | | Print the usage and the options, and exit 0. |

A long option may be shortened to a prefix that names one option (`--integ`). Any other argument is a usage error (exit 2).

`node tools/docs-check/src/decisions-index.ts [--check]`, or `npm run decisions-index [-- --check]`: without the flag it writes the index; with it, it only reports.

Functions other code uses: from `check-docs.ts`, `main(argv?, { root, env, write, isVersionBump }?) -> number`, `integrity(root, { sectionAliases }?) -> string[]`, `RULES`, `EXCLUDE`, `excluded`, `jsUnescape`, `parseTestId` and `missingTest` (the tests); from `decisions-index.ts`, `main(argv?, { root, domains, write }?) -> number`, `render(root, domains = DOMAINS) -> [string, string[]]` and `check(root, domains = DOMAINS) -> string[]` (`check-docs.ts` and the tests); from `markdown.ts`, `scan`, `headings`, `anchors` and `slugify` (both scripts and the tests).

The npm scripts that call these files are listed in the [development guide](../guides/development.md#npm-scripts); the CI jobs in [CI](../guides/development.md#ci).

## Configuration

| Name | Default | Read by | Effect |
| --- | --- | --- | --- |
| `SKIP_DOCS_CHECK` | unset | `check-docs.ts`, `main` | `1` skips the check and exits 0, unless `CI` is set. Any other value is ignored. |
| `CI` | unset (GitHub Actions sets `true`) | `check-docs.ts`, `main` | Any non-empty value makes `SKIP_DOCS_CHECK` ignored. |
| `DOMAINS` | `{ docs: 'Documentation contract', architecture: 'Architecture' }` | `decisions-index.ts` | Decision file stems and their index titles, in index order. |

The scripts run git with `-z`, `--no-color` and `--no-ext-diff`, so `core.quotepath`, `color.ui` and external diff drivers do not change their input.

The workspace needs Node 26 (`.nvmrc`), which strips the types when it loads a `.ts` file; it uses only erasable syntax (`erasableSyntaxOnly` in `tsconfig.base.json`). Its TypeScript projects are `tools/docs-check/tsconfig.lib.json` (`src/` without the tests) and `tools/docs-check/tsconfig.test.json` (the tests, `test/` and `vitest.config.ts`), both with `lib` ES2024 and the `node` types and without output; the [development guide](../guides/development.md#typescript) lists them with the others. `tools/docs-check/vitest.config.ts` names the Vitest project `docs-check`, with environment `node` and a 60-second timeout per test and hook, because a test copies the repository and runs the check several times.

## Failure modes

`check-docs.ts`, exit code 2 (printed after `docs-check: `):

| Message | Cause |
| --- | --- |
| `no base branch: neither origin/main nor main exists; pass --base REF` | No `--base`, and neither ref resolves to a commit. |
| `base ref '<ref>' does not exist` | `--base` names a ref that does not resolve. |
| `HEAD and <ref> have no merge base` | Unrelated histories, or a shallow clone (CI uses `fetch-depth: 0` for this reason). |
| `git <args> failed: <git's error>` | Not a git repository, no commit yet, or another git error; `spawnSync git ENOENT` when git is not installed. |

Both scripts, exit code 2, on standard error: the usage line, such as `usage: check-docs.ts [-h] [--base REF] [-v] [--integrity-only]`, then `check-docs.ts: error: unrecognized arguments: <arguments>` (or `decisions-index.ts: error: ...`), `argument --base: expected one argument`, `ambiguous option: <option> could match <options>` or `argument -v/--verbose: ignored explicit argument '<value>'`.

`check-docs.ts --integrity-only` prints `docs-check: integrity checks pass on <N> files` and exits 0, or `docs-check: integrity checks failed:`, the `[integrity]` lines below and the footer, and exits 1.

`check-docs.ts`, exit code 1. Every failure is one line starting with `✗`, followed by the footer `What to update: the "You changed / You must also update" table in AGENTS.md (section "Documentation contract").` and `How to write it: docs/guides/documentation.md.`

| Message | Cause |
| --- | --- |
| `✗ <rule message> [<id>]`, then the triggering paths indented by four spaces | A rule is broken. |
| `✗ version-bump filter failed on <path> (<error name>: <message>); the check fails instead of guessing [filter]` | `isVersionBump` threw, for example `TypeError: The encoded data was not valid for encoding utf-8` for a diff that is not UTF-8. |
| `✗ <file>:<line>: link '<target>' points to a missing file: <path> [integrity]` | Broken relative link. The same wording with `` `<span>` `` or `reference '<ref>'` instead of `link '<target>'` for a code span or a code comment. |
| `✗ <file>:<line>: link '<target>' points to a missing heading: <file>#<anchor> [integrity]` | The anchor is not a heading slug or HTML id of the target. |
| `✗ <file>:<line>: link '<target>' points outside the repository [integrity]` | The target starts with `../` after normalisation. |
| `✗ <file>:<line>: link '<target>' uses a line number (#L<n>); link the heading anchor or name the symbol [integrity]` | A `#L<n>` fragment. |
| `✗ <file>:<line>: '<text>' refers to a line number; use the heading anchor [integrity]` | `<file>.md:<n>` or `<file>.md#L<n>` in text or a comment. |
| `✗ <file>:<line>: '<cite>' cites an unknown document; cite the file path or add '<word>' to SECTION_ALIASES in tools/docs-check/src/check-docs.ts [integrity]` | `<word> §<n>` with an unknown word. |
| `✗ <file>:<line>: '<cite>' cites a missing file: <path> [integrity]` | `<file>.md §<n>` for a file that does not exist. |
| `✗ <file>:<line>: '<cite>': <path> has no heading for section <n> [integrity]` | The cited file has no heading starting with the number. |
| `✗ <message> (tools/docs-check/src/decisions-index.ts --check) [integrity]` | One of the `decisions-index.ts` messages below. |
| `✗ docs/features/README.md:<line>: rule <id>: <field> differs from RULES (RULES: '<value>', table: '<value>') [integrity]` | A table row differs; `<field>` is `source regex`, `doc regex` or `message`. |
| `✗ docs/features/README.md: rule <id> from RULES is missing from the ownership-map table [integrity]` | A rule has no row. |
| `✗ docs/features/README.md:<line>: rule <id> is not in RULES in tools/docs-check/src/check-docs.ts [integrity]` | A row has no rule. |
| `✗ docs/features/README.md:<line>: rule <id> appears twice [integrity]` | Two rows with one id. |
| `✗ docs/features/README.md:<line>: rule <id>: write both regexes as code spans [integrity]` | A regex cell is not a code span. |
| `✗ docs/features/README.md:<line>: ownership-map row needs 4 cells, has <n> [integrity]` | Usually an unescaped `\|` in a regex. |
| `✗ docs/features/README.md: no ownership-map table with columns: # \| source path regex \| doc path regex \| message [integrity]` | The table or its header is gone. The same with `no exclusions table with columns: path regex \| why`. |
| `✗ docs/features/README.md: exclusion '<regex>' from EXCLUDE is missing from the exclusions table [integrity]` | Also `... is not in EXCLUDE in tools/docs-check/src/check-docs.ts`, `... reason differs from EXCLUDE (...)`, `... appears twice` and `exclusion row needs 2 cells, the regex as a code span`. |
| `✗ docs/features/README.md is missing; it must hold the ownership map [integrity]` | The file is gone. |
| `✗ tools/docs-check/src/check-docs.ts: rule <id>: its message names a missing file: <path> [integrity]` | A rule message names a document that does not exist. |
| `✗ docs/invariants.md:<line>: list item is not of the form '- **<N>.** <rule>': <item> [integrity]` | A top-level list item in another form. |
| `✗ docs/invariants.md:<line>: invariant <N> is already used on line <line> [integrity]` | A reused number. |
| `` ✗ docs/invariants.md:<line>: nested item is not a test id under an invariant ('  - `path::test_name`'): <item> [integrity] `` | A nested item that is not a test id, or one before the first invariant. |
| `✗ docs/invariants.md:<line>: invariant <N> names no test; a rule no test enforces belongs in the technical document as a note [integrity]` | A live invariant without test ids. |
| `✗ docs/invariants.md:<line>: invariant <N>: test file <path> does not exist [integrity]` | Also `invariant <N>: <id>: no describe("<name>") in <path>`, `... no it("<name>") or test("<name>") in <path>`, and `... <call>("<name>") does not come after <call>("<previous name>") in <path>` when the name exists only before the previous one. The names are printed as JSON strings, so a `"` or `\` in a name is escaped. |
| `✗ docs/invariants.md is missing [integrity]` | The file is gone. |

`decisions-index.ts` (printed after `decisions-index: `):

| Message | Exit | Cause |
| --- | --- | --- |
| `wrote docs/decisions/README.md (<N> decisions)` | 0 | Written. |
| `docs/decisions/README.md is up to date` | 0 | `--check`, nothing to do. |
| `` docs/decisions/README.md is stale: run `npm run decisions-index` `` | 1 | `--check`: the file differs from the rendered text. |
| `docs/decisions/<stem>.md is not listed in DOMAINS in tools/docs-check/src/decisions-index.ts` | 1 | `--check`: a decision file without a `DOMAINS` entry. |
| `DOMAINS in tools/docs-check/src/decisions-index.ts lists '<stem>', but docs/decisions/<stem>.md does not exist` | 1 | `--check`: an entry without a file. |
| `docs/decisions/<stem>.md:<line>: decision '<heading>' needs 'Status: decided\|postponed\|superseded (#N)' as the first line under the heading, found: <line or None>` | 1 | A decision without a valid status. Nothing is written. |

## Tests

Vitest project `docs-check`; `npm test` runs it with the other projects. The tests in `test/` copy the working tree into a temporary git repository with `test/repo.ts` and run the copied `src/check-docs.ts` there with `node`; how they isolate git is in the [testing guide](../guides/testing.md#what-each-test-file-needs).

- `test/rules.test.ts`: an owned path with and without its document; a change only to test files and a sample path for every `EXCLUDE` pattern; untracked, staged and unstaged sources and documents; deletion and rename; a package source path that looks like a test directory but is not excluded (it falls under F2); no base, no merge base, a missing `--base` ref, `--base`, and `origin/main` before `main`; the rules for the TypeScript code (a core path needs the core documents and not the cameras ones, a cameras path the cameras documents and not the core ones, `apps/web/` and `netlify.toml` the web app documents, each root configuration file of C3 a guide, core's test helpers and tests nothing); the `.github/` carve-out, the PR template, agent tooling, the check's own files under F1; the catch-all with an edited, a new and a moved document, a deleted unowned path, and a new script; the skip locally and in CI; the success line and `-v`; `--integrity-only`.
- `test/bumps.test.ts`: a pure bump, a bump with another change, a changed action name, a moved `uses:` line, and a filter that throws (in-process, with `isVersionBump` replaced); in `package.json`, a dependency bump, a bump in a reformatted nested `package.json`, a change to `engines`, to `packageManager` and to the type of a value, a bump with an `engines` change, an added and a removed dependency, a change of source (`npm:`, `github:`, `file:`, `workspace:`, `user/repo`), a dependency moved to another field, and invalid JSON.
- `test/integrity.test.ts`: missing file, missing heading, wrong case, outside the repository, code ignored, a `docs/` code span, a comment reference, line numbers in links, text and comments, section citations (unknown word, missing heading, alias), stale index, unlisted decision file, map rows (different, missing, extra, twice, not code spans, unescaped `|`), exclusion rows (different, twice), invariants (reused number, ordered list, no test, missing test, struck through). Vitest ids: one that passes (nested `describe`, `test` with a multi-line call, a literal with escapes, without `describe`), a missing `it`, a missing `describe`, names out of order, a template literal, `it.each` and a concatenation, and a wrong nesting that passes. `integrity` on this repository.
- `test/paths.test.ts`: a file name with the byte 0xff is printed with its own bytes in the `-v` list and under F0. It is skipped where the file system refuses such a name, as APFS on macOS does, so it runs only on Linux, in CI.
- `test/decisions-index.test.ts`: slugs (punctuation, code spans, links, non-ASCII, duplicates), headings in front matter and fenced code, setext headings, HTML ids, the rendered table, `check` for a fresh index, a stale one, an unlisted file and a missing domain file, a missing `Status:` line, and the exit codes of `main`.
- `test/slugs.test.ts` compares `slugify` with `test/github-slugs.json`: the 150 headings of the repository's Markdown files when the check was ported, and 42 more with non-ASCII text, emoji, combining marks and punctuation, each with the anchor the Python version computed.
- `src/text.test.ts`, `src/json.test.ts`, `src/cli.test.ts` and `src/check-docs.test.ts` test the helpers of [text semantics](#text-semantics), the JSON reader, the command-line options, the compiled `RULES` and `EXCLUDE`, `jsUnescape`, `parseTestId` and `missingTest` directly.

Not covered: a `package.json` added or deleted on the branch (no merge-base side, so never a bump), a bump in a file whose path is not UTF-8, the messages `points outside the repository` for code-span and comment references, `cites a missing file`, the missing-table and missing-file messages of `checkMap` and `checkInvariants`, and `git ... failed`; setext headings next to list items and other CommonMark edge cases, links split across lines, comment markers inside string literals (they can produce a false failure), and the CI workflow itself, which runs only on GitHub.

## See also

- [Ownership map](README.md#ownership-map)
- [Documentation guide](../guides/documentation.md), including its [known limits](../guides/documentation.md#known-limits)
- [Decisions about the contract](../decisions/docs.md)
- [Invariants](../invariants.md)

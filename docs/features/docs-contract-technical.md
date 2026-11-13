# Documentation contract: technical

For whoever changes `scripts/check-docs.py` or `scripts/decisions-index.py`. What the user sees is in [docs-contract-user.md](docs-contract-user.md); how to write documents is in the [documentation guide](../guides/documentation.md).

## Data flow

`scripts/check-docs.py`, `main(argv, root)`:

1. If `SKIP_DOCS_CHECK` is `1` and `CI` is empty, print the skip message and return 0. If `CI` is set, print that the variable is ignored and go on.
2. `git rev-parse --show-toplevel` gives the root (tests pass `root` directly). With `--integrity-only`, `integrity_only(root)` runs step 8 alone and returns; no base is resolved.
3. `find_base(root, base)` resolves `--base REF`, or else the first of `origin/main` and `main` that exists, and returns the ref name and `git merge-base HEAD <ref>`. It never tries another branch. It raises `GitError` when nothing resolves; `main` prints the message and returns 2.
4. `changed_files(root, mb)` is the union of `git diff --name-only -z --no-renames <mb> HEAD` (commits), `git diff --name-only -z --no-renames HEAD` (unstaged), `git diff --name-only -z --no-renames --cached` (staged) and `git ls-files -z --others --exclude-standard` (untracked). With `--no-renames`, a move is a deletion plus an addition, so both paths count.
5. `new_files(root, mb)` is `git diff --name-only -z --find-renames --diff-filter=A <mb>` (merge base against the working tree, so committed and staged additions count) plus the untracked files. Git pairs a deleted file with an added one when their content is at least 50% similar, so a file moved with `git mv`, or a new file copied from a deleted one, is a rename there, not an addition.
6. Each changed path goes through `excluded(path)` (the `EXCLUDE` list) and then `is_version_bump(root, mb, path)`. What is left is the source side. An exception from the filter adds a `[filter]` failure and keeps the path on the source side.
7. `evaluate(sources, changed, new)` checks each rule in `RULES`. A regular rule is broken when some source path matches `Rule.source` (with `re.search`) and no changed path matches `Rule.docs`. The catch-all rule (`catch_all=True`, F0) takes only source paths that no regular rule matches and that still exist in the working tree (`main` passes the deleted ones in `deleted`), and looks for its documents in `new` instead of `changed`.
8. `integrity(root)` runs on every file from `git ls-files --cached --others --exclude-standard` that exists and is not a symlink (so `CLAUDE.md` is not read twice). The checks are listed under [Integrity checks](#integrity-checks).
9. Failures are printed with the footer and the exit code is 1; otherwise the success line and 0.

`index_module()` loads `scripts/decisions-index.py` from the directory of `check-docs.py` with `importlib`, because a file name with a dash cannot be imported. It provides `scan`, `headings`, `anchors` and `check`.

`scripts/decisions-index.py`, `main(argv, root)`: `render(root, DOMAINS)` reads `docs/decisions/<stem>.md` for each stem in `DOMAINS`, runs `parse_decisions` on it and builds the index text. Without `--check` it writes `docs/decisions/README.md`, unless a decision file is malformed. With `--check`, `check(root, DOMAINS)` compares the file with the rendered text and lists files missing from `DOMAINS` and `DOMAINS` entries without a file.

Markdown parsing, shared by both scripts:

- `scan(text)` labels each line `front` (YAML front matter: the file starts with `---` and a later line is `---` or `...`), `code` (inside a fence of three or more backticks or tildes, fence lines included) or `text`.
- `headings(text)` finds ATX headings (`# ...` to `###### ...`, optional closing `#`s) and setext headings (a paragraph line followed by `===` or `---`) in `text` lines. A line starting with a list marker, `>`, `|` or `#` is not a setext title.
- `slugify(text)` computes GitHub's anchor: inline Markdown reduced to its text (`plain_heading_text`: links and images become their text, HTML tags and `*`, `~` and emphasis `_` go, code spans keep their content literally, with one space taken off each end when both ends have one, as CommonMark does), lowercased, every character removed except letters, digits, combining marks, `-`, `_` and space, then each space replaced by `-`. `headings` appends `-1`, `-2` to repeated slugs, as GitHub does.
- `anchors(text)` is the set of heading slugs plus `id="..."` and `name="..."` values of HTML tags.

### Integrity checks

| Function | What fails |
| --- | --- |
| `check_links` | In `.md` files, outside fenced code and with code spans removed: an inline link, image or reference definition whose relative target does not exist (compared case-sensitively, so a link that only works on macOS fails), leaves the repository, uses a `#L<n>` fragment, or names a heading the target `.md` file does not have. A code span that is exactly a lowercase `docs/<path>.md` path, with or without an anchor, is checked the same way. Any `<file>.md:<n>` or `<file>.md#L<n>` in the text fails. Links with a scheme (`https:`, `mailto:`) or starting with `//` are skipped. A leading `/` means the repository root. |
| `check_code_refs` | In comments of other files: a `docs/<path>.md` or `docs/<path>.md#anchor` reference to a missing file or heading, and any `.md:<n>` or `.md#L<n>`. The comment marker comes from the extension (`HASH_COMMENT`, `SLASH_COMMENT`, `DASH_COMMENT`, `HTML_COMMENT`); a line is a comment from its first marker on. Files with another extension are not read. |
| `check_section_citations` | In Markdown text and in comments: `<file>.md §<n>` whose file has no heading starting with `<n>` (optionally `§<n>`), and `<word> §<n>` where `<word>` is not in `SECTION_ALIASES`. |
| `index_module().check` | The decisions index is stale, a decision file is not in `DOMAINS`, a `DOMAINS` entry has no file, or a decision has no valid `Status:` line. |
| `check_map` | The ownership-map table or the exclusions table in `docs/features/README.md` is missing, or differs from `RULES` or `EXCLUDE` (a missing, extra, duplicated or different row), or a `docs/<path>.md` path named in a rule message does not exist. |
| `check_invariants` | See [docs/invariants.md](#docsinvariantsmd). |

### Version-bump filter

`is_version_bump(root, mb, path)` first looks for a `JSON_BUMP_FILTERS` entry whose path regex matches, then for a `BUMP_FILTERS` entry. A path that matches neither is never a bump.

**Line filters.** `BUMP_FILTERS` pairs a path regex with a line regex. For a changed path that matches a path regex, `is_version_bump` reads `git diff -U0 --no-renames --no-color --no-ext-diff <mb> -- <path>` (merge base against the working tree). The path is a pure bump only if there is at least one hunk, every hunk removes as many lines as it adds, and each removed line and the added line at the same position in the hunk both match the line regex in full, differ, and are equal once the groups `v` (the version) and `c` (a trailing comment) are cut out. Pairing by position means a `uses:` line moved to another job is not a bump: its removal and its addition land in different hunks. An untracked file has no diff against the merge base and is never a bump.

| Path regex | Line regex matches |
| --- | --- |
| `^\.github/workflows/[^/]+\.ya?ml$` | `uses: <owner>/<action>@<version>`, optionally after `- `, optionally quoted, optionally followed by `# <comment>` |

**JSON filters.** `JSON_BUMP_FILTERS` pairs a path regex with the names of top-level fields whose values may change. `is_json_version_bump` reads the file at the merge base (`git show <mb>:<path>`) and in the working tree, and parses both with `json.loads`. The path is a pure bump only if:

- the file exists on both sides as a regular file, and both sides are UTF-8 JSON objects without a repeated key in any object;
- every top-level field outside the list is equal on both sides (compared as `json.dumps(..., sort_keys=True)`, so `true` and `1` differ and key order does not matter);
- each listed field is present on both sides or on neither; where present, it is an object on both sides with the same keys;
- every value that differs is a version range on both sides (`_is_version_range`: a string without `:` and without `/`, such as `^19.1.0`, `>=1 <2`, `latest` or `*`); a value that names a package source (`npm:preact@^10`, `file:../x`, `workspace:*`, `github:user/repo`, `git+https://...`, `user/repo`) is not a version, on either side;
- at least one value differs.

An unchanged value is not checked, so a `workspace:*` dependency next to a bumped one does not stop the bump.

A dependency that is added, removed or moved to another field is not a bump, and neither is a change that only reformats the file. A file that does not parse is not a bump either: it stays on the source side, and the check does not fail with `[filter]`. Formatting, indentation and key order are ignored, so a bump that also reformats the file still passes.

| Path regex | Fields whose version ranges may change |
| --- | --- |
| `(^\|/)package\.json$` | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` |

`engines`, `packageManager`, `scripts`, `workspaces` and every other field are compared in full, so a change to them needs the document that states them. Lock files are left out by `EXCLUDE`, not by this filter.

No other file pins versions yet. When one does (a hook configuration), add a pair. A pin that the documentation states, such as a toolchain version, must not match a line regex or be in a JSON field list, so a change to it still needs the document. [Why `package.json` is parsed](../decisions/docs.md#packagejson-bumps-are-compared-as-parsed-json).

## Schema

**`Rule`** (dataclass in `scripts/check-docs.py`):

| Field | Meaning |
| --- | --- |
| `id` | `F<n>` for a feature, `C<n>` for something cross-cutting (CI, build file, scripts). Shown as `[<id>]`. |
| `source` | Regex searched in each source-side path. |
| `docs` | Regex searched in each changed path (in each new path for the catch-all). |
| `message` | Printed after `✗`; names the document to update. Every `docs/<path>.md` path in it must exist. |
| `catch_all` | `True` only for F0. |

**`EXCLUDE`**: list of `(regex, why)`. **`BUMP_FILTERS`**: list of `(path regex, line regex)`. **`JSON_BUMP_FILTERS`**: list of `(path regex, tuple of top-level field names)`. **`SECTION_ALIASES`**: word to document path, empty.

**Ownership-map table** in `docs/features/README.md`: the first table whose header cells are `#`, `source path regex`, `doc path regex`, `message` (case-insensitive). One row per rule, in any order. The regex cells are code spans. In every cell `\|` stands for `|`. The message cell is plain text and must equal `Rule.message` character for character.

**Exclusions table** in the same file: header `path regex`, `why`. The regex cell is a code span; the reason equals the second element of the `EXCLUDE` entry.

### docs/invariants.md

Every list item outside fenced code is checked:

- A top-level item is `- **<N>.** <rule>`. Any other top-level list item (an ordered `1.`, a bullet without a number) fails. A number appears once.
- A nested item is a test id: `  - ` followed by a code span (`TEST_ID_RE`) holding `<path>::<name>`, with one or more names. `parse_test_id` splits it at `::`. The path must not be empty and must not contain `:`. The file must exist.
- **Python** (`.py`): every name is an identifier (`PY_NAME_RE`), as in `tests/test_check_docs.py::RuleTests::test_deletion_needs_doc`. `missing_test` parses the file with `ast` (`_parse_python` caches the tree per file content, because one test file is named many times) and walks the names: every name before the last must be a top-level class, or a class directly in the previous one, and the last a function directly in the class (or a top-level function when there is no class).
- **Every other file** (Vitest): a name is any text without a backtick and without `::` that neither starts nor ends with `:`, as in `packages/core/src/yuyv.test.ts::decodeYUYV::reads lo and hi bytes`. `missing_js_test` lists the calls `describe(...)`, `it(...)` and `test(...)` whose whole first argument is one string literal in `"` or `'` (`JS_CALL_RE`; `_js_calls` caches the list per file content). Every name before the last must equal a `describe` literal and the last an `it` or `test` literal, and they must appear in the file in that order, each after the previous one. The literal's value is compared exactly with the name, after `_js_unescape` resolves its escapes as JavaScript does (`\"`, `\'`, `\\`, `\n`, `\t` and the other one-letter escapes, `\xHH`, `\uHHHH`, `\u{H...}`; any other escaped character stands for itself), so the name is the one Vitest shows: `it("say \"hi\"")` is `<path>::say "hi"`. A template literal, a concatenation, `it.each`, and calls with a modifier such as `it.only` or `describe.skip` are not found.
- **Known limitation of the Vitest search:** the script uses the standard library only, so it has no TypeScript parser, and it does not verify the real nesting. `describe("A", ...)` followed by a separate `describe("B", () => { it("x") })` lets `<path>::A::x` pass, although `x` is in `B` (`VitestIdTests::test_vitest_id_with_wrong_nesting_passes`). Calls inside comments and strings count too. Review checks that a Vitest test id names the test that enforces the rule. [Why there is no parser](../decisions/docs.md#vitest-test-ids-are-checked-by-text-search).
- An invariant whose text starts with `~~` is retired and may have no test ids. Every other invariant needs at least one.

**Decision file** `docs/decisions/<stem>.md`: each `##` heading (ATX or setext) is one decision. The first non-blank line after it must match `^Status: (decided|postponed|superseded)( \(#N(, #N)*\))?$`. Other heading levels are ignored.

**Decisions index** `docs/decisions/README.md`: a `# Decisions index` title, a paragraph that starts `Generated by` and says not to edit by hand, then per `DOMAINS` entry a `## <title>` and a table `Decision | File | Status`. The decision cell links `<stem>.md#<slug>`; the status cell is the status with its references in parentheses. A domain without decisions gets `No decisions yet.`

## Interfaces

`scripts/check-docs.py [--base REF] [-v] [--integrity-only]`:

| Option | Default | Effect |
| --- | --- | --- |
| `--base REF` | `origin/main`, else `main` | Base branch for the merge base. A missing ref exits 2. |
| `-v`, `--verbose` | off | Print each changed file before the result, with `(left out: <why>)` or `(left out: version bump only)` for the ones not on the source side. |
| `--integrity-only` | off | Run only the integrity checks. No base is needed, and `--base` and `-v` have no effect. |

`scripts/decisions-index.py [--check]`: without the flag it writes the index; with it, it only reports.

Functions other code uses: `check_docs.main(argv=None, root=None) -> int` and `check_docs.integrity(root) -> list[str]` (the tests); `decisions_index.scan`, `headings`, `anchors`, `slugify`, `check(root, domains=DOMAINS) -> list[str]` and `render(root, domains=DOMAINS) -> (str, list[str])` (`check-docs.py` and the tests).

The make targets that call these scripts are listed in the [development guide](../guides/development.md#build-targets); the CI job in [CI](../guides/development.md#ci).

## Configuration

| Name | Default | Read by | Effect |
| --- | --- | --- | --- |
| `SKIP_DOCS_CHECK` | unset | `check-docs.py`, `main` | `1` skips the check and exits 0, unless `CI` is set. Any other value is ignored. |
| `CI` | unset (GitHub Actions sets `true`) | `check-docs.py`, `main` | Any non-empty value makes `SKIP_DOCS_CHECK` ignored. |
| `DOMAINS` | `{"docs": "Documentation contract", "architecture": "Architecture"}` | `decisions-index.py` | Decision file stems and their index titles, in index order. |

The scripts run git with `-z`, `--no-color` and `--no-ext-diff`, so `core.quotepath`, `color.ui` and external diff drivers do not change their input.

## Failure modes

`check-docs.py`, exit code 2 (printed after `docs-check: `):

| Message | Cause |
| --- | --- |
| `no base branch: neither origin/main nor main exists; pass --base REF` | No `--base`, and neither ref resolves to a commit. |
| `base ref '<ref>' does not exist` | `--base` names a ref that does not resolve. |
| `HEAD and <ref> have no merge base` | Unrelated histories, or a shallow clone (CI uses `fetch-depth: 0` for this reason). |
| `git <args> failed: <git's error>` | Not a git repository, no commit yet, or another git error. |

`check-docs.py --integrity-only` prints `docs-check: integrity checks pass on <N> files` and exits 0, or `docs-check: integrity checks failed:`, the `[integrity]` lines below and the footer, and exits 1.

`check-docs.py`, exit code 1. Every failure is one line starting with `✗`, followed by the footer `What to update: the "You changed / You must also update" table in AGENTS.md (section "Documentation contract").` and `How to write it: docs/guides/documentation.md.`

| Message | Cause |
| --- | --- |
| `✗ <rule message> [<id>]`, then the triggering paths indented by four spaces | A rule is broken. |
| `✗ version-bump filter failed on <path> (<exception type>: <text>); the check fails instead of guessing [filter]` | `is_version_bump` raised. |
| `✗ <file>:<line>: link '<target>' points to a missing file: <path> [integrity]` | Broken relative link. The same wording with `` `<span>` `` or `reference '<ref>'` instead of `link '<target>'` for a code span or a code comment. |
| `✗ <file>:<line>: link '<target>' points to a missing heading: <file>#<anchor> [integrity]` | The anchor is not a heading slug or HTML id of the target. |
| `✗ <file>:<line>: link '<target>' points outside the repository [integrity]` | The target starts with `../` after normalisation. |
| `✗ <file>:<line>: link '<target>' uses a line number (#L<n>); link the heading anchor or name the symbol [integrity]` | A `#L<n>` fragment. |
| `✗ <file>:<line>: '<text>' refers to a line number; use the heading anchor [integrity]` | `<file>.md:<n>` or `<file>.md#L<n>` in text or a comment. |
| `✗ <file>:<line>: '<cite>' cites an unknown document; cite the file path or add '<word>' to SECTION_ALIASES in scripts/check-docs.py [integrity]` | `<word> §<n>` with an unknown word. |
| `✗ <file>:<line>: '<cite>' cites a missing file: <path> [integrity]` | `<file>.md §<n>` for a file that does not exist. |
| `✗ <file>:<line>: '<cite>': <path> has no heading for section <n> [integrity]` | The cited file has no heading starting with the number. |
| `✗ <message> (scripts/decisions-index.py --check) [integrity]` | One of the `decisions-index.py` messages below. |
| `✗ docs/features/README.md:<line>: rule <id>: <field> differs from RULES (RULES: '<value>', table: '<value>') [integrity]` | A table row differs; `<field>` is `source regex`, `doc regex` or `message`. |
| `✗ docs/features/README.md: rule <id> from RULES is missing from the ownership-map table [integrity]` | A rule has no row. |
| `✗ docs/features/README.md:<line>: rule <id> is not in RULES in scripts/check-docs.py [integrity]` | A row has no rule. |
| `✗ docs/features/README.md:<line>: rule <id> appears twice [integrity]` | Two rows with one id. |
| `✗ docs/features/README.md:<line>: rule <id>: write both regexes as code spans [integrity]` | A regex cell is not a code span. |
| `✗ docs/features/README.md:<line>: ownership-map row needs 4 cells, has <n> [integrity]` | Usually an unescaped `\|` in a regex. |
| `✗ docs/features/README.md: no ownership-map table with columns: # \| source path regex \| doc path regex \| message [integrity]` | The table or its header is gone. The same with `no exclusions table with columns: path regex \| why`. |
| `✗ docs/features/README.md: exclusion '<regex>' from EXCLUDE is missing from the exclusions table [integrity]` | Also `... is not in EXCLUDE in scripts/check-docs.py`, `... reason differs from EXCLUDE (...)`, `... appears twice` and `exclusion row needs 2 cells, the regex as a code span`. |
| `✗ docs/features/README.md is missing; it must hold the ownership map [integrity]` | The file is gone. |
| `✗ scripts/check-docs.py: rule <id>: its message names a missing file: <path> [integrity]` | A rule message names a document that does not exist. |
| `✗ docs/invariants.md:<line>: list item is not of the form '- **<N>.** <rule>': <item> [integrity]` | A top-level list item in another form. |
| `✗ docs/invariants.md:<line>: invariant <N> is already used on line <line> [integrity]` | A reused number. |
| `` ✗ docs/invariants.md:<line>: nested item is not a test id under an invariant ('  - `path::test_name`'): <item> [integrity] `` | A nested item that is not a test id, or one before the first invariant. |
| `✗ docs/invariants.md:<line>: invariant <N> names no test; a rule no test enforces belongs in the technical document as a note [integrity]` | A live invariant without test ids. |
| `✗ docs/invariants.md:<line>: invariant <N>: test file <path> does not exist [integrity]` | Also, for Python, `invariant <N>: <id>: no def <name> in <path>::<Class>` (or `no class <Class> in <path>`) and `invariant <N>: <id>: <path> does not parse (<error>, line <n>)`. For other files, `invariant <N>: <id>: no describe("<name>") in <path>`, `... no it("<name>") or test("<name>") in <path>`, and `... <call>("<name>") does not come after <call>("<previous name>") in <path>` when the name exists only before the previous one. The names are printed as JSON strings, so a `"` or `\` in a name is escaped. |
| `✗ docs/invariants.md is missing [integrity]` | The file is gone. |

`decisions-index.py` (printed after `decisions-index: `):

| Message | Exit | Cause |
| --- | --- | --- |
| `wrote docs/decisions/README.md (<N> decisions)` | 0 | Written. |
| `docs/decisions/README.md is up to date` | 0 | `--check`, nothing to do. |
| `` docs/decisions/README.md is stale: run `make decisions-index` `` | 1 | `--check`: the file differs from the rendered text. |
| `docs/decisions/<stem>.md is not listed in DOMAINS in scripts/decisions-index.py` | 1 | `--check`: a decision file without a `DOMAINS` entry. |
| `DOMAINS in scripts/decisions-index.py lists '<stem>', but docs/decisions/<stem>.md does not exist` | 1 | `--check`: an entry without a file. |
| `docs/decisions/<stem>.md:<line>: decision '<heading>' needs 'Status: decided\|postponed\|superseded (#N)' as the first line under the heading, found: <line or None>` | 1 | A decision without a valid status. Nothing is written. |

## Tests

- `tests/test_check_docs.py` copies the working tree into a temporary repository and runs the copied script there. It covers: an owned path with and without its document; tests-only changes and a sample path for every `EXCLUDE` pattern; untracked, staged and unstaged sources and documents; deletion and rename; no base, no merge base, a missing `--base` ref, `--base`, and `origin/main` before `main`; a pure bump, a bump with another change, a changed action name, a moved `uses:` line, and a filter that raises (in-process, with `is_version_bump` patched); in `package.json` (`PackageJsonBumpTests`), a dependency bump, a bump in a reformatted nested `package.json`, a change to `engines`, to `packageManager` and to the type of a value, a bump with an `engines` change, an added and a removed dependency, a change of source (`npm:`, `github:`, `file:`, `workspace:`, `user/repo`), a dependency moved to another field, and invalid JSON; a package source path that looks like a test directory but is not excluded (it falls under F2); the rules for the TypeScript code (`TypeScriptRuleTests`): a core path needs the core documents and not the cameras ones, a cameras path the cameras documents and not the core ones, `apps/web/` and `netlify.toml` the web app documents, each root configuration file of C3 a guide, and core's test helpers and tests nothing; the `.github/` carve-out, the PR template, agent tooling, both check scripts; the catch-all with an edited, a new and a moved document, a deleted unowned path, and a new script; the skip locally and in CI; `--integrity-only`; the success line and `-v`. Integrity: missing file, missing heading, wrong case, outside the repository, code ignored, a `docs/` code span, a comment reference, line numbers in links, text and comments, section citations (unknown word, missing heading, alias), stale index, unlisted decision file, map rows (different, missing, extra, twice, not code spans, unescaped `|`), exclusion rows (different, twice), invariants (reused number, ordered list, no test, missing test, test under the wrong class, a Python id with a name that is not an identifier, struck through). `VitestIdTests`: a Vitest id that passes (nested `describe`, `test` with a multi-line call, a literal with escapes, without `describe`), a missing `it`, a missing `describe`, names out of order, a template literal, `it.each` and a concatenation, and a wrong nesting that passes. `RealRepositoryTests` runs `integrity` on this repository.
- `tests/test_decisions_index.py` covers slugs (punctuation, code spans, links, non-ASCII, duplicates), headings in front matter and fenced code, setext headings, HTML ids, the rendered table, `check` for a fresh index, a stale one, an unlisted file and a missing domain file, a missing `Status:` line, and the exit codes of `main`.

Not covered: a `package.json` added or deleted on the branch (no merge-base side, so never a bump), the messages `points outside the repository` for code-span and comment references, `cites a missing file`, the missing-table and missing-file messages of `check_map` and `check_invariants`, a test file that does not parse, and `git ... failed`; setext headings next to list items and other CommonMark edge cases, links split across lines, comment markers inside string literals (they can produce a false failure), and the CI workflow itself, which runs only on GitHub.

## See also

- [Ownership map](README.md#ownership-map)
- [Documentation guide](../guides/documentation.md), including its [known limits](../guides/documentation.md#known-limits)
- [Decisions about the contract](../decisions/docs.md)
- [Invariants](../invariants.md)

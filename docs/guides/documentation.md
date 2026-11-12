# Documentation guide

For anyone, person or agent, who writes or changes documentation in this repository: which kinds of document exist, how to write each one, how the documentation check works, and what it cannot catch. Where each document lives is in [docs/README.md](../README.md).

Documentation is written by hand. `scripts/check-docs.py` does not generate any of it (the decisions index is the one exception); it only makes sure nobody forgets it. Every change that alters behaviour updates the document that owns the behaviour in the same commit or pull request, and a change that removes behaviour removes its documentation.

## Feature documents

Two per feature, in `docs/features/`, and one row per feature in the table in [docs/features/README.md](../features/README.md#features).

**`<feature>-user.md`**: what a user can do and what they see. No implementation detail: a reader who never opens the code can use the feature from this document alone.

1. A title.
2. One paragraph on what the feature is for, in the user's terms.
3. `## <Task the user does>`, one per task: steps, commands, options with their defaults.
4. `## <States or outcomes>`: what the user sees in each case, with messages quoted verbatim in code spans.
5. `## See also`.

**`<feature>-technical.md`**: how the feature works, for whoever changes it. These sections in this order, leaving out any that do not apply:

1. **Data flow**: the real module, class and function names, in the order the data passes through them.
2. **Schema**: formats, field by field.
3. **Interfaces**: CLI, public functions, arguments, defaults.
4. **Configuration**: every environment variable and option, its default, and what reads it.
5. **Failure modes**: every error message and exit code, verbatim, with its cause.
6. **Tests**: which test files cover what, and what is not covered.
7. **See also**.

[docs-contract-user.md](../features/docs-contract-user.md) and [docs-contract-technical.md](../features/docs-contract-technical.md) follow these templates.

## Specifications

A wire or file format that other programs read gets its own document at the top level of `docs/`, with a version number near the top (`Version: 1`). A change to the format bumps the version, and the document says what changed between versions. There is none yet; the formats only the documentation check reads are described in its [technical document](../features/docs-contract-technical.md#schema).

## Guides

In `docs/guides/`: development, testing, this guide, and any how-to for users. A guide has a title and an opening paragraph that says who it is for; nothing else is fixed.

## Invariants

[docs/invariants.md](../invariants.md) lists numbered domain rules, each enforced by a test it names:

```md
- **7.** A deleted owned file needs its documentation.
  - `tests/test_check_docs.py::RuleTests::test_deletion_needs_doc`
```

- Use bold `**<N>.**`, not an ordered list: GitHub renumbers ordered lists, and other documents cite invariants by number.
- Take the next free number. Never reuse one, even after the rule is gone.
- A rule that stops holding is struck through, with the reason, so old references keep their meaning: `- **7.** ~~<rule>~~ Retired in #12: <why>.`
- A rule that no test enforces is not an invariant. Write it as a note in the technical document.

The check fails on a reused number, on a list item in any other form, on a live invariant without a test, and on a test id that does not name an existing test (for Python, the method has to be in the named class). Two pull requests that take the same next number each pass alone. Each CI run checks the merge with the base as it is when the run starts, so the second one fails on its next run after the first is merged. If it is merged without another run, the `integrity` job fails on `main` right after the merge ([CI](development.md#ci)).

## Decisions

`docs/decisions/<domain>.md` records why things are the way they are: rejected alternatives and postponed scope. Read [the index](../decisions/README.md) before deciding anything; the question may already be settled.

```md
## The check runs in CI, not as a git hook

Status: decided (#2)

One or two paragraphs of reasoning.

**Rejected:** a pre-commit hook, because it would block a code-only commit.
```

- One `##` heading per decision. The heading states what was decided, not the question.
- The first line after the heading is `Status: decided`, `Status: postponed` or `Status: superseded`, followed by ` (#<PR or issue>)` once there is a number.
- A superseded decision links its replacement by heading anchor (`[replacement](docs.md#the-new-heading)`), never by line number.
- A new domain file needs an entry in `DOMAINS` in `scripts/decisions-index.py`.
- After any change in `docs/decisions/`, run `make decisions-index`. The index is generated; do not edit it.

## The ownership map

The map in [docs/features/README.md](../features/README.md#ownership-map) says which document has to change when a path changes. `RULES` in `scripts/check-docs.py` is its source of truth, the table in `docs/features/README.md` must equal it (the check compares them), and [AGENTS.md](../../AGENTS.md#documentation-contract) restates it for agents (nothing compares that one; rule F1 makes a change to the script touch a document, and review checks the rest).

When you add code:

- **Code that belongs to an existing feature**: widen that feature's rule so it matches the new path.
- **A new feature**: write both feature documents, add a row to the feature table, and add an `F<n>` rule whose documentation regex matches the two documents.
- **Something cross-cutting** (CI, build file, hooks, scripts, dependency manifests): add a `C<n>` rule pointing at the guide that describes it.

How to write a rule:

- **Carve-outs, not lists of files.** Where a directory has a sub-part with another owner, match the whole directory minus the exception, as C2 does for `.github/`. A new file is then owned from its first line.
- **List files by name** only where a directory has several owners, as F1 does for `scripts/`. A new file there matches no rule but the catch-all F0.
- **The catch-all F0** owns every path no other rule matches and asks for a new feature document. Its message tells you to add the documents and the path to the map.
- **A file with several owners** gets one rule whose documentation regex accepts the document of any owner, as C1 does for the `Makefile`.
- **Left out on purpose** are tests, test data, lock files, the licence, `.gitignore`, and files that are documentation or rules themselves. They are in `EXCLUDE`, and in the [table](../features/README.md#left-out-on-purpose) that must equal it.
- Every rule message names the exact document to update, such as `CI or GitHub configuration changed: update docs/guides/development.md`. The check fails if a document named in a message does not exist.

Edit `RULES`, the table in `docs/features/README.md` and the table in `AGENTS.md` in the same change.

## How the check works

`make docs-check` takes the merge base of `HEAD` and the base branch (`origin/main`, else `main`, or `BASE=<ref>`). It collects every path changed since then: commits, staged and unstaged changes, untracked files. It drops the paths in `EXCLUDE` and the files whose diff only changes a version, then fails every rule whose source regex matches a remaining path while no changed path matches its documentation regex. Then it checks the whole tree: links and anchors, `docs/` references in code comments, line-number references, section citations, the decisions index, the map tables and the invariants. Every step, every message and every exit code is in the [technical document](../features/docs-contract-technical.md).

CI runs it on every pull request, and the integrity part alone (`--integrity-only`) on every push to `main` (see [CI](development.md#ci)). `SKIP_DOCS_CHECK=1` skips it locally while work is in progress and is ignored in CI.

The version-bump filter drops a file only when every changed line matches its pattern and the lines differ in nothing but the version. Today that is `uses: <action>@<version>` in workflows. When a pin is something the documentation states, such as a toolchain version or an upstream revision the docs cite, keep it out of the pattern so that bumping it still needs the document.

## Style

- Write what is true now. No roadmap: plans belong in issues or a plan document.
- Use real paths, real names, real defaults. Quote messages and command output verbatim.
- Refer to code by path and symbol, never by line number, because lines move. The check fails on `<file>.md:<n>` and `#L<n>`.
- Write `TODO(<owner>): <what is unknown>` instead of guessing.
- Every fact lives in one document. Link to it; do not restate it. The root README, once there is one, is an entry point that links into `docs/`.
- Use plain, precise language, and measured claims with their numbers. Do not use filler words such as "comprehensive", "robust" or "seamless".
- Link headings by their GitHub anchor: lowercase, punctuation removed, spaces turned into `-`.

## Known limits

What the check cannot catch:

- **It proves coverage, not correctness.** It knows that a document changed, not that the document is now true. A blank line satisfies a rule. Review has to check that what the document says is true of the code.
- **New files in a by-name part of the map go to the catch-all.** A new file in `scripts/` matches no rule of its real owner. F0 then asks for new feature documents, which is wrong for a helper script, until someone adds the path to a rule.
- **The catch-all cannot tell what a new document describes.** Any new feature document satisfies F0, even one about another feature.
- **Adding the path to the map is not enforced.** F0 asks for it, but a pull request that adds the new documents and no rule passes. The next change to that path hits F0 again and asks for new documents again.
- **"New" means "not a rename" to git.** A feature document that git pairs with a deleted one (at least 50% similar content, as after `git mv`, or after copying the old document as a starting point) does not count as new for F0, however it was made.
- **Deleting a path no rule owns needs nothing.** F0 skips deleted paths, so removing unowned code passes without any document change.
- **A change reverted in the working tree still counts.** The changed set is a union, so a file changed in a commit and then restored to the base in the working tree still needs its document. Commit the revert, or ignore the failure until it is committed.
- **Docstrings are not read.** References to `docs/` are checked in comments only, so a path in a Python docstring can go stale unnoticed.
- **A file with several owners passes with any owner's document.** Changing the test target in the `Makefile` and updating only the development guide passes C1.
- **Agent tooling restates normative files and can go stale silently.** The table in `AGENTS.md` and the `create-pr` skill restate the map and these rules; nothing compares them with `RULES` except the paths in code spans, which must exist.
- **Comment detection is per line and by file extension.** A `#` inside a Python string starts a "comment", which can cause a false failure; a file with an unknown extension is not read at all.

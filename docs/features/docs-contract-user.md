# Documentation contract

Every change that alters behaviour in this repository lands with the documentation that owns it, in the same commit or pull request. `make docs-check` tells you which documents your branch still has to update, and CI runs the same check on every pull request. It does not write documentation; you do.

## Check your branch

Run from the repository root:

```sh
make docs-check                       # compare with origin/main, else main
make docs-check BASE=origin/release   # compare with another base branch
make docs-check ARGS=-v               # also list the changed files
```

Without make: `python3 scripts/check-docs.py [--base REF] [-v]`. Nothing has to be installed beyond git and Python 3.

The check compares your branch with its merge base on the base branch. It counts every file changed in the commits since then, staged and unstaged changes, and new files that git does not ignore, so you can run it before you commit. Moving or deleting a file counts as a change to it.

For each changed file, the [ownership map](README.md#ownership-map) names the document that must change with it. These need no documentation: files under `tests/`, documentation itself, agent instructions and tooling, and the other paths in [Left out on purpose](README.md#left-out-on-purpose). A change to a workflow that only bumps an Action version needs none either, and neither does a `package.json` change that only changes versions in `dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies`. A change to `engines`, `packageManager` or any other field of `package.json`, an added or removed dependency, or a dependency switched to another source (`npm:` alias, `file:`, `workspace:`, a git repository), does.

A file that no rule owns (for example the first file of a new feature) needs feature documents that are new on your branch: `docs/features/<feature>-user.md`, `docs/features/<feature>-technical.md`, or both. Editing an existing document does not count, and neither does a document that git sees as a move of a deleted one, for example a copy of an old document under a new name. Then add the path to the ownership map, so the next change to it needs the right document. Deleting a file that no rule owns needs no document.

## Skip the check while work is in progress

```sh
SKIP_DOCS_CHECK=1 make docs-check
```

This works only on your machine. In CI the variable is ignored and the check runs.

## Check only the documentation's integrity

```sh
make docs-check ARGS=--integrity-only
```

Runs only the whole-tree checks (links, anchors, decisions index, ownership-map tables, invariants) and needs no base branch. It prints `docs-check: integrity checks pass on <N> files`, or `docs-check: integrity checks failed:` followed by the failures. CI runs it on every push to `main`.

## Regenerate the decisions index

After you add or change a decision in `docs/decisions/`, run `make decisions-index`. It rewrites [docs/decisions/README.md](../decisions/README.md) and prints `decisions-index: wrote docs/decisions/README.md (<N> decisions)`. The check fails while the index is stale.

## Results

Untracked files count too. If your editor leaves files in the repository (`.vscode/`, `.idea/`), list them in `.git/info/exclude` or they fail rule F0.

**Everything documented.** Exit code 0:

```
docs-check: 3 changed files since origin/main (1a2b3c4), each with the documentation it needs
```

**A document is missing.** Exit code 1. Each broken rule prints its message and rule id, the files that triggered it, then where to look:

```
docs-check: failed against origin/main (1a2b3c4):
✗ Build targets changed: update docs/guides/development.md (or docs/guides/testing.md for the test target) [C1]
    Makefile

What to update: the "You changed / You must also update" table in AGENTS.md (section "Documentation contract").
How to write it: docs/guides/documentation.md.
```

Update the named document so it says what is now true, then run the check again.

**The documentation is broken.** Exit code 1. The check also looks at the whole tree every time, whatever you changed. A broken link, a missing heading, a stale decisions index, an ownership-map table that differs from the script, or a malformed invariant prints a line ending in `[integrity]`, for example:

```
✗ docs/guides/testing.md:12: link 'missing.md' points to a missing file: docs/guides/missing.md [integrity]
```

Every message is listed in [Failure modes](docs-contract-technical.md#failure-modes).

**No base branch.** Exit code 2, with one of:

- `docs-check: no base branch: neither origin/main nor main exists; pass --base REF`
- `docs-check: base ref '<ref>' does not exist`
- `docs-check: HEAD and <ref> have no merge base`

Run `git fetch origin`, or pass `BASE=` with a branch that exists.

**Skipped.** Exit code 0 with `docs-check: skipped because SKIP_DOCS_CHECK=1 (local only; CI always runs the check)`. In CI you see `docs-check: SKIP_DOCS_CHECK is ignored because CI is set` and the check runs.

## See also

- [Documentation guide](../guides/documentation.md): how to write each kind of document, and what the check cannot catch.
- [Technical document](docs-contract-technical.md): how the check works.
- [Decisions about the contract](../decisions/docs.md).

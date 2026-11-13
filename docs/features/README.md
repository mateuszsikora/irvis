# Features and the ownership map

This file is for anyone who changes code in this repository. It lists the features and their documents. It also holds the ownership map, which says which document has to change when a path changes. `scripts/check-docs.py` enforces the map; how to write each document is in the [documentation guide](../guides/documentation.md).

## Features

| Feature | User document | Technical document | Code paths |
| --- | --- | --- | --- |
| Documentation contract | [docs-contract-user.md](docs-contract-user.md) | [docs-contract-technical.md](docs-contract-technical.md) | `scripts/check-docs.py`, `scripts/decisions-index.py` |

irvis has no product code yet. Any path outside the map falls under rule F0 below, so the first product code has to come with its own feature documents.

## Ownership map

`RULES` in `scripts/check-docs.py` is the source of truth for this table. `make docs-check` parses the table and fails on any rule that is missing, extra or different. In a cell, `\|` stands for `|`.

A rule fails when a changed path matches its source regex and no changed path matches its documentation regex. F0 is the catch-all: it matches only the paths that no other rule owns, and only a feature document that is **new** on the branch satisfies it (added since the merge base, or untracked). A document that git detects as a rename of a deleted one is not new: at least 50% similar content, which is what `git mv` produces, but also what copying an old document produces. F0 skips deleted paths.

| # | source path regex | doc path regex | message |
| --- | --- | --- | --- |
| F0 | `.*` | `^docs/features/[^/]+-(user\|technical)\.md$` | Path owned by no rule: add new feature documents (docs/features/NAME-user.md and docs/features/NAME-technical.md) and add the path to the ownership map |
| F1 | `^scripts/(check-docs\|decisions-index)\.py$` | `^(docs/features/docs-contract-(user\|technical)\.md\|docs/guides/documentation\.md\|AGENTS\.md)$` | Documentation check or decisions index changed: update docs/features/docs-contract-technical.md (or docs/features/docs-contract-user.md, docs/guides/documentation.md), and AGENTS.md if RULES changed |
| C1 | `^Makefile$` | `^docs/guides/(development\|testing)\.md$` | Build targets changed: update docs/guides/development.md (or docs/guides/testing.md for the test target) |
| C2 | `^\.github/(?!pull_request_template\.md$)` | `^docs/guides/development\.md$` | CI or GitHub configuration changed: update docs/guides/development.md |

Notes on the rules:

- C2 is a carve-out: it owns all of `.github/` except the pull request template, so a new workflow or a new `CODEOWNERS` file is owned from its first line.
- F1 names its two files because `scripts/` has several owners. A new file in `scripts/` matches no rule but F0, which asks for new feature documents; if the script belongs to an existing feature, add it to that feature's rule instead.
- A file with several owners accepts the documents of any of them: the `Makefile` passes C1 with either guide, and the check scripts pass F1 with any of four documents. Review checks that the right one changed.
- Adding a rule means editing `RULES`, this table and the table in [AGENTS.md](../../AGENTS.md#documentation-contract) in the same change.

## Left out on purpose

These paths are removed from the source side before any rule runs, so changing them needs no documentation. They still count on the documentation side. `EXCLUDE` in `scripts/check-docs.py` is the source of truth; the check fails if this table differs from it.

| path regex | why |
| --- | --- |
| `^tests/` | Test code and test data: they describe behaviour, they do not change it |
| `(^\|/)[^/]+\.(test\|spec)\.[^/]+$` | Test files kept next to the code they test |
| `(^\|/)([^/]+\.lock\|package-lock\.json\|pnpm-lock\.yaml\|go\.sum)$` | Lock files: generated from a manifest that a rule owns |
| `^(LICEN[CS]E\|COPYING)([.-][^/]*)?$` | Licence |
| `^\.gitignore$` | Git ignore list |
| `^docs/` | Documentation |
| `^README\.md$` | Root README, an entry point into docs/ |
| `^(AGENTS\|CLAUDE)\.md$` | Agent instructions; CLAUDE.md is a symlink to AGENTS.md |
| `^CONTRIBUTING\.md$` | Contribution rules |
| `^\.github/pull_request_template\.md$` | Pull request template |
| `^\.(agents\|claude)/` | Agent tooling: skills and agent settings |
| `^(packages\|apps\|tools)/[^/]+/(test\|e2e)/` | Test helpers and end-to-end tests of a package |
| `^fixtures/` | Test data |
| `^NOTICE$` | Attribution notices, next to the licence |

Files whose change touches only versions are also left out: a workflow whose diff only changes Action versions, and a `package.json` whose change only touches the values in its dependency fields. Which files and what counts as a version is in [the technical document](docs-contract-technical.md#version-bump-filter).

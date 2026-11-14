# Features and the ownership map

This file is for anyone who changes code in this repository. It lists the features and their documents. It also holds the ownership map, which says which document has to change when a path changes. `tools/docs-check/src/check-docs.ts` enforces the map; how to write each document is in the [documentation guide](../guides/documentation.md).

## Features

| Feature | User document | Technical document | Code paths |
| --- | --- | --- | --- |
| Documentation contract | [docs-contract-user.md](docs-contract-user.md) | [docs-contract-technical.md](docs-contract-technical.md) | `tools/docs-check/` |
| Core | [core-user.md](core-user.md) | [core-technical.md](core-technical.md) | `packages/core/` except `src/cameras/` |
| Cameras | [cameras-user.md](cameras-user.md) | [cameras-technical.md](cameras-technical.md) | `packages/core/src/cameras/` |
| Web app | [web-app-user.md](web-app-user.md) | [web-app-technical.md](web-app-technical.md) | `apps/web/`, `netlify.toml` |
| Capture tool | [capture-cli-user.md](capture-cli-user.md) | [capture-cli-technical.md](capture-cli-technical.md) | `tools/capture-cli/` |

Any path outside the map falls under rule F0 below, so a new package or app has to come with its own feature documents.

## Ownership map

`RULES` in `tools/docs-check/src/check-docs.ts` is the source of truth for this table. `npm run docs-check` parses the table and fails on any rule that is missing, extra or different. In a cell, `\|` stands for `|`.

A rule fails when a changed path matches its source regex and no changed path matches its documentation regex. F0 is the catch-all: it matches only the paths that no other rule owns, and only a feature document that is **new** on the branch satisfies it (added since the merge base, or untracked). A document that git detects as a rename of a deleted one is not new: at least 50% similar content, which is what `git mv` produces, but also what copying an old document produces. F0 skips deleted paths.

| # | source path regex | doc path regex | message |
| --- | --- | --- | --- |
| F0 | `.*` | `^docs/features/[^/]+-(user\|technical)\.md$` | Path owned by no rule: add new feature documents (docs/features/NAME-user.md and docs/features/NAME-technical.md) and add the path to the ownership map |
| F1 | `^tools/docs-check/` | `^(docs/features/docs-contract-(user\|technical)\.md\|docs/guides/documentation\.md\|AGENTS\.md)$` | Documentation check or decisions index changed: update docs/features/docs-contract-technical.md (or docs/features/docs-contract-user.md, docs/guides/documentation.md), and AGENTS.md if RULES changed |
| F2 | `^packages/core/(?!src/cameras/)` | `^docs/features/core-(user\|technical)\.md$` | Core changed: update docs/features/core-technical.md (or docs/features/core-user.md) |
| F3 | `^(apps/web/\|netlify\.toml$)` | `^docs/features/web-app-(user\|technical)\.md$` | Web app or its Netlify configuration changed: update docs/features/web-app-technical.md (or docs/features/web-app-user.md) |
| F4 | `^packages/core/src/cameras/` | `^docs/features/cameras-(user\|technical)\.md$` | Camera registry or profile schema changed: update docs/features/cameras-technical.md (or docs/features/cameras-user.md) |
| F5 | `^tools/capture-cli/` | `^docs/features/capture-cli-(user\|technical)\.md$` | Capture tool changed: update docs/features/capture-cli-technical.md (or docs/features/capture-cli-user.md) |
| C2 | `^\.github/(?!pull_request_template\.md$)` | `^docs/guides/development\.md$` | CI or GitHub configuration changed: update docs/guides/development.md |
| C3 | `^(package\.json\|tsconfig(\.[^/]+)?\.json\|(eslint\|vitest)\.config\.[cm]?[jt]s\|\.prettierrc(\.[^/]+)?\|\.prettierignore\|\.nvmrc\|\.npmrc)$` | `^docs/guides/(development\|testing)\.md$` | Root TypeScript configuration changed: update docs/guides/development.md (or docs/guides/testing.md for the Vitest configuration) |

Notes on the rules:

- C2 is a carve-out: it owns all of `.github/` except the pull request template, so a new workflow or a new `CODEOWNERS` file is owned from its first line.
- F2 and F4 split `packages/core/`: F4 owns `src/cameras/` and F2 everything else in the package, so a change to the registry needs the cameras documents, not the core ones. Core's tests (`*.test.ts`) and `packages/core/test/` are left out (below).
- F3 owns `netlify.toml` together with `apps/web/`, because the file only configures how the web app is built and deployed.
- C3 lists the root configuration files by name, because the root has many owners. A new root configuration file matches no rule but F0 until it is added to C3. The root `package.json` falls under C3 unless its change is a version bump; the `package.json` of a workspace falls under that workspace's rule.
- F1 owns the whole workspace `tools/docs-check/`: the check, the decisions index generator, their shared modules and the workspace's `package.json`, `tsconfig*.json` and `vitest.config.ts`. Its tests (`*.test.ts` and `test/`) are left out (below). F5 owns `tools/capture-cli/` the same way. Another tool in `tools/` matches no rule but F0, which asks for new feature documents.
- A file with several owners accepts the documents of any of them: a root configuration file passes C3 with either guide, and the check passes F1 with any of four documents. Review checks that the right one changed.
- There is no C1: it owned the `Makefile`, which was removed in #30 when the npm scripts replaced make.
- Adding a rule means editing `RULES`, this table and the table in [AGENTS.md](../../AGENTS.md#documentation-contract) in the same change.

## Left out on purpose

These paths are removed from the source side before any rule runs, so changing them needs no documentation. They still count on the documentation side. `EXCLUDE` in `tools/docs-check/src/check-docs.ts` is the source of truth; the check fails if this table differs from it.

| path regex | why |
| --- | --- |
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

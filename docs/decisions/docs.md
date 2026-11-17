# Decisions: documentation contract

Why the documentation system and its check work the way they do. How to add a decision: [documentation guide](../guides/documentation.md#decisions).

## Documentation is written by hand and the script only enforces it

Status: decided

The documents say what the code does for a user, why it is shaped as it is, and what fails how. That needs judgement about what matters to a reader, which code does not hold. The script's job is narrower: make sure nobody forgets to update the document. It works out which document is due from the paths that changed, and it checks that the documentation hangs together (links, anchors, index, map).

**Rejected:** generating reference documentation from docstrings or code, because generated text restates the code and does not say what a user sees or why a choice was made. That is the part that goes stale.

## The check uses only the Python standard library

Status: superseded (#30)

Superseded by [the check uses only Node built-ins and runs with Node type stripping](#the-check-uses-only-node-built-ins-and-runs-with-node-type-stripping).

`scripts/check-docs.py` and `scripts/decisions-index.py` run with the system `python3` and need no virtual environment, lock file or install step. Contributors and CI runners can run them on a fresh clone, and the check cannot break because a dependency changed.

**Rejected:** a Markdown parser library (for example `markdown-it-py`) for headings and links, because it needs an install step in every environment, and the subset of CommonMark the check needs (fences, ATX and setext headings, inline links) fits in about a hundred lines.

**Rejected:** a shell script, because the GitHub slug rules, multiset comparison and table parsing are hard to get right in POSIX shell and differ between GNU and BSD tools.

## The check uses only Node built-ins and runs with Node type stripping

Status: decided (#30)

The documentation check and the decisions index generator are TypeScript in the workspace `tools/docs-check/`. They import only Node built-ins (`node:child_process`, `node:fs`, `node:path`) and the other modules of `tools/docs-check/src/`, which an ESLint rule enforces, so `node tools/docs-check/src/check-docs.ts` runs on a fresh clone with Node 26 alone, through Node's type stripping, without `npm ci`. The "Documentation contract" and "Documentation integrity" jobs need only `actions/setup-node` with `.nvmrc`. Their tests are Vitest tests and run in the "TypeScript" job with every other test.

The repository has needed Node 26 since #5, and every other tool in it (ESLint, Prettier, `tsc`, Vitest, Vite) is an npm package. With the check in Python, a contributor needed Python 3 and make next to Node, the check had its own test runner, test style and CI job, and its code could not share the TypeScript rules (`tsconfig.base.json`, ESLint) that the rest of the code follows. One language removes all of that.

The check is ported from the Python version without changing its messages, exit codes or options. Where JavaScript differs from what the Python version did, `tools/docs-check/src/text.ts` and `tools/docs-check/src/json.ts` reimplement it: Unicode-aware word, digit and space classes, Unicode line splitting, quoting of values in messages, code point order, git paths that are not UTF-8, and a JSON reader that rejects repeated keys and keeps `true`, `1` and `1.0` apart ([technical document](../features/docs-contract-technical.md#text-semantics)).

**Rejected:** keeping the check in Python, because it keeps a second language, a second test runner and the make wrapper in a repository that is otherwise TypeScript, for a tool that every contributor runs. **Rejected:** letting the check depend on npm packages (a Markdown parser, `typescript`), because the two documentation jobs would then need `npm ci`, about 210 packages from the registry, before a check that only reads Markdown and git output, and the check would stop working on a fresh clone until `npm ci` ran. **Rejected:** compiling the check to JavaScript, because Node 26 runs the TypeScript directly, and a build output can go stale.

## The check runs in CI, not as a git hook

Status: decided

The check looks at the whole branch against its merge base. A pull request may land code in one commit and its documentation in the next; that is fine as long as both are in the pull request.

**Rejected:** a pre-commit hook, because it would block the code-only commit, and people would learn to skip it with `--no-verify`.

## The ownership check runs on pull requests and the integrity check also on main

Status: decided

The ownership check needs a base branch (`github.base_ref`) to diff against, which only a pull request has, so the "Documentation contract" job runs on pull requests only. The integrity checks need no base. A pull request's run checks the merge with the base as it was when the run started, and GitHub does not rerun it when the base moves, so two pull requests that pass alone can break `main` together (one renames a heading, the other links to it). The "Documentation integrity" job runs `--integrity-only` on every push to `main`, so the break shows up on the commit that caused it, not on the next unrelated pull request.

**Rejected:** the full check on pushes to `main`, because a squash commit has no meaningful base to diff against. **Rejected:** no run on `main`, for the reason above.

## SKIP_DOCS_CHECK is ignored in CI

Status: decided

The variable exists so that `npm run docs-check` does not get in the way of work in progress on a laptop. If it worked in CI, setting it in a workflow would switch the contract off for everyone without anyone noticing. The script prints that it ignored the variable, so nobody wonders why the skip had no effect.

**Rejected:** honouring the skip everywhere, because then the check proves nothing. **Rejected:** a skip marker in the commit message or pull request body, because it is an off switch in the same place as the change it is meant to check.

## Rules match directories minus carve-outs, not lists of files

Status: decided

A rule like C2 owns all of `.github/` except the pull request template. A new workflow is then owned from its first line, and nobody has to remember to add it to a list. Files are listed by name only where a directory has several owners, as in the repository root (C3).

**Rejected:** one rule per file, because every new file would start unowned until someone noticed.

## The catch-all rule covers the whole repository until there is a package

Status: decided

A catch-all rule usually covers the main package. irvis has no package yet, and nobody knows where the first product code will live. F0 therefore owns every path that no other rule owns and that `EXCLUDE` does not list, anywhere in the tree, and asks for a new feature document. When a package appears, its own `F<n>` rules take over its paths, as F2, F3 and F4 did for `packages/core` and `apps/web` in #5; F0 still owns every other path, so the next package needs its own documents too. F0 skips deleted paths: removing code that no rule owns leaves no document to update, and asking for a new one would contradict "removing behaviour removes its documentation".

**Rejected:** scoping F0 to a guessed directory such as `src/` or `irvis/`, because code put anywhere else would be owned by nothing. **Rejected:** accepting an edit to an existing feature document, because a blank line would satisfy it.

## Version-only bumps need no documentation

Status: decided

Bumping an Action from `@v6` to `@v7` changes nothing a document describes. Without a filter, every such change would need a meaningless document edit, which teaches people to make meaningless document edits. The filter is strict: every changed line must match the file's pattern, and each removed line must be replaced in place by a line that differs only in the version. A bump mixed with any other change, or a `uses:` line moved to another job, still needs documentation. If the filter raises, the check fails instead of passing.

**Rejected:** comparing the multisets of removed and added lines, because a moved step looks like a bump that way.

**Rejected:** ignoring workflow files entirely, because a changed step, trigger or timeout is a real change to CI. **Rejected:** filtering pins that the documentation states, such as a toolchain version, because then the document would go stale with the bump.

## Test files are left out of the source side

Status: decided

Tests describe behaviour; they do not change it. A pull request that only adds tests has no document to update. Test files still count on the documentation side, and a test that enforces a domain rule is listed in `docs/invariants.md`. TypeScript keeps them next to the code as `*.test.ts`, which a file-name pattern leaves out; test helpers and end-to-end tests of a package live in `<packages|apps|tools>/<name>/test/` or `e2e/`, and shared test data in `fixtures/`, and those directories are left out as well. Only those exact directories are: `packages/core/src/test/` is source code, because a pattern that matched `test/` anywhere would also leave out product code that happens to sit in such a directory.

**Rejected:** treating tests as source owned by their feature's rule, because every new test would need a document edit that says nothing new.

## The decisions index is generated

Status: decided

Agents read `docs/decisions/README.md` to find out cheaply whether a question was already settled. A hand-kept index goes stale, and a stale index answers "no such decision" for one that exists, which is worse than no index. `tools/docs-check/src/decisions-index.ts` writes it from the headings and `Status:` lines, and the check fails while it is stale.

**Rejected:** a hand-kept index, for the reason above. **Rejected:** no index, because reading every decision file in full costs an agent much more context than one table.

## Integrity checks run on the whole tree every time

Status: decided

Renaming a heading or a file breaks links in documents that did not change. Checking only changed files would miss exactly those. The whole tree is small: the integrity checks take well under a second on it (about 35 ms when they were added).

**Rejected:** checking only the changed Markdown files, because of the renamed-target case above.

## The documentation check is not a required status check yet

Status: superseded (#26)

Once the repository is public, a ruleset makes the checks required; see [the replacement decision](#ci-checks-are-required-through-a-ruleset-once-the-repository-is-public).

The CI job should be a required check, but the plan does not allow it: `gh api repos/mateuszsikora/irvis/branches/main/protection` and `.../rulesets` return HTTP 403 ("Upgrade to GitHub Pro or make this repository public to enable this feature") for this private repository on the free plan. The job runs on every pull request, and [CONTRIBUTING.md](../../CONTRIBUTING.md#verification) makes a red job a blocker by rule. Make it required, with the job name "Documentation contract", once the plan or the repository's visibility allows it.

**Rejected:** a workaround that fails the merge by other means (a bot, a scheduled job), because it adds moving parts for what one repository setting will do.

## CI checks are required through a ruleset once the repository is public

Status: decided (#26)

A public repository gets rulesets on the free plan, so the checks that [CONTRIBUTING.md](../../CONTRIBUTING.md#verification) makes a blocker by rule become a blocker in GitHub. The ruleset is kept in `.github/rulesets/main.json`, so that a change to it is reviewed like code; GitHub does not read the file, and the owner applies it with `gh api` ([how](../guides/development.md#required-checks)); it was applied on 17 November 2026, after the repository went public. It applies to the default branch and:

- requires the checks "Documentation contract" and "TypeScript", reported by GitHub Actions (app id 15368), so that no other app or commit status can satisfy them. "Documentation integrity" runs only on pushes to `main` and "Desktop packages" only on some paths; a required check that never runs on a pull request would block it forever;
- does not require the branch to be up to date with `main` before merging: that would make every open pull request update after each merge, and the integrity job on `main` already reports two pull requests that break `main` together;
- requires a pull request, with squash as the only merge method and no approving review, because the only maintainer cannot approve their own pull requests; it blocks deleting `main` and force pushes to it.

The ruleset has no bypass actor. The Release workflow opens its version pull request with `GITHUB_TOKEN`, and events made with that token start no workflow, except `workflow_dispatch` and `repository_dispatch`. So `ci.yml` also runs on `workflow_dispatch`, and the workflow starts it on the version branch, waits for it and then merges as any pull request merges. "TypeScript" then checks the version commit. On a run by hand, the job "Documentation contract" does not run the contract, which would ask for a desktop document for the `version` field of a pull request that is exempt from the pull request rules ([CONTRIBUTING.md](../../CONTRIBUTING.md#what-reaches-main)). It checks instead that the branch changes nothing but that field and its lockfile entry, and fails otherwise. Skipping the job was the first plan and is rejected: a skipped job counts as a passing required check, and GitHub takes the latest check run of a name, so anyone with write access could start CI by hand on any branch and so stand in for the contract.

**Rejected:**

- GitHub Actions as a bypass actor (app 15368, mode `pull_request`), which was the first plan: GitHub refuses it in a repository of a personal account with HTTP 422, `Actor GitHub Actions integration must be part of the ruleset source or owner organization`.
- A deploy key with bypass that pushes the version commit to `main`, because it needs a secret and drops the version pull request.
- A bypass for the admin role, with the owner merging every version pull request by hand, because the Release workflow is meant to run unattended ([decision](architecture.md#a-release-is-a-draft-github-release-built-from-a-version-commit-on-main)).
- A GitHub App token that opens the pull request, so that CI starts by itself, because it needs an app and a private-key secret.
- Classic branch protection, because a ruleset can be kept as JSON in the repository and restricts the merge method.
- Requiring an approving review, for the reason above.
- Protecting `release` in the same change, because publishing on GitHub Pages ([#54](https://github.com/mateuszsikora/irvis/issues/54)) may remove the branch and "Promote to release".

## Dependabot alerts are on and its security updates are off

Status: decided (#59)

With the repository public, Dependabot alerts report known vulnerabilities in the dependencies of `package-lock.json`. Dependabot security updates, which open a pull request for each alert, stay off. Their branches always start with `dependabot` (`dependabot.yml` sets only the separator), so they cannot follow the branch pattern in [CONTRIBUTING.md](../../CONTRIBUTING.md#branches); their titles are "Bump <package> from <a> to <b>" unless `dependabot.yml` sets a prefix; and with squash merge their bodies, release notes and commit lists, would land in `main`. An alert is fixed by hand instead, with a normal pull request that bumps the dependency; such a bump needs no documentation ([decision](#version-only-bumps-need-no-documentation)).

**Rejected:** turning security updates on with an exemption from the branch and commit rules, as the Release workflow's version pull request has, because that exemption covers a pull request whose whole content the owner chose when starting the run, while a Dependabot pull request brings a new version of third-party code and a message written by someone else.

## Tests use unittest from the standard library

Status: superseded (#30)

Superseded by [the check uses only Node built-ins and runs with Node type stripping](#the-check-uses-only-node-built-ins-and-runs-with-node-type-stripping): the check's tests are Vitest tests.

`unittest` runs with the system `python3` like the scripts themselves, so `make test` needs no virtual environment or dependency manifest in a repository that has no Python project otherwise.

**Rejected:** pytest, because it would add the first dependency, a manifest and an install step to CI only for the test runner.

## CLAUDE.md is a symlink to AGENTS.md

Status: decided

Every agent reads the same file: Codex reads `AGENTS.md`, Claude Code reads `CLAUDE.md`, and the symlink makes them the same bytes. Before this change `CLAUDE.md` held `@AGENTS.md`, an import that only Claude Code understands.

**Rejected:** keeping the `@AGENTS.md` import, because other tools that read `CLAUDE.md` would see one line instead of the instructions.

## No path-scoped rule file for agents

Status: decided

An extra rule file (for example in `.claude/rules/`) could restate the "You changed / You must also update" table when an agent edits a source file. `AGENTS.md` is loaded at the start of every session and already holds the table, and every restatement is one more copy that can go stale without the check noticing.

**Rejected:** `.claude/rules/docs-contract.md` with `paths:` front matter, for the reasons above. Revisit if agents are seen to miss the table in `AGENTS.md`.

## The documentation check is documented as a feature

Status: decided

The check was the only code in the repository when this was decided, it has users (everyone who opens a pull request), messages and exit codes, which is what feature documents are for. Its user and technical documents hold the details; the documentation guide explains how to write documents and links to them for how the check works.

**Rejected:** describing the check only in the documentation guide, because the guide would then mix writing advice with a full list of failure messages, and the catch-all rule would have no example of the feature-document pair.

## Plans and spike reports live in docs/ as marked exceptions

Status: decided (#3)

Everything else in `docs/` says what is true now. Two kinds of document cannot: the [roadmap](../roadmap.md), which says what is planned, and the reports of the hardware spikes in `docs/findings/`, which say what was measured on a camera at one point in time. They live in `docs/` anyway, because agents and contributors in every clone read the repository, and the plan has to change in the same pull requests as the code it describes. Other documents never cite them for what the code does. A decision may also come before its code, as the [architecture decisions](architecture.md) do; such a file says so at the top and names, for each decision, the issues that implement it.

The documentation check fails on a link, or a code span that is exactly a lowercase `docs/<path>.md` path, to a file that does not exist, on every pull request and on every push to `main`. A plan names documents that come later, so it writes them without the `docs/` prefix and with "(planned, M<n>)", for example `irvis-format.md` (planned, M4). The pull request that creates the document turns the mention into a link, and from then on the check guards it. Spike reports have lowercase names (`m1.md`, `m5-checklist.md`), so the check treats them like every other document. Sections are cited by a link to their heading, not with a section sign, because the check reads `<word>` followed by a section sign and a number as a citation of an unknown document.

**Rejected:** a copy of the owner's specification in `docs/`, because the plan departs from it in several places (listed in the roadmap), and two documents would then state different requirements. The roadmap carries the requirements that still hold. **Rejected:** GitHub issues as the only plan, because they are not versioned with the code, and reading them needs network access and `gh`. The issues remain the work items; the roadmap links them. **Rejected:** an exception for the roadmap in the link check, because it needs a change to the script, weakens the check for the most-read document, and hides typos in paths that do exist.

## package.json bumps are compared as parsed JSON

Status: decided (#4)

Every other bump filter works line by line: a changed line must match a version pattern and be replaced in place. In `package.json` a line such as `"node": ">=22",` does not say whether it sits in `dependencies` or in `engines`, and only the first is a plain dependency bump; the supported Node version is a requirement the documentation states. So `package.json` is parsed on both sides, and the change passes as a bump only if it touches nothing but the version ranges of existing keys in `dependencies`, `devDependencies`, `peerDependencies` and `optionalDependencies`. A version range is a string without `:` and `/`; `npm:preact@^10`, `file:../vendor/react`, `workspace:*` or `github:someone/react` name another package or another place to get it from, which is a decision, not a bump. Adding, removing or moving a dependency, changing its source, and any change to `engines`, `packageManager` or another field, needs documentation. A file that does not parse is not a bump, so it goes through the rules like any other change.

**Rejected:** a line regex for `package.json`, because it would let a change to `engines` or `packageManager` through as a bump, or would need to track which object a line belongs to, which is a JSON parser written badly. **Rejected:** leaving `package.json` out entirely, because a new script, workspace or engine requirement is a real change. **Rejected:** accepting any string value, because switching a dependency to an alias, a fork or a local copy would then pass as a bump. **Rejected:** a full semver range grammar, because "no `:` and no `/`" already separates ranges and dist-tags from every source form npm accepts, and a grammar is one more thing to get wrong. **Rejected:** failing with `[filter]` on a file that does not parse, because the rules already fail on it and a broken manifest is not a broken filter.

## Vitest test ids are checked by text search

Status: decided (#4)

`docs/invariants.md` names TypeScript tests as `<path>::<describe>::<it>`, with the literal names Vitest shows. The check finds `describe("...")`, `it("...")` and `test("...")` calls whose first argument is one plain string literal, and requires the names in the given order. It does not parse TypeScript, because a parser is an npm package and [the check uses only Node built-ins](#the-check-uses-only-node-built-ins-and-runs-with-node-type-stripping). The cost is that it does not verify the real nesting: a test named under the wrong `describe` passes when that `describe` comes earlier in the file. Template literals, `it.each` and modifiers such as `it.only` are not found, so a test that enforces an invariant has a fixed, literal name.

Revisited in #30, when the check moved to TypeScript: Node is now there anyway, but the TypeScript compiler API is not, so the decision stands.

**Rejected:** the TypeScript compiler API (the `typescript` package), because the check would import an npm package, so both documentation jobs would need `npm ci` before they run and the check would fail on a fresh clone without it; the gain, verified nesting, covers a limitation that review catches today. `tree-sitter` is rejected for the same reason. **Rejected:** asking Vitest for its test list (`vitest list`), because the check would need `npm ci` before it runs, would run every test file's imports, and the integrity job on `main` would depend on the whole TypeScript toolchain. **Rejected:** matching brackets to recover the nesting, because strings, comments, template literals and regex literals make a bracket counter wrong in exactly the files that are hard to read.

## Android audit captures remain private

Status: decided (#11)

The Android audit's screenshots and recordings show the owner's home. The owner requested a text-only deliverable for the future public repository. Keep these captures and derived galleries or bundles in the gitignored `.context/android-audit/` directory; do not publish them in git or GitHub attachments. The feature catalogue retains observations, coverage limits and local capture IDs. The accepted catalogue and implementation handoff satisfy #11 without public screenshots.

**Rejected:** publishing the original screenshots as review evidence, because the text inventory is sufficient and the images expose private surroundings.

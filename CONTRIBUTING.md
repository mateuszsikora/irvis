# Contributing to irvis

This file is the source of truth for how changes reach `main`. `AGENTS.md` and the agent skill in `.agents/skills/create-pr/SKILL.md` restate these rules; where they disagree, this file wins. How to write documentation is in [docs/guides/documentation.md](docs/guides/documentation.md); where a skill disagrees with a document under `docs/`, the document wins. A rule change goes into every one of these files that states the rule, in the same pull request.

## Language

Everything that goes to git or GitHub is in English: branch names, commit messages, PR titles and descriptions, review comments, issues.

## Attribution

No AI or tool attribution anywhere in git or GitHub: no `Co-Authored-By:` trailers naming an AI agent or tool, no "Generated with ..." lines, no robot emoji. This applies to every agent (Claude Code, Codex, others) and overrides whatever attribution a tool or session asks for.

## What reaches `main`

Pull requests are merged with **squash merge only**. With this repository's squash settings (`COMMIT_OR_PR_TITLE` + `COMMIT_MESSAGES`):

- A PR with **one commit** becomes that commit: its subject and body are used, and the PR title is not.
- A PR with **several commits** becomes one commit whose subject is the PR title and whose body lists every commit message of the branch.
- In both cases GitHub appends ` (#N)` to the subject.

Either way, every commit message on the branch ends up in `main`'s history, so every commit message must follow the rules below. Nobody pushes directly to `main`, and PRs are merged with "Squash and merge" even if GitHub offers other buttons (see Repository settings).

One kind of PR is exempt from the rules for branches and descriptions, review and CI below: the PR `chore(release): set the version to <version>` that the [Release workflow](docs/guides/development.md#release) opens from `chore/release-<version>` and squash-merges itself. It changes only the version in `apps/desktop/package.json` and `package-lock.json`, and its commit message follows the commit rules.

## Branches

```
<type>/<short-slug>
<type>/<issue-number>-<short-slug>
```

- `<type>` is one of the commit types below and matches the type in the PR title.
- The slug is lowercase kebab-case, a few words, ideally under 40 characters.
- Examples: `feat/12-user-login`, `docs/contributing-guide`, `chore/share-skills-with-codex`.

Tool-generated names (for example `<username>/<random-words>` from Conductor) are renamed to this pattern before a PR is opened. A branch that already has an open PR keeps its name.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>)!: <subject>

<body>

<footer>
```

- **Types:** `feat` (new behaviour), `fix` (bug fix), `docs` (documentation only), `refactor` (no behaviour change), `perf`, `test`, `build` (build system, dependencies), `ci`, `chore` (tooling, repository maintenance).
- **Scope** is optional, lowercase, and names the part of the project touched (for example `skills`, `contributing`). There is no fixed scope list yet.
- **Subject:** imperative mood ("add", not "added"/"adds"), starts lowercase, no trailing period, whole header at most 72 characters as written. The ` (#N)` GitHub appends on squash does not count; a header in `main` that goes past 72 only because of it is accepted.
- **Body:** separated by a blank line, wrapped at 72 characters, explains why the change is needed and anything non-obvious about how. Skip it only when the subject says everything.
- **Footer:** `Closes #N` when the commit completes issue N, `Refs #N` when it only contributes to it; always the last lines. A breaking change uses `!` after the type/scope and a `BREAKING CHANGE:` footer.
- No `wip`, `fixup!` or "address review" commits in a PR that is ready for review; fold them into the commit they fix.

## Pull requests

- **Title:** the same format and length limit as a commit header. For a one-commit PR the title equals the commit subject. It says what changes for the project, not which files were edited.
- **Description:** fill `.github/pull_request_template.md`. Outcome first, then `Closes #N` / `Refs #N`; then Changes (grouped by meaning), Decisions (choice, rejected alternative, why), Documentation (the checkboxes, see [Documentation](#documentation)), Verification (exact commands and results, and what was not verified), Notes. Delete empty sections and template comments. No hard wrapping, no emoji.
- **Issues:** link the issue the PR works on. `Closes` only if the PR completes everything the issue asks for; otherwise `Refs`.
- **Draft vs ready:** open as draft when anything is missing: a check failing or not run, TODO/FIXME or skipped tests the change relies on, wip/fixup commits, `Closes` on a partially done issue, a rule changed in only some of the files that state it, tooling added without its verification rows, open questions. Otherwise open it ready for review.
- **Labels:** only existing labels; new labels are not created as part of a PR.

  | Title type | Label |
  | --- | --- |
  | `feat` | `enhancement` |
  | `fix` | `bug` |
  | `docs` | `documentation` |
  | other types | none |

## Documentation

Every commit and pull request that changes behaviour lands its documentation in the same change, and removing behaviour removes its documentation. The ownership map in [docs/features/README.md](docs/features/README.md#ownership-map) says which document each path needs; `npm run docs-check` enforces it, and CI runs it on every pull request.

- Run `npm run docs-check` before pushing, and run it again **after** merging the base branch into yours: the merge changes what the branch changed.
- Fill the Documentation section of the pull request template.
- **Review:** a behaviour change without its documentation is a Major finding. The check only proves that a document changed, so review also checks that what the document says is true of the code.
- Before deciding something, read [docs/decisions/README.md](docs/decisions/README.md).

## Verification

Run the checks for every part of the repository the change touches, and read their output, not only the exit code.

| Change touches | Run | Expected output |
| --- | --- | --- |
| anything | `npm run docs-check` (no `npm ci` needed) | `docs-check: <N> changed files since origin/main (<sha>), each with the documentation it needs` (`1 changed file` when N is 1) after npm's `> node tools/docs-check/src/check-docs.ts` line, exit code 0 |
| any TypeScript, JavaScript or JSON file (`tools/docs-check/` included), `package.json`, `package-lock.json` or a root configuration file | `npm ci` once, then `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build` | `npm run lint`: no problems listed after `> eslint --max-warnings 0 .`; `npm run format:check`: `All matched files use Prettier code style!`; `npm run typecheck`: nothing after `> tsc --build`; `npm test`: `Test Files  <n> passed (<n>)` and `Tests  <n> passed (<n>)`; `npm run build`: `✓ built in <time>`; each exit code 0 |
| Media storage, recording or export | `node packages/media/test/browser.mjs` (Playwright Chromium installed; ffprobe on PATH) | `media browser: OPFS recording, playback, silent/audio MP4, microphone cleanup, photo annotations and deletion passed`, exit code 0 |
| Cross-runtime parity scenario or its comparison contract | `npm run test:parity` (Playwright Chromium/WebKit installed; Electron needs a display) | `Test Files  1 passed (1)` and `Tests  1 passed (1)`, exit code 0 |
| Desktop app or Electron comparison | `npm run test:desktop` (macOS; ffmpeg on PATH or IRVIS_FFMPEG) | `desktop smoke: build, bridge isolation, module Worker, fetch, localStorage, video and CSP passed`, exit code 0 |
| Bundled ffmpeg (`apps/desktop/ffmpeg/`) | `npm run ffmpeg:build -- <target>`, then `npm run ffmpeg:verify -- <target>` for each target the host can build (C compiler, make, curl, xz) | `built <path>/ffmpeg` and `ffmpeg verify (<target>): ffmpeg 9.0.2, LGPL, <input> input, rawvideo only, 3 YUYV frames passed through unchanged`, exit code 0 |
| Desktop packaging (`apps/desktop/electron-builder.config.mjs`, `apps/desktop/src/`, Electron, electron-builder or node-usb versions) | after the ffmpeg build: `npm run package:desktop`, then `node test/package-smoke.mjs` in `apps/desktop`; the "Desktop packages" workflow runs both on every system when such a path changes | electron-builder's `building target=...` line for each target; `package smoke: resources, bundled ffmpeg capture start, node-usb and IRVIS_FFMPEG precedence passed`, exit code 0 |
| The web build or how it is served (`apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/test/pages-smoke.mjs`) | `npm run build --workspace @irvis/web`, then `node apps/web/test/pages-smoke.mjs` (Playwright Chromium installed) | `pages smoke (http://localhost:<port>/irvis/): files, secure context, OPFS recording, module Workers and camera passed`, exit code 0 |
| `.github/workflows/pages.yml` | read the steps "Choose the tag" and "Wait for this build" against [Pages](docs/guides/development.md#pages). It runs only from Release and by hand from `main`, so a change to it can be tried only after it is merged: run it by hand with the tag of the latest release (`gh workflow run pages.yml --repo mateuszsikora/irvis -f tag=v<version>`), which publishes that release again | the guide describes every check and message of the step; the run ends with "Check the published site" passed |
| `.github/workflows/release.yml` | read the steps "Choose the version", "Merge the version pull request", "Fetch the node-usb source" and "Create the draft release" against [Release](docs/guides/development.md#release). The workflow runs only from `main`, so a change to it can be tried only after it is merged: run it with a prerelease version (whose release does not go to Pages), then delete the draft. The try leaves the commit that sets the prerelease version on `main`, and a published prerelease also leaves its tag (`git push origin :refs/tags/v<version>`) | the guide describes every check and message of the steps; the run ends with a draft release holding exactly the six packages, the ffmpeg tarball, `build.sh` and `usb-<version>.tgz` |
| `.agents/skills/**` or `.claude/skills/**` | the skill check from `.agents/skills/create-pr/SKILL.md`, step 3 | `ok: N skill(s)` and nothing else |
| a rule in this file, `AGENTS.md` or a skill | compare the rule in `CONTRIBUTING.md`, `AGENTS.md` and every skill that restates it | all say the same thing |

CI runs `npm run docs-check`, the TypeScript job (lint, format, typecheck, test, build) and the check of the web build under `/irvis/` on every pull request, and the integrity checks and the other two jobs on every push to `main` ([docs/guides/development.md](docs/guides/development.md#ci)). A failing CI job blocks the merge by this rule, even though GitHub does not enforce it (see Repository settings).

Whoever adds tooling (a build, linter, test runner, CI workflow) adds its command to this table, and to the verification table in the `create-pr` skill, in the same PR.

## Agent skills

Skills live in `.agents/skills/<name>/SKILL.md`, which is where Codex looks for them. Claude Code looks in `.claude/skills/`, so each skill has a relative symlink there:

```sh
ln -s ../../.agents/skills/<name> .claude/skills/<name>
```

Edit the file under `.agents/skills/` only. The symlink must be relative (exactly `../../.agents/skills/<name>`; an absolute one dangles in every other clone) and committed as a symlink (git mode `120000`), not as a copy. Every entry in `.claude/skills/` must have a matching directory in `.agents/skills/`. Write skills in neutral terms ("ask the user", "run"), not in terms of one agent's tool names. Frontmatter fields one agent does not understand (for example Claude Code's `allowed-tools`) are ignored by the other, so they must not be the only safeguard.

## Local files

`.gitignore` excludes agent scratch space and local settings (`.context/`, `.claude/settings.local.json`, `.claude/worktrees/`), `.env*` files other than `.env.example`, `.DS_Store`, and Node and build output (`node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`). Stage files by name anyway, and check `git diff --cached --name-only` before committing.

## Repository settings

The rules above assume these GitHub settings, which live outside the repository and are changed by the owner: squash merge only (merge commits and rebase merges disabled), squash commit title `COMMIT_OR_PR_TITLE`, squash commit message `COMMIT_MESSAGES`, delete head branches after merge; for the [Release workflow](docs/guides/development.md#release), "Allow GitHub Actions to create and approve pull requests" (Settings → Actions → General); workflows of pull requests from forks wait for approval for every outside contributor ("Require approval for all external contributors", same page), so that nobody's code runs in CI unseen; the ruleset `main` from `.github/rulesets/main.json` ([Required checks](docs/guides/development.md#required-checks)); and, for the [security policy](.github/SECURITY.md), private vulnerability reporting, Dependabot alerts, secret scanning and push protection, with Dependabot security updates off ([decision](docs/decisions/docs.md#dependabot-alerts-are-on-and-its-security-updates-are-off)). Check the current state with:

```sh
gh api repos/mateuszsikora/irvis --jq '{allow_squash_merge, allow_merge_commit, allow_rebase_merge, delete_branch_on_merge, squash_merge_commit_title, squash_merge_commit_message}'
gh api repos/mateuszsikora/irvis/actions/permissions/workflow --jq '{can_approve_pull_request_reviews}'
gh api repos/mateuszsikora/irvis/actions/permissions/fork-pr-contributor-approval --jq .approval_policy
gh api repos/mateuszsikora/irvis/rulesets --jq '.[] | {name, enforcement}'
gh api repos/mateuszsikora/irvis --jq '.security_and_analysis // {} | map_values(.status)'
gh api repos/mateuszsikora/irvis/private-vulnerability-reporting --jq .enabled
gh api repos/mateuszsikora/irvis/vulnerability-alerts --silent && echo alerts on
```

`can_approve_pull_request_reviews` must be `true`, the approval policy `all_external_contributors`, and the ruleset `main` must be listed with `enforcement` `active`. In `security_and_analysis`, `secret_scanning` and `secret_scanning_push_protection` must be `enabled` and `dependabot_security_updates` `disabled`; private vulnerability reporting must be `true`, and the last command must print `alerts on` (GitHub answers 404 when the alerts are off). The last three need admin access: without it the first prints `{}` and the other two fail, which says nothing about the settings.

If GitHub still allows merge commits or rebase merges, the rule still holds: use "Squash and merge". The `create-pr` skill reports any difference. The ruleset makes GitHub require the checks "Documentation contract" and "TypeScript", a pull request and squash merges on `main`, and it blocks force pushes to `main` and its deletion. The other rules in this file are enforced by contributors and agents, not by GitHub.

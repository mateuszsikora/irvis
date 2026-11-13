# Development guide

For anyone who works on this repository, person or agent: what to install, which build targets exist, how the TypeScript toolchain is set up, what CI runs, and how the web version reaches production. Branch, commit and pull request rules are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Setup

You need:

- git 2.32 or later, Python 3.9 or later, and make, for the documentation check and its tests. They use only the Python standard library. The suite was run with Python 3.9.6, 3.13 and 3.14.6 and git 2.54.0 when it was added.
- Node.js 26 (the current LTS) with the npm it ships, for the TypeScript code. `.nvmrc` holds `26`, so `nvm use` or `fnm use` picks it. `.npmrc` sets `engine-strict=true`: with an older Node, `npm ci` stops with `npm error code EBADENGINE` and `Required: {"node":">=26"}`. The toolchain was set up with Node 26.13.0 and npm 11.20.0.

```sh
git clone git@github.com:mateuszsikora/irvis.git
cd irvis
nvm use
npm ci
make test
make js-test
make docs-check
```

## Build targets

Defined in the [Makefile](../../Makefile). Run them from the repository root.

| Target | What it does |
| --- | --- |
| `make help` | Lists the targets. The default target. |
| `make docs-check [BASE=<ref>] [ARGS=-v]` | Runs `scripts/check-docs.py`, which checks that every change on the branch carries its documentation. `BASE` defaults to `origin/main`, else `main`. See [the documentation contract](../features/docs-contract-user.md). |
| `make decisions-index` | Rewrites [docs/decisions/README.md](../decisions/README.md) from the files in `docs/decisions/`. |
| `make test` | Runs the Python test suite of the documentation check; see the [testing guide](testing.md). |
| `make js-test` | `npm test`: every Vitest project; see the [testing guide](testing.md#typescript-tests). |
| `make lint` | `npm run lint` (ESLint), then `npm run format:check` (Prettier). |
| `make typecheck` | `npm run typecheck`: `tsc --build` over every TypeScript project. |
| `make build` | `npm run build`: the `build` script of every workspace that has one; today only `apps/web`, into `apps/web/dist/`. |

`PYTHON` selects the interpreter for the Python targets (default `python3`), for example `make test PYTHON=python3.9`, and `NPM` the npm binary for the others (default `npm`). The npm targets need `npm ci` first.

## npm workspaces

The root `package.json` declares the workspaces `packages/*` and `apps/*`; today they are `packages/core` (`@irvis/core`) and `apps/web` (`@irvis/web`). A workspace depends on another with `"@irvis/<name>": "*"`, which npm links to the local directory. Packages export their TypeScript source and have no build step ([decision](../decisions/architecture.md#workspace-packages-are-consumed-as-typescript-source)). Which package may depend on which is enforced by a test ([core: technical](../features/core-technical.md#tests)).

Root scripts:

| Script | Command |
| --- | --- |
| `test` | `vitest run` |
| `build` | `npm run build --workspaces --if-present` |
| `lint` | `eslint --max-warnings 0 .` |
| `typecheck` | `tsc --build` |
| `format` | `prettier --write .` |
| `format:check` | `prettier --check .` |

Every development tool is a `devDependency` of the root `package.json`; a workspace lists only what its own code imports.

## TypeScript

TypeScript 6.0 (`~6.0.3`), not 7: typescript-eslint 8.72 supports TypeScript below 6.1 only ([decision](../decisions/architecture.md#typescript-stays-on-60-until-typescript-eslint-supports-7)).

`tsconfig.base.json` holds the options every project shares: `target` ES2022, `module` esnext with `moduleResolution` bundler, `allowImportingTsExtensions` (relative imports end in `.ts` or `.tsx`), `verbatimModuleSyntax`, `erasableSyntaxOnly`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `skipLibCheck: false`, `incremental`. Each project sets its own `lib` and `types`.

`tsconfig.json` at the root is a solution file: `tsc --build` builds its references in order.

| Project | Files | `lib`, `types` |
| --- | --- | --- |
| `tsconfig.node.json` | `vitest.config.ts` | ES2024, `node` |
| `packages/core/tsconfig.lib.json` | core's `src/` without tests | ES2022, none ([core](../features/core-technical.md#configuration)) |
| `packages/core/tsconfig.test.json` | core's tests, `test/`, `vitest.config.ts` | ES2024, `node` and `vitest` |
| `apps/web/tsconfig.app.json` | `apps/web/src/` | ES2022, DOM and DOM.Iterable, `vite/client` ([web app](../features/web-app-technical.md#build)) |
| `apps/web/tsconfig.node.json` | `apps/web/vite.config.ts` | ES2024, `node` |

`packages/core/tsconfig.json` and `apps/web/tsconfig.json` are solution files of their package's projects. Only core's library project emits anything: declarations, into `node_modules/.tsbuild/core/lib/`, which `apps/web` type-checks against. Build info files go to `node_modules/.tsbuild/`. Delete that directory if `tsc --build` reports a project as up to date that is not.

## Lint and format

ESLint 10 with a flat config, `eslint.config.js`:

- `@eslint/js` recommended and typescript-eslint `recommendedTypeChecked` on every file, with type information from the TypeScript projects above (`projectService`). `.js`, `.mjs` and `.cjs` files are linted without types. Unused `eslint-disable` comments are errors.
- ESLint does not read `.gitignore`; the config ignores `node_modules/`, `dist/` and `coverage/` at any depth, `.context/` and `.claude/worktrees/`.
- The rules for core from the architecture decisions (imports only of relative paths and `fflate`, the synchronous `fflate` API, the `Math` allow-list), and the test that makes every exception name a decision: [core: technical](../features/core-technical.md#configuration).
- `npm run lint` fails on any warning (`--max-warnings 0`).

Prettier 3 (`.prettierrc.json`: `printWidth` 100, `singleQuote`) checks every file it knows except those in `.prettierignore`: Markdown, which is formatted by hand ([style](documentation.md#style)), `package-lock.json`, and build output. `npm run format` rewrites the files.

## Hooks

There are no git hooks. The documentation check looks at the whole branch, and a commit hook would block a code-only commit whose documentation comes in the next commit of the same pull request; [the decision](../decisions/docs.md#the-check-runs-in-ci-not-as-a-git-hook). Run `make docs-check` yourself before you push.

## CI

[.github/workflows/ci.yml](../../.github/workflows/ci.yml) runs on every pull request event (opened, synchronize, reopened) and on every push to `main`. It has read-only access to the repository contents.

| Job | Runs on | Steps | Timeout |
| --- | --- | --- | --- |
| `docs`, shown as "Documentation contract" | pull requests | `actions/checkout` with `fetch-depth: 0` (a shallow clone has no merge base), then the step "Documentation contract": `make docs-check BASE="origin/$BASE_REF"`, with `BASE_REF` set from `github.base_ref` through `env` | 5 minutes |
| `integrity`, shown as "Documentation integrity" | pushes to `main` | `actions/checkout`, then `make docs-check ARGS=--integrity-only` | 5 minutes |
| `test`, shown as "Tests" | both | `actions/checkout`, then `make test` | 10 minutes |
| `typescript`, shown as "TypeScript" | both | `actions/checkout`; `actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`; then the steps Install (`npm ci`), Lint (`npm run lint`), Format (`npm run format:check`), Typecheck (`npm run typecheck`), Test (`npm test`), Build (`npm run build`) | 10 minutes |

The Python jobs use the runner's `python3`; no setup step installs another one. On a pull request, `actions/checkout` checks out GitHub's merge commit of the branch into the base as it was when the run started. GitHub does not rerun the job when the base moves, so two pull requests that pass alone can break `main` together, for example one renames a heading and the other links to it. The `integrity` job reports that on the push that merges the second one, so the breakage shows up on `main` itself, not first in an unrelated pull request. It does not prevent it: open pull requests turn red on their next run until `main` is fixed.

No job is a required check: branch protection and rulesets return HTTP 403 on this private repository on the free plan, so GitHub cannot block a merge on them. A red job is still a blocker by the rules in [CONTRIBUTING.md](../../CONTRIBUTING.md#verification); [the decision](../decisions/docs.md#the-documentation-check-is-not-a-required-status-check-yet).

## Netlify

Netlify builds `apps/web` from the private repository: a deploy preview for every pull request, and production only from the branch `release` ([decision](../decisions/architecture.md#the-web-version-is-hosted-on-netlify-and-goes-to-production-from-release)). The build settings are in `netlify.toml`, and the settings that only the Netlify UI has are listed in [web app: technical](../features/web-app-technical.md#netlify). Connecting the repository is the owner's step. TODO(owner): record the site name and URL here once it is connected.

## Promote to release

[.github/workflows/promote.yml](../../.github/workflows/promote.yml), "Promote to release", moves `release` to a commit on `main`, which makes Netlify publish it to production. It runs only by hand: Actions → "Promote to release" → "Run workflow", or

```sh
gh workflow run promote.yml --repo mateuszsikora/irvis            # the tip of main
gh workflow run promote.yml --repo mateuszsikora/irvis -f sha=<sha>
```

The job "Promote to release" (5 minutes) is the only one with `contents: write`; the workflow default is `contents: read`. Runs queue one after another (`concurrency: promote-to-release`). Its step "Fast-forward release":

1. fails with `run this workflow from main, not from <ref>` when it was started from another branch (`gh workflow run --ref` or the branch menu in "Run workflow");
2. fails with `the sha input must be 7 to 40 lowercase hexadecimal digits` unless `sha` is empty or such a string;
3. `git fetch origin main`, then resolves `sha` (empty means `origin/main`), and fails with `<sha> is not a commit in this repository` if it cannot;
4. fails with `<sha> is not on main; only commits on main are published` unless `git merge-base --is-ancestor <sha> origin/main` holds;
5. `git push origin <sha>:refs/heads/release`, without `--force`. The first run creates `release`. Later runs succeed only if `release` fast-forwards to the commit, so the workflow never moves production to a commit off `main` or back to an older one. A rejected push fails the step with git's `! [rejected] ... (non-fast-forward)`.

These checks bind the workflow, not the people who can write to the repository. `release` is not protected (branch protection and rulesets return HTTP 403 on this plan, see [CI](#ci)), so anyone with write access can still `git push origin <commit>:release` and Netlify publishes it. A run started from another branch uses that branch's copy of `promote.yml`, with `contents: write`, and a changed copy can drop every check above. That only commits on `main` reach production is therefore a rule for contributors, like the other rules in [CONTRIBUTING.md](../../CONTRIBUTING.md#repository-settings), until the plan allows protecting `release`: then restrict pushes to it to the workflow.

To roll production back, publish an older deploy in the Netlify UI ("Publish deploy"); the next promotion moves forward from `release` as before. A push made with the workflow's `GITHUB_TOKEN` starts no other workflow; Netlify learns about it through its GitHub App, whose webhooks such pushes still trigger. TODO(owner): confirm on the first promotion that Netlify starts a production deploy, and that it honours the `ignore` command in `[context.production]` of `netlify.toml` (a production build of another branch shows as "Canceled").

## Agent skills

Shared agent skills live in `.agents/skills/`, with symlinks in `.claude/skills/`. The layout and the check for it are in [CONTRIBUTING.md](../../CONTRIBUTING.md#agent-skills).

## See also

- [Testing guide](testing.md)
- [Documentation guide](documentation.md)

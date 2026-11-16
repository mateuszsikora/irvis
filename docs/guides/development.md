# Development guide

For anyone who works on this repository, person or agent: what to install, which npm scripts exist, how the TypeScript toolchain is set up, what CI runs, and how the web version reaches production. Branch, commit and pull request rules are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Setup

You need:

- Node.js 26 (the current LTS) with the npm it ships. `.nvmrc` holds `26`, so `nvm use` or `fnm use` picks it. `.npmrc` sets `engine-strict=true`: with an older Node, `npm ci` stops with `npm error code EBADENGINE` and `Required: {"node":">=26"}`. The toolchain was set up with Node 26.13.0 and npm 11.20.0.
- git 2.32 or later, for the documentation check and its tests (they use `GIT_CONFIG_GLOBAL`). They were run with git 2.54.0.
- Only for the hardware spikes: macOS and ffmpeg (`brew install ffmpeg`), see [the capture tool](../features/capture-cli-user.md#before-the-first-run).

The documentation check runs without `npm ci`: `npm run docs-check` works on a fresh clone, because the check imports only Node built-ins ([decision](../decisions/docs.md#the-check-uses-only-node-built-ins-and-runs-with-node-type-stripping)). Everything else needs `npm ci` first.

```sh
git clone git@github.com:mateuszsikora/irvis.git
cd irvis
nvm use
npm ci
npm test
npm run docs-check
```

## npm scripts

Defined in the root [package.json](../../package.json). Run them from the repository root; pass options to the script after `--`, as in `npm run docs-check -- --base origin/release -v`.

| Script | Command | What it does |
| --- | --- | --- |
| `npm run docs-check` | `node tools/docs-check/src/check-docs.ts` | Checks that every change on the branch carries its documentation. Options: `--base <ref>` (default `origin/main`, else `main`), `-v`, `--integrity-only`. See [the documentation contract](../features/docs-contract-user.md). Needs no `npm ci`. |
| `npm run capture` | `node tools/capture-cli/src/cli.ts` | The hardware capture tool; pass the command after `--`, as in `npm run capture -- list`. See [the capture tool](../features/capture-cli-user.md). Needs `npm ci`; `list`, `probe` and `capture` need macOS and ffmpeg. |
| `npm run spike:m1` | `node tools/capture-cli/src/cli.ts spike` | The interactive M1 spike on the camera ([M1 findings](../findings/m1.md)). Writes into `captures/`, which git ignores. |
| `npm run bench:irvis` | `node packages/core/test/benchmark/irvis.ts` | The `.irvis` codec benchmark on synthetic scenes: MB per minute, block modes, time per frame and the largest error at T = 0, 8 and 16 raw units ([how to read it](../irvis-format.md#benchmark)). Needs `npm ci`; takes about 10 seconds. `-- --level <0-9>` sets the deflate level (default 6). |
| `npm run decisions-index` | `node tools/docs-check/src/decisions-index.ts` | Rewrites [docs/decisions/README.md](../decisions/README.md) from the files in `docs/decisions/`; with `-- --check` it only reports. Needs no `npm ci`. |
| `npm test` | `vitest run` | Every Vitest project, the documentation check's tests included; see the [testing guide](testing.md). |
| `npm run lint` | `eslint --max-warnings 0 .` | ESLint; see [Lint and format](#lint-and-format). |
| `npm run format:check` | `prettier --check .` | Prettier, without changing files. |
| `npm run format` | `prettier --write .` | Prettier, rewriting the files. |
| `npm run typecheck` | `tsc --build` | Type-checks every TypeScript project. |
| `npm run build` | `npm run build --workspaces --if-present` | The `build` script of every workspace that has one; today only `apps/web`, into `apps/web/dist/`. |

npm prints `> <command>` before a script's output.

## npm workspaces

The root `package.json` declares the workspaces `packages/*`, `apps/*` and `tools/*`; today they are `packages/core` (`@irvis/core`, which depends on `fflate` only), `apps/web` (`@irvis/web`), `tools/docs-check` (`@irvis/docs-check`, the documentation check, which depends on nothing) and `tools/capture-cli` (`@irvis/capture-cli`, the hardware capture tool, which depends on `@irvis/core` and node-usb, `usb`). A workspace depends on another with `"@irvis/<name>": "*"`, which npm links to the local directory. Packages export their TypeScript source and have no build step ([decision](../decisions/architecture.md#workspace-packages-are-consumed-as-typescript-source)). Which package may depend on which is enforced by a test ([core: technical](../features/core-technical.md#tests)).

The root scripts are listed under [npm scripts](#npm-scripts).

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
| `tools/docs-check/tsconfig.lib.json` | the documentation check's `src/` without tests | ES2024, `node` ([documentation contract](../features/docs-contract-technical.md#configuration)) |
| `tools/docs-check/tsconfig.test.json` | its tests, `test/`, `vitest.config.ts` | ES2024, `node` and `vitest` |
| `tools/capture-cli/tsconfig.lib.json` | the capture tool's `src/` without tests; references core's library project | ES2024, `node` ([capture tool](../features/capture-cli-technical.md#configuration)) |
| `tools/capture-cli/tsconfig.test.json` | its tests, `test/`, `vitest.config.ts` | ES2024, `node` and `vitest` |

`packages/core/tsconfig.json`, `apps/web/tsconfig.json`, `tools/docs-check/tsconfig.json` and `tools/capture-cli/tsconfig.json` are solution files of their package's projects. Only the library projects of core, the documentation check and the capture tool emit anything: declarations, into `node_modules/.tsbuild/core/lib/` (which `apps/web` and the capture tool type-check against), `node_modules/.tsbuild/docs-check/lib/` and `node_modules/.tsbuild/capture-cli/lib/` (which their tests type-check against). Build info files go to `node_modules/.tsbuild/`. Delete that directory if `tsc --build` reports a project as up to date that is not.

## Lint and format

ESLint 10 with a flat config, `eslint.config.js`:

- `@eslint/js` recommended and typescript-eslint `recommendedTypeChecked` on every file, with type information from the TypeScript projects above (`projectService`). `.js`, `.mjs` and `.cjs` files are linted without types. Unused `eslint-disable` comments are errors.
- ESLint does not read `.gitignore`; the config ignores `node_modules/`, `dist/` and `coverage/` at any depth, `.context/` and `.claude/worktrees/`.
- In `tools/docs-check/src/` outside the tests, only `node:` modules and relative paths may be imported, and `import()` is rejected: the check runs in CI without `npm ci` ([documentation contract](../features/docs-contract-technical.md#configuration)).
- The rules for core from the architecture decisions (imports only of relative paths and `fflate`, the synchronous `fflate` API, the `Math` allow-list), and the test that makes every exception name a decision: [core: technical](../features/core-technical.md#configuration).
- `npm run lint` fails on any warning (`--max-warnings 0`).

Prettier 3 (`.prettierrc.json`: `printWidth` 100, `singleQuote`) checks every file it knows except those in `.prettierignore`: Markdown, which is formatted by hand ([style](documentation.md#style)), `package-lock.json`, and build output. `npm run format` rewrites the files.

## Hooks

There are no git hooks. The documentation check looks at the whole branch, and a commit hook would block a code-only commit whose documentation comes in the next commit of the same pull request; [the decision](../decisions/docs.md#the-check-runs-in-ci-not-as-a-git-hook). Run `npm run docs-check` yourself before you push.

## CI

Both workflows use runners with all three labels `self-hosted`, `Linux`, and `X64`; the registered runner is `hp600g1`. Jobs wait in the queue when no matching runner is available. The runner needs git and Bash; CI installs the Node version from `.nvmrc` with `actions/setup-node`. See the [runner decision](../decisions/architecture.md#github-actions-use-the-self-hosted-linux-x64-runner).

[.github/workflows/ci.yml](../../.github/workflows/ci.yml) runs on every pull request event (opened, synchronize, reopened) and on every push to `main`. It has read-only access to the repository contents.

| Job | Runs on | Steps | Timeout |
| --- | --- | --- | --- |
| `docs`, shown as "Documentation contract" | pull requests | `actions/checkout` with `fetch-depth: 0` (a shallow clone has no merge base); `actions/setup-node` with `node-version-file: .nvmrc`; then the step "Documentation contract": `npm run docs-check -- --base "origin/$BASE_REF"`, with `BASE_REF` set from `github.base_ref` through `env` | 5 minutes |
| `integrity`, shown as "Documentation integrity" | pushes to `main` | `actions/checkout`; `actions/setup-node` with `node-version-file: .nvmrc`; then `npm run docs-check -- --integrity-only` | 5 minutes |
| `typescript`, shown as "TypeScript" | both | `actions/checkout`; `actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`; then the steps Install (`npm ci`), Lint (`npm run lint`), Format (`npm run format:check`), Typecheck (`npm run typecheck`), Test (`npm test`, which includes the documentation check's tests), Build (`npm run build`) | 10 minutes |

The two documentation jobs run no `npm ci`: the check imports only Node built-ins, so Node from `actions/setup-node` is all they need. The documentation check's tests run in the `typescript` job with every other test. On a pull request, `actions/checkout` checks out GitHub's merge commit of the branch into the base as it was when the run started. GitHub does not rerun the job when the base moves, so two pull requests that pass alone can break `main` together, for example one renames a heading and the other links to it. The `integrity` job reports that on the push that merges the second one, so the breakage shows up on `main` itself, not first in an unrelated pull request. It does not prevent it: open pull requests turn red on their next run until `main` is fixed.

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

## M2 USB spike

`npm run spike:m2 -- <command>` aliases `capture usb`; [M2 findings](../findings/m2.md) gives commands, Linux permissions, and the optional macOS IOKit helper build. Node 26+ and the existing node-usb dependency are required; streaming also needs ffmpeg. The helper is diagnostic source, not a new release build tool.

## Browser diagnostics spike

`npm run spike:m3:web` runs the web Vite server bound to localhost. The page uses the `@irvis/backend-browser` workspace, whose TypeScript project references core and is referenced by the web app and root build. Vite bundles its module Worker with the page. See the [browser diagnostics](../features/backend-browser-user.md) and [M3 owner procedure](../findings/m3.md).

## Desktop spike

`npm run spike:m3:desktop` builds the shared web UI and the Electron main/preload bundles, then opens the desktop window. Node 26+ and system ffmpeg are required for the macOS capture spike. Electron, esbuild and Playwright are desktop workspace development dependencies. The browser-safe `@irvis/backend-electron` package is a TypeScript project reference of the web app; ESLint rejects Electron/Node imports and dynamic imports there. The sandboxed preload alone uses CommonJS require.

Run `npm run test:desktop` after desktop or comparison changes. Expected output: `desktop smoke: build, bridge isolation, module Worker, fetch, localStorage, video and CSP passed` and exit code 0. It generates a temporary video in the built web directory using ffmpeg. Run the usual lint, formatting, typecheck, unit tests, build and docs-check too. Hardware verification follows [M3](../findings/m3.md).

## Shared viewer packages

`packages/ui` exports the React viewer and `packages/backend-replay` exports an in-memory camera backend. Both are source workspace dependencies of `apps/web`, with TypeScript build references in the root solution and web app. Their tests join the existing Vitest workspace discovery; UI tests use jsdom and Testing Library. The same Vite output detects the desktop preload at runtime.


Photo library tests use the development-only `fake-indexeddb` dependency to exercise IndexedDB transactions without a browser. It is not bundled into the application; run the existing `npm test` command.

## Media package

The solution includes `packages/media`, a DOM-capable npm workspace for recording storage and MP4 export. UI and web reference its declaration build. Mediabunny is an MPL-2.0 dependency used without source changes. Only media's TypeScript projects use `skipLibCheck` to avoid duplicate transitive WebCodecs/DOM declarations; source checking remains strict.

# Development guide

For anyone who works on this repository, person or agent: what to install, which npm scripts exist, how the TypeScript toolchain is set up, what CI runs, how the web version reaches production, and how a release is made. Branch, commit and pull request rules are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

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
| `npm run ffmpeg:build` | `bash apps/desktop/ffmpeg/build.sh` | Builds the minimal LGPL ffmpeg of a desktop package into `apps/desktop/ffmpeg/dist/<target>/`; pass `-- mac-arm64`, `mac-x64`, `linux-x64`, `win-x64` or `source` (default: the host). Needs a C compiler, make, curl and xz; takes about 1.5 minutes on an M-series Mac. See [Bundled ffmpeg](../features/desktop-technical.md#bundled-ffmpeg). |
| `npm run ffmpeg:verify` | `node apps/desktop/ffmpeg/verify.mjs` | Checks that ffmpeg build; pass the same target. |
| `npm run package:desktop` | `npm run build && npm run package --workspace @irvis/desktop --` | Builds everything and packages the desktop app with electron-builder into `apps/desktop/release/`; options after `--` go to electron-builder, as in `-- --mac --arm64 --x64`. Needs `npm run ffmpeg:build` for every packaged target first. See [Packages](../features/desktop-technical.md#packages). |
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
- ESLint does not read `.gitignore`; the config ignores `node_modules/`, `dist/` and `coverage/` at any depth, the desktop packages in `apps/desktop/release/`, `.context/` and `.claude/worktrees/`.
- In `tools/docs-check/src/` outside the tests, only `node:` modules and relative paths may be imported, and `import()` is rejected: the check runs in CI without `npm ci` ([documentation contract](../features/docs-contract-technical.md#configuration)).
- The rules for core from the architecture decisions (imports only of relative paths and `fflate`, the synchronous `fflate` API, the `Math` allow-list), and the test that makes every exception name a decision: [core: technical](../features/core-technical.md#configuration).
- `npm run lint` fails on any warning (`--max-warnings 0`).

Prettier 3 (`.prettierrc.json`: `printWidth` 100, `singleQuote`) checks every file it knows except those in `.prettierignore`: Markdown, which is formatted by hand ([style](documentation.md#style)), `package-lock.json`, and build output, the desktop packages in `apps/desktop/release/` included. `npm run format` rewrites the files.

## Hooks

There are no git hooks. The documentation check looks at the whole branch, and a commit hook would block a code-only commit whose documentation comes in the next commit of the same pull request; [the decision](../decisions/docs.md#the-check-runs-in-ci-not-as-a-git-hook). Run `npm run docs-check` yourself before you push.

## CI

Every workflow runs on GitHub-hosted runners: `ci.yml`, `promote.yml` and the jobs of `release.yml` on `ubuntu-24.04`, `desktop.yml` on the systems in [Desktop packages](#desktop-packages). The repository has no self-hosted runner, so a pull request from a fork never runs on a machine of the owner's. CI installs the Node version from `.nvmrc` with `actions/setup-node`. See the [runner decision](../decisions/architecture.md#github-actions-use-github-hosted-runners).

[.github/workflows/ci.yml](../../.github/workflows/ci.yml) runs on every pull request event (opened, synchronize, reopened), on every push to `main`, and by hand (`workflow_dispatch`), which the [Release workflow](#release) uses on its version branch: then `typescript` runs as always, `integrity` is skipped, and `docs` runs the step "Only the release version changed" instead of the contract. It has read-only access to the repository contents.

| Job | Runs on | Steps | Timeout |
| --- | --- | --- | --- |
| `docs`, shown as "Documentation contract" | pull requests and runs by hand | `actions/checkout` with `fetch-depth: 0` (a shallow clone has no merge base); `actions/setup-node` with `node-version-file: .nvmrc`; then, on a pull request, the step "Documentation contract": `npm run docs-check -- --base "origin/$BASE_REF"`, with `BASE_REF` set from `github.base_ref` through `env`; on a run by hand, the step "Only the release version changed", which compares the branch with its merge base with `origin/main` and fails with `run by hand, CI passes the documentation contract only on a branch that changes nothing but the version in apps/desktop/package.json and package-lock.json; open a pull request instead` unless exactly those two files changed and they are equal once `version` (and the `apps/desktop` entry's `version` in the lockfile) is removed | 5 minutes |
| `integrity`, shown as "Documentation integrity" | pushes to `main` | `actions/checkout`; `actions/setup-node` with `node-version-file: .nvmrc`; then `npm run docs-check -- --integrity-only` | 5 minutes |
| `typescript`, shown as "TypeScript" | both | `actions/checkout`; `actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`; then the steps Install (`npm ci`), Lint (`npm run lint`), Format (`npm run format:check`), Typecheck (`npm run typecheck`), Test (`npm test`, which includes the documentation check's tests), Build (`npm run build`) | 20 minutes |

On `ubuntu-24.04` the `typescript` job took 2 minutes in its first run (17 November 2026). The 20-minute limit dates from the former self-hosted runner, where the job took about 10 minutes (Install about 2, Typecheck about 2, Test about 4) and a 10-minute limit cancelled runs in the middle of Test; it stays as a guard against a hung run.

The two documentation jobs run no `npm ci`: the check imports only Node built-ins, so Node from `actions/setup-node` is all they need. The documentation check's tests run in the `typescript` job with every other test. On a pull request, `actions/checkout` checks out GitHub's merge commit of the branch into the base as it was when the run started. GitHub does not rerun the job when the base moves, so two pull requests that pass alone can break `main` together, for example one renames a heading and the other links to it. The `integrity` job reports that on the push that merges the second one, so the breakage shows up on `main` itself, not first in an unrelated pull request. It does not prevent it: open pull requests turn red on their next run until `main` is fixed.

### Required checks

The repository ruleset `main` (id `27497832`), a copy of [.github/rulesets/main.json](../../.github/rulesets/main.json) ([decision](../decisions/docs.md#ci-checks-are-required-through-a-ruleset-once-the-repository-is-public)), applies to the default branch. It requires "Documentation contract" and "TypeScript" from GitHub Actions, without requiring the branch to be up to date; a pull request with squash merge and no approving review; and it blocks deletion and force pushes. Nobody can bypass it, the owner included. A run of `ci.yml` by hand adds its own "Documentation contract" check run to the branch's commit, and GitHub takes the latest one; that is why the job then fails on anything but a release version branch instead of being skipped, which would count as passing.

GitHub does not read the file. After a change to it, update the ruleset, then compare what GitHub stored with the file. GitHub silently drops fields it does not accept, and it adds default values, which is why the file lists them too. The `diff` prints nothing when the two match:

```sh
gh api -X PUT repos/mateuszsikora/irvis/rulesets/27497832 --input .github/rulesets/main.json
diff <(gh api repos/mateuszsikora/irvis/rulesets/27497832 --jq '{name,target,enforcement,conditions,bypass_actors,rules}' | jq -S .) \
     <(jq -S '{name,target,enforcement,conditions,bypass_actors,rules}' .github/rulesets/main.json)
```

In a new copy of the repository, create it with `gh api -X POST repos/<owner>/<repo>/rulesets --input .github/rulesets/main.json`.

A check that is renamed in `ci.yml` must be renamed in the file in the same pull request: a required check that no job reports blocks every pull request.

### Desktop packages

[.github/workflows/desktop.yml](../../.github/workflows/desktop.yml), "Desktop packages", builds the bundled ffmpeg and the desktop packages on GitHub-hosted runners (macOS, Windows and Ubuntu, [decision](../decisions/architecture.md#desktop-packages-are-built-on-github-hosted-runners)). It has read-only access to the repository contents. It runs on pull requests that change what a package is built from or checked with: `apps/desktop/ffmpeg/`, `apps/desktop/src/`, `apps/desktop/electron-builder.config.mjs`, `apps/desktop/package.json`, `apps/desktop/test/package-smoke.mjs`, the root `package.json` and `package-lock.json` (Electron, electron-builder and node-usb versions), `tools/capture-cli/60-irvis.rules`, `tools/capture-cli/iokit-request.c`, `tools/capture-cli/src/ffmpeg.ts` or the workflow itself. Changes to the web UI and the shared packages bundled into `main.cjs` do not start it; by hand (Actions → "Desktop packages" → "Run workflow", or `gh workflow run desktop.yml --repo mateuszsikora/irvis --ref <branch>`); and as a reusable workflow (`workflow_call`), which [Release](#release) uses. Both of the last two take the boolean input `allow-system-ffmpeg` (default `false`); a call also takes `ref`, the commit that every job checks out (default: the caller's commit), which Release sets to the commit that sets the version.

| Job | Runner | Steps | Timeout |
| --- | --- | --- | --- |
| `ffmpeg`, shown as "ffmpeg <target>", one per target `mac-arm64`, `mac-x64` (both `macos-15`), `linux-x64` (`ubuntu-24.04`), `win-x64` (`windows-2025`) | per target | `git config --global core.autocrlf false` (so that `build.sh` keeps LF endings on Windows); `actions/checkout`; `actions/setup-node` with `.nvmrc`; restores `apps/desktop/ffmpeg/dist/<target>` from the cache key `ffmpeg-<target>-<hash of build.sh>`; on a miss, `apps/desktop/ffmpeg/build.sh <target>` (for `win-x64` in MSYS2 UCRT64 from `msys2/setup-msys2` with make, diffutils, curl, tar, xz and the UCRT64 gcc); `node apps/desktop/ffmpeg/verify.mjs <target>`; on a miss, saves the cache; uploads the artifact `ffmpeg-<target>` | 30 minutes |
| `ffmpeg-source`, shown as "ffmpeg source" | `ubuntu-24.04` | `apps/desktop/ffmpeg/build.sh source`; uploads the artifact `ffmpeg-source` with `ffmpeg-9.0.2.tar.xz` and `build.sh`, for the GitHub Release | 5 minutes |
| `package`, shown as "Package <os>", for `mac`, `linux`, `win`, after `ffmpeg` | `macos-15`, `ubuntu-24.04`, `windows-2025` | `actions/checkout`; `actions/setup-node` with `.nvmrc` and the npm cache; downloads the `ffmpeg-<target>` artifacts of the system by name into `apps/desktop/ffmpeg/dist/<target>` (a pattern matching a single artifact would extract it without its directory); `npm ci`; `npm run package:desktop -- <options>` (see [Packages](../features/desktop-technical.md#packages)); on Linux, checks with `dpkg-deb -c` that the deb holds `./usr/lib/udev/rules.d/60-irvis.rules` and runs the AppImage's `--appimage-extract resources/60-irvis.rules` from the [install instructions](../features/desktop-user.md#install-a-package), comparing the result with `tools/capture-cli/60-irvis.rules`; `node test/package-smoke.mjs` on every unpacked app (under `xvfb-run` on Linux, which it installs if missing), and on Linux once more with `--launch` on the AppImage and `APPIMAGE_EXTRACT_AND_RUN=1`; uploads the artifact `irvis-<os>` with the dmg, exe, zip, AppImage and deb files, named `irvis-<os>-without-ffmpeg` when a target was packaged without ffmpeg | 30 minutes |

Artifacts are kept for 14 days. A cache hit skips the ffmpeg build but not its check. With `allow-system-ffmpeg`, a failing `ffmpeg` job does not stop packaging: the package of that target is built with `IRVIS_PACKAGE_WITHOUT_FFMPEG=1`, and the smoke test runs with `--ffmpeg-optional` ([fallback](../features/desktop-user.md#use-your-own-ffmpeg)). Such a target gets a warning annotation, a line in the job summary and the `-without-ffmpeg` artifact suffix. Without it, a failing `ffmpeg` job skips every package. The path filter keeps the workflow off pull requests that do not touch packaging.

The packages name `https://github.com/mateuszsikora/irvis/releases` as the place of the ffmpeg source (in `resources/ffmpeg/README.txt` and `NOTICE`). [Release](#release) publishes the tarball and `build.sh` there next to the packages, together with the node-usb source for libusb. Give packages to others only from a published GitHub Release, the place that `README.txt` and `NOTICE` name for the sources; a draft is not public. The cache key depends only on `build.sh`, so a new compiler in a runner image does not rebuild a cached ffmpeg; `verify.mjs` still checks it on every run.

## Netlify

`netlify.toml` configures a Netlify build of `apps/web`: a deploy preview for every pull request, and production only from the branch `release` ([decision](../decisions/architecture.md#the-web-version-is-hosted-on-netlify-and-goes-to-production-from-release)). The build settings are in `netlify.toml`, and the settings that only the Netlify UI has are listed in [web app: technical](../features/web-app-technical.md#netlify). The repository is not connected to Netlify and will not be: the web version is to be published on GitHub Pages instead ([#54](https://github.com/mateuszsikora/irvis/issues/54)), and until then nothing deploys it.

## Promote to release

[.github/workflows/promote.yml](../../.github/workflows/promote.yml), "Promote to release", moves `release` to a commit on `main`. A Netlify site with the production branch `release` would publish that commit, but no site is connected ([Netlify](#netlify)), so moving `release` publishes nothing. [Release](#release) calls it (`workflow_call`, input `sha`) with the commit of a published release's tag; otherwise it runs only by hand: Actions → "Promote to release" → "Run workflow", or

```sh
gh workflow run promote.yml --repo mateuszsikora/irvis            # the tip of main
gh workflow run promote.yml --repo mateuszsikora/irvis -f sha=<sha>
```

The job "Promote to release" (5 minutes) is the only one with `contents: write`; the workflow default is `contents: read`. Its runs, by hand or from Release, share the concurrency group `promote-to-release` without cancelling the running one: at most one waits, and a newer run cancels the waiting one. The group is set on the job, so that it also holds in a called workflow. Its step "Fast-forward release":

1. fails with `run this workflow from main, not from <ref>` unless it was started by hand from `main` or called by Release for a published release of a tag `v*` (whose commit steps 3 and 4 still check); a run by hand from another branch (`gh workflow run --ref` or the branch menu in "Run workflow") stops here;
2. fails with `the sha input must be 7 to 40 lowercase hexadecimal digits` unless `sha` is empty or such a string;
3. `git fetch origin main`, then resolves `sha` (empty means `origin/main`), and fails with `<sha> is not a commit in this repository` if it cannot;
4. fails with `<sha> is not on main; only commits on main are published` unless `git merge-base --is-ancestor <sha> origin/main` holds;
5. `git push origin <sha>:refs/heads/release`, without `--force`. The first run creates `release`. Later runs succeed only if `release` fast-forwards to the commit, so the workflow never moves `release` to a commit off `main` or back to an older one. A rejected push fails the step with git's `! [rejected] ... (non-fast-forward)`.

These checks bind the workflow, not the people who can write to the repository. `release` is not protected (branch protection and rulesets return HTTP 403 on this plan, and the ruleset for the public repository covers only `main`, see [Required checks](#required-checks)), so anyone with write access can still `git push origin <commit>:release`. A run started from another branch uses that branch's copy of `promote.yml`, with `contents: write`, and a changed copy can drop every check above. That only commits on `main` reach `release` is therefore a rule for contributors, like the other rules in [CONTRIBUTING.md](../../CONTRIBUTING.md#repository-settings). Protecting `release` waits for [#54](https://github.com/mateuszsikora/irvis/issues/54), which may remove the branch ([decision](../decisions/docs.md#ci-checks-are-required-through-a-ruleset-once-the-repository-is-public)).

A push made with the workflow's `GITHUB_TOKEN` starts no other workflow, so a workflow triggered by a push to `release` would not run after a promotion.

## Release

[.github/workflows/release.yml](../../.github/workflows/release.yml), "Release", makes a release in two steps ([decision](../decisions/architecture.md#a-release-is-a-draft-github-release-built-from-a-version-commit-on-main)):

1. **Run it** from `main`: Actions → "Release" → "Run workflow", optionally with a version, or `gh workflow run release.yml --repo mateuszsikora/irvis [-f version=0.2.0]`. It merges a pull request that sets the version, builds the desktop packages from that commit and leaves a draft GitHub Release with the packages, the ffmpeg source and the node-usb source with libusb. The run's summary links the draft.
2. **Publish the draft**: Releases → the draft → edit → "Publish release". Publishing creates the tag `v<version>` on the version commit and, unless it is a prerelease, moves `release` ([Promote to release](#promote-to-release)).

To discard a release before it is published, delete the draft. `main` keeps the version; run the workflow again with the same version to rebuild the draft without another pull request. A run with an empty version always takes the next patch version, so a second such run (or a rerun of one that merged its pull request) makes a new version, not a new draft of the same one.

The workflow needs the repository setting "Allow GitHub Actions to create and approve pull requests" (Settings → Actions → General → Workflow permissions), which is off by default; without it, opening the pull request fails. Check it with `gh api repos/mateuszsikora/irvis/actions/permissions/workflow`: `can_approve_pull_request_reviews` must be `true` ([Repository settings](../../CONTRIBUTING.md#repository-settings)).

The workflow default is `contents: read`. Runs of the same event share the concurrency group `release-<event>` without cancelling the running one: at most one run waits, and a newer run cancels the waiting one.

| Job | Runs on | Runner | Steps | Timeout |
| --- | --- | --- | --- | --- |
| `version`, shown as "Set the version", with `actions: write`, `contents: write` and `pull-requests: write` | a run by hand | `ubuntu-24.04` | `actions/checkout` of `refs/heads/main`, the tip of `main` when the job starts, not the commit the run was started on, so that a waiting run or a rerun sees the version an earlier run merged; the steps "Choose the version" and "Merge the version pull request", below | 30 minutes, which includes the CI run on the version branch |
| `packages`, shown as "Packages", after `version` | a run by hand | as in [Desktop packages](#desktop-packages) | calls `desktop.yml` with `allow-system-ffmpeg: false` (a failing ffmpeg build skips every package, and so the draft) and `ref` set to the version commit | as there |
| `draft`, shown as "Draft release", after both, with `contents: write` | a run by hand | `ubuntu-24.04` | downloads the artifacts `irvis-mac`, `irvis-win`, `irvis-linux` and `ffmpeg-source` by name (a package without ffmpeg is named `-without-ffmpeg` and is never picked up); checks out `.nvmrc` and `package-lock.json` of the version commit into `source/` (without keeping the token in its git configuration) and sets up that Node; the step "Fetch the node-usb source", below; then the step "Create the draft release", below | 15 minutes |
| `promote`, shown as "Promote to release", with `contents: write` | a published release of a tag `v*` that is not a prerelease | `ubuntu-24.04` | calls `promote.yml` with `sha` set to the tag's commit ([Promote to release](#promote-to-release)) | 5 minutes |

The step "Choose the version":

1. fails with `run this workflow from main, not from <ref>` when it was started from another branch;
2. takes the input without a leading `v`; an empty input means the next patch version of `apps/desktop/package.json` (`0.1.0` → `0.1.1`; `0.2.0-rc.1` → `0.2.0`, as `npm version patch` does);
3. fails with `<version> is not a version: use <major>.<minor>.<patch>, optionally with -<prerelease>` unless it is a [semantic version](https://semver.org/spec/v2.0.0.html) without build metadata (numbers without leading zeros, as in `1.2.3` or `1.2.3-rc.1`, not `01.2.3` or `1.2.3-01`; no empty prerelease identifiers, as in `1.2.3-a..b`) and `chore/release-<version>` is a valid branch name (`git check-ref-format`);
4. fails with `<version> is lower than the current version <current>` when it is lower by semantic version precedence: `0.2.0-rc.1` is lower than `0.2.0` and than `0.2.0-rc.2`, and `0.2.0-rc.10` is higher than `0.2.0-rc.9`; the current version itself passes;
5. fails with `the tag v<version> already exists: choose another version` when the tag is on GitHub, that is, when that version was published, and with `could not list the tags of origin (git ls-remote exited with <code>)` when `git ls-remote` fails for another reason than a missing tag;
6. treats a version with `-` as a prerelease.

The step "Merge the version pull request":

1. does nothing when `apps/desktop/package.json` already holds the version (the draft is then built from the checked-out tip of `main`);
2. fails with `the branch chore/release-<version> is left from an earlier run: close its pull request if it has one, delete the branch and run again` when that branch exists;
3. sets `version` in `apps/desktop/package.json` and the `apps/desktop` entry of `package-lock.json`, commits them as `github-actions[bot]` with the message `chore(release): set the version to <version>`, pushes `chore/release-<version>` and opens a pull request with the same title. If opening it fails, it deletes the pushed branch again and fails with `could not open the pull request; is "Allow GitHub Actions to create and approve pull requests" on?`;
4. starts CI on the branch (`gh workflow run ci.yml --ref chore/release-<version>`), looks for that run of the version commit for up to a minute, and fails with `CI did not start on chore/release-<version>; close <url>, delete the branch and run again` if there is none. It then waits for the run (`gh run watch --exit-status`) and fails with `CI failed on <url> (<run url>); fix main, close the pull request, delete the branch and run again` if the run fails;
5. squash-merges it with `gh pr merge --squash`, retrying up to five times five seconds apart while GitHub computes whether it can be merged, then fails with `could not merge <url>`; GitHub deletes the branch after the merge;
6. hands the merge commit to the later jobs.

The pull request is opened and merged with the workflow's `GITHUB_TOKEN`, and events made with that token start no workflow apart from `workflow_dispatch`. So nothing runs on the pull request by itself, and the push to `main` starts no workflow either. Step 4 starts CI so that the [required checks](#required-checks) report on the version commit: "TypeScript" runs, and "Documentation contract" checks that the branch changes nothing but the two versions. The pull request is exempt from the pull request rules ([CONTRIBUTING.md](../../CONTRIBUTING.md#what-reaches-main)). The documentation contract itself would fail on it: the version-bump filter accepts only the dependency fields of a `package.json` ([documentation contract](../features/docs-contract-technical.md#version-bump-filter)), so `version` in `apps/desktop/package.json` needs a desktop document under rule F7. [Documentation integrity](#ci) runs on `main` again with the next merged pull request. A left-over pull request and branch of a failed step 4 or 5 make the next run stop at step 2.

The step "Fetch the node-usb source" exists because the node-usb prebuilds in the packages link libusb (LGPL-2.1-or-later) statically ([Packages](../features/desktop-technical.md#packages)). It reads the version and `integrity` of `node_modules/usb` from the version commit's `package-lock.json`, runs `npm pack usb@<version>`, which downloads the published package `usb-<version>.tgz` (node-usb's source with libusb's, and what rebuilds the prebuild) into the assets, and fails with `usb-<version>.tgz from the registry is not the package in package-lock.json` when the integrity of the download differs.

The step "Create the draft release":

1. fails with `the packages hold <n> files matching <pattern> instead of one` unless the downloaded files include exactly one of each: `irvis-<version>-mac-arm64.dmg`, `irvis-<version>-mac-x64.dmg`, `irvis-<version>-win-x64.exe`, `irvis-<version>-win-x64.zip`, `irvis-<version>-linux-x86_64.AppImage`, `irvis-<version>-linux-amd64.deb`, `ffmpeg-*.tar.xz`, `build.sh` and `usb-*.tgz`. Only these nine files are released; anything else in the artifacts is left out;
2. deletes every draft release of the tag `v<version>`, which an earlier run of the same version leaves behind;
3. `gh release create v<version> <the nine files> --draft --target <version commit> --title "irvis <version>" --generate-notes`, with `--prerelease` for a prerelease, and with a first paragraph that the packages are unsigned, links to [Install a package](../features/desktop-user.md#install-a-package) at the tag, and says that the packages carry an LGPL ffmpeg and node-usb with the LGPL libusb, and that the ffmpeg source tarball, its `build.sh` and the node-usb source package are attached. GitHub writes the rest of the notes from the pull requests merged since the previous release. The draft has no tag until it is published. The run's summary gives its URL and says whether publishing it moves `release`.

Publishing starts the workflow again with the `release` event, from the tagged commit's copy of the file. A prerelease (marked as such on the draft, which the workflow does for a version with `-`; the box can also be changed before publishing) does not move `release`. If "Promote to release" fails, for example because `release` already holds a newer commit of `main` and the fast-forward is rejected, the GitHub Release stays published and production stays where it was; promote by hand if needed.

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

`npm run spike:m3:desktop` builds the shared web UI and the Electron main/preload bundles, then opens the desktop window. Node 26+ and system ffmpeg are required for the macOS capture spike. Electron, electron-builder, esbuild and Playwright are desktop workspace development dependencies, and so is `@irvis/core`, which esbuild bundles. The browser-safe `@irvis/backend-electron` package is a TypeScript project reference of the web app; ESLint rejects Electron/Node imports and dynamic imports there. The sandboxed preload alone uses CommonJS require.

Run `npm run test:desktop` after desktop or comparison changes. Expected output: `desktop smoke: build, bridge isolation, module Worker, fetch, localStorage, video and CSP passed` and exit code 0. It generates a temporary video in the built web directory using ffmpeg. Run the usual lint, formatting, typecheck, unit tests, build and docs-check too. Hardware verification follows [M3](../findings/m3.md).

## Shared viewer packages

`packages/ui` exports the React viewer and `packages/backend-replay` exports an in-memory camera backend. Both are source workspace dependencies of `apps/web`, with TypeScript build references in the root solution and web app. Their tests join the existing Vitest workspace discovery; UI tests use jsdom and Testing Library. The same Vite output detects the desktop preload at runtime.


Photo library tests use the development-only `fake-indexeddb` dependency to exercise IndexedDB transactions without a browser. It is not bundled into the application; run the existing `npm test` command.

## Media package

The solution includes `packages/media`, a DOM-capable npm workspace for recording storage and MP4 export. UI and web reference its declaration build. Mediabunny is an MPL-2.0 dependency used without source changes. Only media's TypeScript projects use `skipLibCheck` to avoid duplicate transitive WebCodecs/DOM declarations; source checking remains strict.

### Cross-runtime acceptance

`npm run test:parity` runs the separate Vitest/Playwright Node, Chromium, WebKit and Electron comparison. Install browsers with `npx playwright install chromium webkit` first; see [the testing guide](testing.md#cross-runtime-acceptance-21) for system dependencies, exact comparison semantics and scope. This command is a local acceptance check and is not currently run by CI.

# Testing guide

For anyone who runs or adds tests in this repository. Every test is a Vitest test, the documentation check's included.

## Run the suite

```sh
npm ci                     # once, and after every change to package-lock.json
npm test
```

`npm test` runs `vitest run`. The root `vitest.config.ts` makes every directory in `packages/*`, `apps/*` and `tools/*` a Vitest project; each package's own config names it and picks its environment:

| Project | Config | Environment | Files |
| --- | --- | --- | --- |
| `core` | `packages/core/vitest.config.ts` | `node`, 60 seconds per test and hook | `src/**/*.test.ts`, `test/**/*.test.ts` |
| `web` | `apps/web/vite.config.ts` (`test`) | `jsdom` | `src/**/*.test.{ts,tsx}` |
| `docs-check` | `tools/docs-check/vitest.config.ts` | `node`, 60 seconds per test | `src/**/*.test.ts`, `test/**/*.test.ts` |
| `capture-cli` | `tools/capture-cli/vitest.config.ts` | `node`, 60 seconds per test | `src/**/*.test.ts`, `test/**/*.test.ts` |

Vitest prints one line per test file and ends with `Test Files  <n> passed (<n>)` and `Tests  <n> passed (<n>)`, or the failures with a diff. One project, one file, or the tests whose names match a pattern:

```sh
npx vitest run --project core
npx vitest run packages/core/src/cameras/validate.test.ts
npx vitest run -t "matchProfiles"
npx vitest                  # watch mode: reruns the tests a change affects
```

Vitest only transpiles; it does not type-check. Run `npm run typecheck` as well, which includes the test files.

## What each test file needs

Most tests need nothing beyond `npm ci`. The documentation check's tests need more:

| Files | Needs | Notes |
| --- | --- | --- |
| `tools/docs-check/test/rules.test.ts`, `bumps.test.ts`, `integrity.test.ts`, `paths.test.ts` | git 2.32 or later and `node` on `PATH`, a writable temporary directory | `test/repo.ts` copies this repository's working tree, tracked and untracked files that git does not ignore, into a temporary repository with one commit on `main` and a branch `feature`, and runs the copied `tools/docs-check/src/check-docs.ts` there. Uncommitted changes in your checkout are part of the copy, so a broken document in your working tree fails `this repository::integrity of this repository` and may fail other tests too. |
| `tools/docs-check/test/decisions-index.test.ts` | a writable temporary directory | Plain files, no git. |
| `tools/docs-check/test/eslint.test.ts` | `npm ci` | Lints snippets with the repository's ESLint configuration. |
| `tools/capture-cli/test/report.test.ts`, `tools/capture-cli/src/ffmpeg.test.ts` | a writable temporary directory | Synthetic capture directories and a fake `ffmpeg` file; no camera, no ffmpeg and no macOS. |

`test/repo.ts` runs git with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`, a fixed author and committer, and without `CI`, `SKIP_DOCS_CHECK` and the other `GIT_*` variables. Your git configuration (signing, hooks, default branch) and a `CI` variable in your shell do not affect the results. These tests take most of the run time (about 20 seconds), because each builds a git repository and runs `node`; Vitest runs the test files in parallel.

## Add a TypeScript test

- Put it next to the code as `<name>.test.ts`, or in the package's `test/` directory if it needs Node APIs (`node:fs`, ESLint) or is a helper shared by several tests. In core, a test under `src/` may import only relative paths, `fflate` and `vitest`; ESLint rejects anything else, Node modules included. Both kinds need no documentation ([left out on purpose](../features/README.md#left-out-on-purpose)).
- Import `describe`, `it` and `expect` from `vitest`; there are no globals.
- A test that enforces a rule of the domain goes into [docs/invariants.md](../invariants.md) by its id, `<path>::<describe>::<it>` ([documentation guide](documentation.md#invariants)). Such a test has a plain string literal as its name, in `describe("...")` and `it("...")`, not a template literal or `it.each`: `npm run docs-check` finds the names by text ([decision](../decisions/docs.md#vitest-test-ids-are-checked-by-text-search)).
- For the documentation check, use `Repo` from `tools/docs-check/test/repo.ts` and its helpers: `write`, `append`, `replace`, `read`, `commit`, `git`, `check`, `passes`, `fails(<rule id>)`, `integrityFails(<text>)`; create the template once per file with `makeTemplate` in `beforeAll`.
- Test fixtures that contain a broken reference must not put it in a comment of the test file itself, or the integrity check of the real repository fails on the test file. Build such strings from parts, as `tools/docs-check/test/integrity.test.ts` does.
- A new package gets a Vitest project by having a `vitest.config.ts` (or a `test` section in its `vite.config.ts`) with a `name`; without one, Vitest still runs the package's `*.test.*` files with its defaults (environment `node`). Either way, add the package to `ALLOWED_IRVIS` in `packages/core/test/package-dependencies.test.ts`, or that test fails.

## Shared runner load

CI runs on shared GitHub-hosted runners, which can be slower than a development machine and vary from run to run (the former self-hosted runner was also busy with other work). Functional tests must assert results, not elapsed wall-clock time. Core allows 60 seconds per test and hook, including the synthetic reconstruction sweep and exhaustive `.irvis` truncation recovery test. This is a hang guard, not a performance target. Keep deterministic coverage when a loaded runner exceeds Vitest's default five-second timeout; do not fix it by skipping cases, weakening assertions or adding retries.

Use fake timers or explicit synchronization for timer-driven behaviour instead of short real sleeps. Record algorithm timing in the separate non-gating benchmarks with the machine identity and workload. A runtime measured on an idle development machine is not a reliable CI timeout budget.

## React component tests

React components are tested with [Testing Library](https://testing-library.com/docs/react-testing-library/intro/) in jsdom, as `apps/web/src/App.test.tsx` does:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';

afterEach(cleanup);

describe('App', () => {
  it('names the app', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('irvis');
  });
});
```

- Call `cleanup` after each test yourself: without Vitest globals, Testing Library cannot register it.
- Query by role and visible text (`getByRole`, `getByText`), as a user finds things, not by class names.
- In a wait (`findBy…`, `waitFor`) on a large tree such as the `Viewer`, query by text and pin the element with `selector` (`findByText(/^Analyze /, { selector: 'button' })`). A first `ByRole` query computes accessible names for the whole tree and can take a large part of the wait's timeout on the CI runner ([UI tests](../features/ui-technical.md#tests)).
- `@testing-library/jest-dom` is not installed; assert on properties such as `textContent`.
- The package needs `environment: 'jsdom'` in its Vitest project, and `jsdom`, `@testing-library/react` and `@testing-library/dom` in its `devDependencies`.

## See also

- [Development guide](development.md): setup and CI.
- [Technical document of the documentation contract](../features/docs-contract-technical.md#tests): what the tests cover and what they do not.

## Media browser integration

Run `node packages/media/test/browser.mjs` from the repository root after `npx playwright install chromium`. It needs ffprobe on PATH and an unused localhost port 4179. The script starts Vite, launches headless Chromium with a fake microphone, and drives recording → OPFS → playback/export → deletion plus capture → gallery → annotation/analysis. It inspects MP4 tracks with ffprobe and checks that the microphone tracks ended after Stop. Silent output has only video; microphone output includes AAC. The test uses a synthetic scene, not real hardware, and does not establish a crash-loss bound or Safari support.

The media browser test also opens a two-frame file with a recorded correction change, adds measurements across forward/backward seeks, edits and deletes the selected point, and verifies distinct IDs and temperature readouts without duplicate React keys.

## Cross-runtime acceptance (#21)

```sh
npx playwright install chromium webkit
npm run test:parity
```

Use Node 26 or later. Electron comes from `npm ci`; Linux also needs the Playwright system libraries (`npx playwright install --with-deps chromium webkit`) and a display server for Electron (for example `xvfb-run -a npm run test:parity`). This is a separate Vitest Node suite, not part of `npm test`; missing browsers fail rather than skip it. Vite uses an ephemeral localhost port. The test allows 180 seconds for the whole matrix and 10 seconds per replay delivery.

`packages/ui/test/parity/parity.integration.mjs` computes the Node reference during the same Vitest run, then drives Chromium (V8), WebKit (JavaScriptCore) and an isolated Electron renderer with Playwright. Each reads the committed `fixtures/infiray-p2pro/static-wall/lossless-v1.irvis` through `backend-replay.openRecording`: ten recorded frames followed by a backward seek and a seek to the end. Every raw value, frame metadata, converted/corrected pixel, whole-frame statistic, centre/edge point, diagonal line, area and histogram must match Node. Both identity correction and emissivity 0.73, reflected temperature 18 °C, offset 1.25 K are exercised.

JSON numbers are encoded as big-endian IEEE-754 binary64 hexadecimal strings, preserving negative zero and non-finite values rather than rounding readings or converting NaN to null. There are no approved arithmetic exceptions in this scenario, so no tolerance is applied. A future exception must cite its decision and use an explicit tolerance only for the affected outputs; raw values and the existing exact path remain exact. Artifacts are written to `.context/parity/{node,chromium,webkit,electron}.json` before comparison.

For each of the ten frames, the same React `Viewer` is mounted with `createReplayBackend([frame])`. Playwright starts it, enables min/max/centre tracking, selects °C, °F and K, compares visible measurement text with Node and stops it. Renderer exceptions fail the test. Electron uses a test-only shell with sandbox and context isolation enabled and Node integration disabled; it loads the same Vite-served UI as the browsers. The production preload is checked separately by `npm run test:desktop`, and the desktop packages by their [package tests](../features/desktop-technical.md#package-tests).

This is M4 acceptance for the recorded exact path, shared UI wiring and V8/JavaScriptCore arithmetic parity. It does not validate live camera capture, USB commands, planar reconstruction accuracy, Safari device APIs, MP4 export or physical temperature accuracy. Real camera backends remain covered by the spikes and the M5 hardware checklist described in the roadmap.

# Testing guide

For anyone who runs or adds tests in this repository. There are two suites: Python `unittest` for the documentation check and the decisions index generator, and Vitest for the TypeScript code.

## Run the suite

```sh
make test
```

This runs `python3 -m unittest discover -s tests -v`: every `tests/test_*.py` file. The last line is `OK` when every test passed, or `FAILED (failures=<n>, errors=<n>)`. One file, one class or one test:

```sh
python3 -m unittest discover -s tests -p test_decisions_index.py
cd tests && python3 -m unittest test_check_docs.CatchAllTests
cd tests && python3 -m unittest test_check_docs.CatchAllTests.test_moved_doc_is_not_new
```

The tests use `unittest` from the standard library; nothing has to be installed ([why](../decisions/docs.md#tests-use-unittest-from-the-standard-library)).

## What each test file needs

| File | Needs | Notes |
| --- | --- | --- |
| `tests/test_check_docs.py` | git 2.32 or later on `PATH`, a writable temporary directory | Copies this repository's working tree, tracked and untracked files that git does not ignore, into a temporary repository with one commit on `main` and a branch `feature`, then runs the copied `scripts/check-docs.py` there. Uncommitted changes in your checkout are part of the copy, so a broken document in your working tree fails `RealRepositoryTests` and may fail other tests too. |
| `tests/test_decisions_index.py` | a writable temporary directory | Plain files, no git. |

`tests/test_check_docs.py` runs git with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`, a fixed author and committer, and without `CI` and `SKIP_DOCS_CHECK`. Your git configuration (signing, hooks, default branch) and a `CI` variable in your shell do not affect the results. Most of the run time goes to `tests/test_check_docs.py`, which builds a git repository for each test.

## Add a test

- Put it in `tests/test_<area>.py` as a method of a `unittest.TestCase`. Files under `tests/` need no documentation; the [ownership map](../features/README.md#left-out-on-purpose) leaves them out.
- For the documentation check, subclass `RepoCase` and use its helpers: `write`, `append`, `replace`, `commit`, `git`, `check`, `assertPasses`, `assertFails(<rule id>)`.
- A test that enforces a rule of the domain goes into [docs/invariants.md](../invariants.md) by its id, `tests/<file>.py::<Class>::<test>` (a Vitest test: `<path>::<describe>::<it>`, see [below](#add-a-typescript-test) and the [documentation guide](documentation.md#invariants)).
- Test fixtures that contain a broken reference must not put it in a comment of the test file itself, or the integrity check of the real repository fails on the test file. Build such strings from parts, as `tests/test_check_docs.py` does.

## TypeScript tests

```sh
npm ci                     # once, and after every change to package-lock.json
make js-test               # or: npm test
```

`npm test` runs `vitest run`. The root `vitest.config.ts` makes every directory in `packages/*` and `apps/*` a Vitest project; each package's own config names it and picks its environment:

| Project | Config | Environment | Files |
| --- | --- | --- | --- |
| `core` | `packages/core/vitest.config.ts` | `node` | `src/**/*.test.ts`, `test/**/*.test.ts` |
| `web` | `apps/web/vite.config.ts` (`test`) | `jsdom` | `src/**/*.test.{ts,tsx}` |

Vitest prints one line per test file and ends with `Test Files  <n> passed (<n>)` and `Tests  <n> passed (<n>)`, or the failures with a diff. One project, one file, or the tests whose names match a pattern:

```sh
npx vitest run --project core
npx vitest run packages/core/src/cameras/validate.test.ts
npx vitest run -t "matchProfiles"
npx vitest                  # watch mode: reruns the tests a change affects
```

Vitest only transpiles; it does not type-check. Run `make typecheck` as well, which includes the test files.

### Add a TypeScript test

- Put it next to the code as `<name>.test.ts`, or in the package's `test/` directory if it needs Node APIs (`node:fs`, ESLint) or is a helper shared by several tests. In core, a test under `src/` may import only relative paths, `fflate` and `vitest`; ESLint rejects anything else, Node modules included. Both kinds need no documentation ([left out on purpose](../features/README.md#left-out-on-purpose)).
- Import `describe`, `it` and `expect` from `vitest`; there are no globals.
- A test that enforces an invariant has a plain string literal as its name, in `describe("...")` and `it("...")`, not a template literal or `it.each`: `make docs-check` finds the names by text ([decision](../decisions/docs.md#vitest-test-ids-are-checked-by-text-search)).
- A new package gets a Vitest project by having a `vitest.config.ts` (or a `test` section in its `vite.config.ts`) with a `name`; without one, Vitest still runs the package's `*.test.*` files with its defaults (environment `node`). Either way, add the package to `ALLOWED_IRVIS` in `packages/core/test/package-dependencies.test.ts`, or that test fails.

### React component tests

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
- `@testing-library/jest-dom` is not installed; assert on properties such as `textContent`.
- The package needs `environment: 'jsdom'` in its Vitest project, and `jsdom`, `@testing-library/react` and `@testing-library/dom` in its `devDependencies`.

## See also

- [Development guide](development.md): setup and CI.
- [Technical document of the documentation contract](../features/docs-contract-technical.md#tests): what the tests cover and what they do not.

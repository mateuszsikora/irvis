# Testing guide

For anyone who runs or adds tests in this repository. The tests cover the documentation check and the decisions index generator, which is all the code irvis has so far.

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
- A test that enforces a rule of the domain goes into [docs/invariants.md](../invariants.md) by its id, `tests/<file>.py::<Class>::<test>` (a Vitest test, once there is TypeScript code: `<path>::<describe>::<it>`, see the [documentation guide](documentation.md#invariants)).
- Test fixtures that contain a broken reference must not put it in a comment of the test file itself, or the integrity check of the real repository fails on the test file. Build such strings from parts, as `tests/test_check_docs.py` does.

## See also

- [Development guide](development.md): setup and CI.
- [Technical document of the documentation contract](../features/docs-contract-technical.md#tests): what the tests cover and what they do not.

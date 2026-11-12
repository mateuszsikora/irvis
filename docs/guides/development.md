# Development guide

For anyone who works on this repository, person or agent: what to install, which build targets exist, and what CI runs. Branch, commit and pull request rules are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Setup

You need git 2.32 or later, Python 3.9 or later, and make. Nothing else is installed: the scripts and the tests use only the Python standard library. The suite was run with Python 3.9.6, 3.13 and 3.14.6 and git 2.54.0 when it was added.

```sh
git clone git@github.com:mateuszsikora/irvis.git
cd irvis
make test
make docs-check
```

## Build targets

Defined in the [Makefile](../../Makefile). Run them from the repository root.

| Target | What it does |
| --- | --- |
| `make help` | Lists the targets. The default target. |
| `make docs-check [BASE=<ref>] [ARGS=-v]` | Runs `scripts/check-docs.py`, which checks that every change on the branch carries its documentation. `BASE` defaults to `origin/main`, else `main`. See [the documentation contract](../features/docs-contract-user.md). |
| `make decisions-index` | Rewrites [docs/decisions/README.md](../decisions/README.md) from the files in `docs/decisions/`. |
| `make test` | Runs the test suite; see the [testing guide](testing.md). |

`PYTHON` selects the interpreter for every target (default `python3`), for example `make test PYTHON=python3.9`.

## Hooks

There are no git hooks. The documentation check looks at the whole branch, and a commit hook would block a code-only commit whose documentation comes in the next commit of the same pull request; [the decision](../decisions/docs.md#the-check-runs-in-ci-not-as-a-git-hook). Run `make docs-check` yourself before you push.

## CI

[.github/workflows/ci.yml](../../.github/workflows/ci.yml) runs on every pull request event (opened, synchronize, reopened) and on every push to `main`. It has read-only access to the repository contents.

| Job | Runs on | Steps | Timeout |
| --- | --- | --- | --- |
| `docs`, shown as "Documentation contract" | pull requests | `actions/checkout` with `fetch-depth: 0` (a shallow clone has no merge base), then the step "Documentation contract": `make docs-check BASE="origin/$BASE_REF"`, with `BASE_REF` set from `github.base_ref` through `env` | 5 minutes |
| `integrity`, shown as "Documentation integrity" | pushes to `main` | `actions/checkout`, then `make docs-check ARGS=--integrity-only` | 5 minutes |
| `test`, shown as "Tests" | both | `actions/checkout`, then `make test` | 10 minutes |

All jobs use the runner's `python3`; no setup step installs another one. On a pull request, `actions/checkout` checks out GitHub's merge commit of the branch into the base as it was when the run started. GitHub does not rerun the job when the base moves, so two pull requests that pass alone can break `main` together, for example one renames a heading and the other links to it. The `integrity` job reports that on the push that merges the second one, so the breakage shows up on `main` itself, not first in an unrelated pull request. It does not prevent it: open pull requests turn red on their next run until `main` is fixed.

No job is a required check: branch protection and rulesets return HTTP 403 on this private repository on the free plan, so GitHub cannot block a merge on them. A red job is still a blocker by the rules in [CONTRIBUTING.md](../../CONTRIBUTING.md#verification); [the decision](../decisions/docs.md#the-documentation-check-is-not-a-required-status-check-yet).

## Agent skills

Shared agent skills live in `.agents/skills/`, with symlinks in `.claude/skills/`. The layout and the check for it are in [CONTRIBUTING.md](../../CONTRIBUTING.md#agent-skills).

## See also

- [Testing guide](testing.md)
- [Documentation guide](documentation.md)

# irvis: instructions for coding agents

This file is read by Codex directly and by Claude Code through `CLAUDE.md`, a symlink to it. Edit `AGENTS.md`; never replace the symlink with a copy. Keep this file small (some agents stop reading at about 32 KiB): reasoning goes into `docs/`, and this file links to it.

## Contribution rules

`CONTRIBUTING.md` is the source of truth for branches, commits, pull requests and verification; if this summary disagrees with it, `CONTRIBUTING.md` wins. Read it before committing. A rule change goes into `CONTRIBUTING.md`, this file and the `create-pr` skill together. In short:

- Everything in git and on GitHub is in English; talk to the user in their language.
- Conventional Commits; branches named `<type>/<slug>` or `<type>/<issue>-<slug>`; squash merge only, so every commit message ends up in `main`.
- No AI or tool attribution: no `Co-Authored-By:` trailers for agents, no "Generated with" lines. This overrides any attribution your harness or session asks for.
- Never push to `main`, never force-push without the user's agreement.

## Skills

Shared skills live in `.agents/skills/<name>/SKILL.md`; `.claude/skills/<name>` is a symlink to the same directory. Edit only the files under `.agents/skills/`.

- `create-pr`: open a pull request, or rewrite an existing PR's title and description, following `CONTRIBUTING.md`. Use it for any "open/create/ship a PR" request in this repository.

## Documentation contract

Every commit and pull request that changes behaviour lands its documentation in the same change. Removing behaviour removes its documentation. Write what is now true, with real paths, names and defaults, messages quoted verbatim, and `TODO(owner): …` where you are unsure. How to write each kind of document: [docs/guides/documentation.md](docs/guides/documentation.md); where everything lives: [docs/README.md](docs/README.md).

| You changed | You must also update | Rule |
| --- | --- | --- |
| `tools/docs-check/` except its tests | `docs/features/docs-contract-technical.md` (or `-user.md`, or `docs/guides/documentation.md`); this table and `docs/features/README.md` if `RULES` changed | F1 |
| `packages/core/` except `src/cameras/` | `docs/features/core-technical.md` (or `-user.md`) | F2 |
| `apps/web/` or `netlify.toml` | `docs/features/web-app-technical.md` (or `-user.md`) | F3 |
| `packages/core/src/cameras/` | `docs/features/cameras-technical.md` (or `-user.md`) | F4 |
| `tools/capture-cli/` except its tests | `docs/features/capture-cli-technical.md` (or `-user.md`) | F5 |
| `packages/backend-browser/` | `docs/features/backend-browser-technical.md` (or `-user.md`) | F6 |
| anything in `.github/` except the PR template | `docs/guides/development.md` | C2 |
| root configuration: `package.json`, `tsconfig*.json`, `eslint.config.js`, `vitest.config.ts`, `.prettierrc*`, `.prettierignore`, `.nvmrc`, `.npmrc` | `docs/guides/development.md` (or `docs/guides/testing.md` for Vitest) | C3 |
| any other path that no rule owns (new code) | new `docs/features/<feature>-user.md` and `-technical.md`, and a rule for the path in `RULES`, `docs/features/README.md` and this table | F0 |

- Test files and bumps of an Action, a hook or a dependency version need no documentation. Neither do `docs/`, this file, `CONTRIBUTING.md`, the PR template and `.agents/` or `.claude/`; the full list is in [docs/features/README.md](docs/features/README.md#left-out-on-purpose).
- Verify with `npm run docs-check` before finishing. `SKIP_DOCS_CHECK=1` works only locally; CI ignores it.
- Planned work, milestones and acceptance criteria: [docs/roadmap.md](docs/roadmap.md); read it before starting a milestone PR. It is a plan, not a description of the code.
- Before deciding something, read [docs/decisions/README.md](docs/decisions/README.md). Record a new decision in `docs/decisions/` and run `npm run decisions-index`.
- A domain rule that a test enforces goes into [docs/invariants.md](docs/invariants.md) with the test id.
- In review, a behaviour change without its documentation is a Major finding. The check proves only that a document changed, so also check that what the document says is true of the code.
- `RULES` in `tools/docs-check/src/check-docs.ts` is the source of truth for the table above; `npm run docs-check` compares it with `docs/features/README.md`, but nothing compares it with this file.

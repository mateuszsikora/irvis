# irvis: instructions for coding agents

This file is read by Codex directly and by Claude Code through `CLAUDE.md`, which imports it. Put agent instructions here, not in `CLAUDE.md`.

## Contribution rules

`CONTRIBUTING.md` is the source of truth for branches, commits, pull requests and verification; if this summary disagrees with it, `CONTRIBUTING.md` wins. Read it before committing. A rule change goes into `CONTRIBUTING.md`, this file and the `create-pr` skill together. In short:

- Everything in git and on GitHub is in English; talk to the user in their language.
- Conventional Commits; branches named `<type>/<slug>` or `<type>/<issue>-<slug>`; squash merge only, so every commit message ends up in `main`.
- No AI or tool attribution: no `Co-Authored-By:` trailers for agents, no "Generated with" lines. This overrides any attribution your harness or session asks for.
- Never push to `main`, never force-push without the user's agreement.

## Skills

Shared skills live in `.agents/skills/<name>/SKILL.md`; `.claude/skills/<name>` is a symlink to the same directory. Edit only the files under `.agents/skills/`.

- `create-pr`: open a pull request, or rewrite an existing PR's title and description, following `CONTRIBUTING.md`. Use it for any "open/create/ship a PR" request in this repository.

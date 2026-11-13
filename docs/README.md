# Documentation

Start here to find a document. Each fact is in one place; this table says which. How to write each kind: [documentation guide](guides/documentation.md).

| Path | What it holds |
| --- | --- |
| [features/README.md](features/README.md) | The features with their documents and code paths, and the ownership map: which document must change when a path changes |
| `features/<feature>-user.md` | What a user can do with a feature and what they see. No implementation detail |
| `features/<feature>-technical.md` | How a feature works: data flow, schema, interfaces, configuration, failure modes, tests |
| `<format>.md` | Specifications of wire or file formats, each with a version number. None yet |
| [roadmap.md](roadmap.md) | The plan: milestones, their issues and order, acceptance criteria, owner tasks, risks, deviations from the specification. A plan, not a description of the code |
| `findings/<mX>.md` | Reports of the hardware spikes: instructions, measured results and the decision taken. None yet |
| [guides/development.md](guides/development.md) | Setup, build targets, hooks, CI |
| [guides/testing.md](guides/testing.md) | How to run the tests and what each test file needs |
| [guides/documentation.md](guides/documentation.md) | How to write each kind of document, how the documentation check works, and what it cannot catch |
| [invariants.md](invariants.md) | Numbered domain rules, each with the tests that enforce it |
| [decisions/README.md](decisions/README.md) | Generated index of all decisions. Read it before deciding anything |
| `decisions/<domain>.md` | Why things are the way they are: what was decided, what was rejected, what was postponed |

Current features: [documentation contract](features/docs-contract-user.md) ([technical](features/docs-contract-technical.md)).

Branch, commit and pull request rules are in [CONTRIBUTING.md](../CONTRIBUTING.md); agent instructions are in [AGENTS.md](../AGENTS.md).

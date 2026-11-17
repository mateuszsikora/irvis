# Documentation

Start here to find a document. Each fact is in one place; this table says which. How to write each kind: [documentation guide](guides/documentation.md).

| Path | What it holds |
| --- | --- |
| [features/README.md](features/README.md) | The features with their documents and code paths, and the ownership map: which document must change when a path changes |
| `features/<feature>-user.md` | What a user can do with a feature and what they see. No implementation detail |
| `features/<feature>-technical.md` | How a feature works: data flow, schema, interfaces, configuration, failure modes, tests |
| `<format>.md` | Specifications of wire or file formats, each with a version number: [irvis-format.md](irvis-format.md), the `.irvis` recording format; [protocol.md](protocol.md), experimental USB commands; [browser-diagnostics-format.md](browser-diagnostics-format.md), browser spike exports |
| [roadmap.md](roadmap.md) | The plan: milestones, their issues and order, acceptance criteria, owner tasks, risks, deviations from the specification. A plan, not a description of the code |
| `findings/m<n>.md` | Reports of the hardware spikes (instructions, measured results, the decision taken) and the M5 checklist: [M1](findings/m1.md), [M2](findings/m2.md), [M3](findings/m3.md) |
| [findings/irvis-codec.md](findings/irvis-codec.md) | Real static-wall fixtures, temporal noise, codec sizes and the v1 freeze |
| [findings/android-app.md](findings/android-app.md) | Android vendor-app catalogue: 27 features, entry points, coverage, evidence IDs, output formats and remaining work for #11 |
| [findings/public-repository.md](findings/public-repository.md) | Audit before going public (#26): secrets, files and personal data in everything GitHub publishes, licences of what ships, owner steps |
| [findings/reconstruction.md](findings/reconstruction.md) | Synthetic planar reconstruction benchmark, quality limits and timing on Apple M2 Pro |
| [guides/development.md](guides/development.md) | Setup, npm scripts, hooks, CI |
| [guides/testing.md](guides/testing.md) | How to run the tests and what each test file needs |
| [guides/documentation.md](guides/documentation.md) | How to write each kind of document, how the documentation check works, and what it cannot catch |
| [invariants.md](invariants.md) | Numbered domain rules, each with the tests that enforce it |
| [decisions/README.md](decisions/README.md) | Generated index of all decisions. Read it before deciding anything |
| `decisions/<domain>.md` | Why things are the way they are: what was decided, what was rejected, what was postponed |

Current features: [documentation contract](features/docs-contract-user.md) ([technical](features/docs-contract-technical.md)), [core](features/core-user.md) ([technical](features/core-technical.md)), [cameras](features/cameras-user.md) ([technical](features/cameras-technical.md)), [web app](features/web-app-user.md) ([technical](features/web-app-technical.md)), [capture tool](features/capture-cli-user.md) ([technical](features/capture-cli-technical.md)).

Branch, commit and pull request rules are in [CONTRIBUTING.md](../CONTRIBUTING.md); agent instructions are in [AGENTS.md](../AGENTS.md).

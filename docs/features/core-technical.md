# Core: technical

How `packages/core` is built, checked and laid out, for whoever changes it. The camera registry and the profile schema in `packages/core/src/cameras/` are in [cameras: technical](cameras-technical.md). Why core is shaped this way: [architecture decisions](../decisions/architecture.md).

## Data flow

No frame passes through core yet; the types fix the path that later issues implement:

1. A `CameraBackend` (`src/backend.ts`) lists devices and `open()`s one with an `OpenRequest`: the device id, the `CameraProfile` chosen for it, and a `VideoMode.id` of that profile.
2. The `CameraSession` it returns publishes `RawFrame`s (`src/frames.ts`) through `frames`, a `Subscribable<RawFrame>` (`src/store.ts`). A listener that is slow makes the backend drop frames; nothing queues them.
3. A decoder (planned in #6) turns a `YuyvFrame` into a `ThermalFrame` by the profile's `FrameLayout`, and the reconstruction (planned in #8) does the same from a `Yuv420Frame`. A `{ kind: 'thermal' }` frame, from a recording, already is one.
4. The `.irvis` codec (planned in #14) writes `ThermalFrame`s to a `ByteSink` (`src/bytes.ts`) and reads them back from a `ByteSource`; a `Player` (`src/player.ts`) drives the playback.

`src/index.ts` re-exports every type and the registry module `src/cameras/index.ts`. It is the package's only entry point (`exports` in `packages/core/package.json` maps `.` to `./src/index.ts`).

## Schema

Every field has a TSDoc comment in the source; this is the summary.

**Frames** (`src/frames.ts`):

| Type | Fields | Notes |
| --- | --- | --- |
| `YuyvFrame` | `kind: 'yuyv'`, `width`, `height`, `data`, `timestamp` | `data` is width × height × 2 bytes, row-major, `[Y0 U Y1 V]` per pair of pixels, unchanged from the camera |
| `Yuv420Frame` | `kind: 'yuv420'`, `layout: 'i420' \| 'nv12'`, `width`, `height`, `data`, `planes`, `timestamp` | `planes` holds an `offset` and a `stride` per plane, as WebCodecs `PlaneLayout`: Y, U, V for `i420`; Y and interleaved UV for `nv12` |
| `ThermalRawFrame` | `kind: 'thermal'`, `frame: ThermalFrame` | The third `RawFrame` variant, for sources that already hold temperature data |
| `ThermalFrame` | `width`, `height`, `timestamp`, `raw`, `conversion`, `cameraState`, `uncertain` | `raw` is a `Uint16Array` of width × height thermal pixels; `conversion` is the profile's `Conversion` for the frame's gain; `cameraState` a `CameraStateSnapshot`; `uncertain` a `Uint8Array` mask (1 = uncertain) or `null` when every value is exact |

Timestamps are milliseconds on the source's monotonic clock. `Conversion` and `CameraStateSnapshot` are part of the profile schema ([cameras: technical](cameras-technical.md#schema)).

**Backends** (`src/backend.ts`):

| Type | Fields |
| --- | --- |
| `BackendId` | `'browser' \| 'electron' \| 'replay'` |
| `BackendCapabilities` | `exactRaw` (frames are `YuyvFrame`s), `deviceControl` (can send profile commands), `concurrentWith` (backends that can use the same camera at the same time) |
| `CameraDevice` | `id`, `label`, optional `vendorId` and `productId` (the browser usually has neither) |
| `OpenRequest` | `deviceId`, `profile`, `modeId` |
| `CameraSession` | `device`, `profile`, `mode`, `frames: Subscribable<RawFrame>`, `close(): Promise<void>` |
| `CameraBackend` | `id`, `capabilities`, `listDevices(): Promise<readonly CameraDevice[]>`, `open(request): Promise<CameraSession>` |

Commands to the camera are not part of `CameraBackend` yet; #22 adds them.

**Recordings** (`src/bytes.ts`, `src/player.ts`):

| Type | Members | Contract |
| --- | --- | --- |
| `ByteSink` | `append(chunk)`, `flush()`, `close()`, all returning `Promise<void>` | The caller does not modify a chunk until its `append` settles. A sink with a bounded queue resolves `append` late instead of buffering without limit. `flush` resolves when the bytes are on durable storage. After `close`, `append` and `flush` reject. |
| `ByteSource` | `size(): Promise<number>`, `read(offset, length): Promise<Uint8Array>` | `read` returns fewer bytes only at the end, and an empty array at or past it. |
| `Player` | `play()`, `pause()`, `seek(position)`, `setRate(rate)`, `viewState: Store<PlayerViewState>` | `seek` goes to the frame at or before `position` (ms), clamped to the recording; `rate` is greater than 0 |
| `PlayerViewState` | `position`, `duration` (ms), `paused`, `rate` | |

**Values over time** (`src/store.ts`): `Subscribable<T>` has `subscribe: (listener) => Unsubscribe`; `Store<T>` adds `getSnapshot: () => T`, which returns the same object until the value changes. Both are function properties, not methods: an implementation binds them (or uses arrow functions), so `useSyncExternalStore(store.subscribe, store.getSnapshot)` works and passes typescript-eslint's `unbound-method`. Calling an `Unsubscribe` twice does nothing. [Why subscriptions](../decisions/architecture.md#frames-and-state-in-core-are-subscriptions).

## Interfaces

Everything is exported from `@irvis/core`: the types above, the profile types, and `cameraProfiles`, `findProfile`, `matchProfiles`, `validateProfile` and `DeviceDescription` from the registry ([cameras: technical](cameras-technical.md#interfaces)).

## Configuration

| File | What it sets |
| --- | --- |
| `packages/core/package.json` | `@irvis/core`, `"type": "module"`, `exports` → `./src/index.ts`. No dependencies. |
| `packages/core/tsconfig.json` | Solution file referencing the two projects below, so editors and typescript-eslint find the right one for each file |
| `packages/core/tsconfig.lib.json` | `src/` without `*.test.ts`. `lib: ["ES2022"]`, `types: []`, `composite`, `emitDeclarationOnly`; declarations go to `node_modules/.tsbuild/core/lib/` and are what `apps/web` type-checks against |
| `packages/core/tsconfig.test.json` | `src/**/*.test.ts`, `test/` and `vitest.config.ts`, with `lib: ["ES2024"]`, `types: ["node", "vitest"]`, `noEmit`; references `tsconfig.lib.json` |
| `packages/core/src/env.d.ts` | Declares `TextEncoder`, `TextDecoder` and `console` for the library project. The test project does not include it, because `@types/node` declares the same globals |
| `packages/core/vitest.config.ts` | Vitest project `core`, environment `node`, files `src/**/*.test.ts` and `test/**/*.test.ts` |

Both projects extend `tsconfig.base.json` at the root: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `moduleResolution: "bundler"`, `skipLibCheck: false` ([development guide](../guides/development.md#typescript)).

ESLint (`eslint.config.js` at the root) adds these blocks for core, and a test checks the exceptions:

| Files | Rule | What it forbids |
| --- | --- | --- |
| `packages/core/src/**/*.ts` | `no-restricted-imports` | Every import or re-export whose specifier is neither relative (`./`, `../`) nor exactly `fflate` (regular expression `^(?!\.{1,2}/\|fflate$)`): Node modules, other irvis packages, `fflate/<subpath>`, and every package hoisted into the root `node_modules` (`react`, `vite`, `vitest`, …), type-only imports included. From `fflate`, every name outside `FFLATE_SYNC` (the `*Sync` functions, the streaming classes, `strToU8`, `strFromU8`, `EncodeUTF8`, `DecodeUTF8`, `FlateError`), and `import * as` |
| `packages/core/src/**/*.test.ts` | `no-restricted-imports` | The same, except that `vitest` is also allowed |
| `packages/core/src/**/*.ts` | `no-restricted-syntax` | `import()` (an `ImportExpression`), which `no-restricted-imports` does not see |
| `packages/core/src/{analysis,corrections,cameras,irvis,reconstruction}/**/*.ts` | `no-restricted-syntax` | `import()` again (flat config replaces a rule's options instead of merging them, so this block repeats the selector), and `Math.<name>` for a name outside `MATH_ALLOWED`, `Math[...]`, any other use of the identifier `Math` (`const m = Math`, `const { log } = Math`, `globalThis.Math`), `**` and `**=` |

**Exceptions.** In all of `packages/core/src/`, an `eslint-disable`, `eslint-disable-line` or `eslint-disable-next-line` comment names the rules it disables and, after ` -- `, a decision as `docs/decisions/<file>.md#<anchor>`; inline configuration (`/* eslint <rule>: … */`, `eslint-env`, `global`, `globals`, `exported`) is not allowed. As in ESLint, only `eslint-disable-line` and `eslint-disable-next-line` count in a `//` comment; every other keyword is a directive only in a `/* */` comment, so `// exported for the tests` is plain text. ESLint cannot enforce this, because a directive can silence the rule that would check it (`// eslint-disable-line` alone silences everything on its line). `packages/core/test/eslint-directives.test.ts` therefore parses every `.ts` and `.tsx` file under `packages/core/src/` with `@typescript-eslint/parser` and checks each directive comment; `eslint-enable` needs nothing. Because the reason is a `docs/` reference in a code comment, `make docs-check` also fails when the named decision does not exist. `fflate` is not a dependency yet; its declarations (0.8.3) were checked to compile with `lib: ["ES2022"]`, `types: []` and `skipLibCheck: false`, so core needs no wrapper module with its own declarations. #14 adds the dependency.

## Failure modes

TypeScript errors are the compiler's own; the ones core code meets are shown in the [user document](core-user.md#what-fails). ESLint messages, verbatim:

| Message | Cause |
| --- | --- |
| `'<specifier>' import is restricted from being used by a pattern. Core imports only its own files (relative paths) and fflate (docs/decisions/architecture.md#core-uses-only-apis-that-browsers-and-node-share).` | Anything but a relative path or `fflate` imported in core's source |
| `'<specifier>' import is restricted from being used by a pattern. Tests in packages/core/src/ import only relative paths, fflate and vitest; tests that need Node go to packages/core/test/ (docs/guides/testing.md#add-a-typescript-test).` | The same in a `*.test.ts` file under `packages/core/src/` |
| `'<name>' import from 'fflate' is restricted because only 'deflateSync', …, and 'FlateError' are allowed. Core uses only the synchronous fflate functions (docs/decisions/architecture.md#core-uses-only-apis-that-browsers-and-node-share).` | An asynchronous `fflate` function (ESLint lists all of `FFLATE_SYNC` where `…` stands) |
| `* import is invalid because only 'deflateSync', …, and 'FlateError' from 'fflate' are allowed. Core uses only the synchronous fflate functions (docs/decisions/architecture.md#core-uses-only-apis-that-browsers-and-node-share).` | `import * as fflate from 'fflate'` |
| `Math member outside the allow-list: engines may approximate it, so readings would differ between Chrome and Safari. An exception is an eslint-disable comment naming its decision (docs/decisions/architecture.md#measurement-code-uses-only-correctly-rounded-arithmetic).` | For example `Math.pow`, `Math.exp`, `Math.log`, `Math.hypot`, `Math.sin` |
| `Math accessed with a computed name: engines may …` (same text from the colon on) | `Math['sqrt']` |
| `Math used other than as Math.<name>: engines may …` | `const m = Math`, destructuring, `globalThis.Math` |
| `The ** operator: engines may …` | `x ** 4`, `x **= 2` |
| `Core does not load modules with import(); use a static import (docs/decisions/architecture.md#core-uses-only-apis-that-browsers-and-node-share).` | `import('react')` or any other `import()` in core |

The directive test (`eslint-directives.test.ts`) fails with a Vitest diff listing one line per problem:

| Line | Cause |
| --- | --- |
| `<file>:<line>: "<directive>" without rule names disables every rule; name the rules` | `// eslint-disable-line`, `/* eslint-disable */` and the like |
| `<file>:<line>: "<directive>" names no decision; add "-- docs/decisions/<file>.md#<decision>"` | No ` -- ` reason, or a reason without a decision |
| `<file>:<line>: inline configuration ("<keyword> ...") is not allowed in core` | `/* eslint <rule>: "off" */`, `/* eslint-env … */`, `/* global … */`, `/* globals … */`, `/* exported … */` |

The dependency test (`packages/core/test/package-dependencies.test.ts`) fails with Vitest's diff and one of these labels: `add the new workspace to ALLOWED_IRVIS with the packages it may import`, `<dir> depends on`, or the workspace directory for `electron`.

## Tests

| File | Covers |
| --- | --- |
| `packages/core/test/package-dependencies.test.ts` | Reads every `package.json` in `packages/*`, `apps/*` and `tools/*`. Every workspace is in `ALLOWED_IRVIS`; its `@irvis/*` dependencies in all four dependency fields are in its row; core depends on nothing outside irvis but `fflate`; only `apps/desktop` lists `electron`. [Invariant 15](../invariants.md). |
| `packages/core/test/eslint-rules.test.ts` | Runs the repository's ESLint configuration (with type-aware rules off, because the snippets are not files) on snippets placed in core paths: Node modules, irvis packages, hoisted packages (`react`, `vite`, `vitest`), `fflate/node`, dynamic `import()` in and outside measurement code, relative imports, `vitest` in tests only, the `fflate` names ([invariant 16](../invariants.md)); the `Math` allow-list in all five directories and not outside them, and that a disable comment suppresses it ([invariant 17](../invariants.md)). |
| `packages/core/test/eslint-directives.test.ts` | Every directive comment in `packages/core/src/` names its rules and a decision; accepted and rejected forms, inline configuration, and comments or strings that only look like directives (`// exported …`, `// global …`, `// eslint-disable` in a line comment) ([invariant 17](../invariants.md)). |
| `packages/core/src/cameras/*.test.ts` | The registry and `validateProfile`: [cameras: technical](cameras-technical.md#tests). |

Not covered: that the types fit the backends and the codec, which do not exist yet; the TypeScript library settings, which `npm run typecheck` exercises on every run but no test asserts (a file that uses `document` was checked by hand when they were set up). The ESLint test cannot see a rule that type-aware linting would add or change for a real file.

## See also

- [Core](core-user.md)
- [Cameras: technical](cameras-technical.md)
- [Testing guide](../guides/testing.md)

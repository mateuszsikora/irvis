# Core

`@irvis/core` (`packages/core`) is the TypeScript package every other part of irvis builds on: the types that connect a camera backend, a recording and the viewer, and the camera registry. Its users are the people and agents who write the other packages. It runs unchanged in browsers, Workers, Electron and Node, so it uses only the APIs they all share. The camera registry and the profile schema have their own documents: [cameras](cameras-user.md).

## Use core from another package

Add `"@irvis/core": "*"` to the package's `dependencies` (npm links the workspace), then import from the package name:

```ts
import type { CameraBackend, RawFrame, ThermalFrame, ByteSink } from '@irvis/core';
import { cameraProfiles, decodeThermalFrame, matchProfiles, toCelsius } from '@irvis/core';
```

There is no build step: the package exports its TypeScript source (`src/index.ts`), which Vite, Vitest and Node 26 load directly. Which package may depend on which is fixed; see [what fails](#what-fails).

What core holds today:

| Type | What it is |
| --- | --- |
| `CameraBackend` | A source of frames: `id` (`'browser'`, `'electron'` or `'replay'`), `capabilities`, `listDevices()`, `open()` |
| `CameraSession` | An open camera: its device, profile and video mode, the `frames` subscription, `close()` |
| `RawFrame` | What a backend delivers: `YuyvFrame` (exact bytes), `Yuv420Frame` (the browser's lossy 4:2:0 copy) or `{ kind: 'thermal'; frame: ThermalFrame }` |
| `ThermalFrame` | Raw sensor values of one frame with the conversion to °C, the camera state and the uncertain-pixel mask |
| `Player` | Playback controls of a recording: `play`, `pause`, `seek`, `setRate`, and the `viewState` store |
| `ByteSink`, `ByteSource` | Asynchronous writes (`append`, `flush`, `close`) and random-access reads (`size`, `read`) of a recording |
| `Subscribable`, `Store` | Values over time; `Store` has `getSnapshot()` for React's `useSyncExternalStore` |

And these functions:

| Function | What it does |
| --- | --- |
| `decodeThermalFrame(frame, mode, conversion, cameraState)` | The `ThermalFrame` in a `YuyvFrame` of a video mode: the raw values of the mode's temperature rows |
| `decodeYuyvRaw(frame, rows)` | The raw 16-bit values packed into some rows of a YUYV frame (`raw = lo \| hi << 8`) |
| `decodeYuyvImage(frame, rows)` | The Y, U and V bytes of some rows of a YUYV frame, such as the camera's own image |
| `toCelsius(raw, conversion)`, `toCelsiusArray(raw, conversion)` | Degrees Celsius from raw values with a profile's conversion |

```ts
const mode = profile.videoModes[0];
const thermal = decodeThermalFrame(frame, mode, profile.conversions[0].conversion, {
  origin: 'assumed',
  values: {},
});
const centre = toCelsius(thermal.raw[96 * 256 + 128], thermal.conversion);
```

A frame of the wrong size, or a mode without temperature data, throws an `Error` with one of the messages in the [technical document](core-technical.md#failure-modes). No backend or codec exists yet; the types are what they will implement. The field-by-field description is in the [technical document](core-technical.md#schema).

## Write code in core

- Put source in `packages/core/src/`, tests next to it as `<name>.test.ts`, and tests that need Node (files, ESLint) in `packages/core/test/`.
- Import only relative files and `fflate` (tests next to the code may also import `vitest`). A package another workspace depends on is in the root `node_modules` and would resolve, but core must not use it.
- Import relative files with their `.ts` extension: `import type { ThermalFrame } from './frames.ts'`.
- Use only ECMAScript (ES2022) and the three shared APIs: `TextEncoder`, `TextDecoder` and `console`. Adding another one is a decision ([why](../decisions/architecture.md#core-uses-only-apis-that-browsers-and-node-share)).
- No `enum`, `namespace` or constructor parameter properties: Node strips the types without transforming code (`erasableSyntaxOnly`).
- In `src/analysis/`, `src/corrections/`, `src/cameras/`, `src/irvis/` and `src/reconstruction/`, use only the `Math` members that every engine computes the same way: `abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`, `sqrt`, `fround`, `imul`, `clz32` and the constants `PI`, `E`, `SQRT2`, `SQRT1_2`, `LN2`, `LN10`, `LOG2E`, `LOG10E`. No `**`. Write x⁴ as `x * x * x * x` and a fourth root as `Math.sqrt(Math.sqrt(x))` ([why](../decisions/architecture.md#measurement-code-uses-only-correctly-rounded-arithmetic)).
- An unavoidable exception to any lint rule in core is a disable comment that names the rules it disables and, after `--`, the decision allowing it. No other form: no bare `// eslint-disable-line`, no `/* eslint-disable */`, no `/* eslint <rule>: "off" */`, `/* global … */` or other inline configuration.

  ```ts
  // eslint-disable-next-line no-restricted-syntax -- docs/decisions/architecture.md#<the-decision>
  ```

Check your change with `npm run lint`, `npm run typecheck` and `npm test` ([development guide](../guides/development.md#npm-scripts)).

## What fails

`npm run typecheck` fails when core code uses an API outside ES2022 and the shared three, for example:

```
packages/core/src/probe.ts(1,18): error TS2584: Cannot find name 'document'. Do you need to change your target library? Try changing the 'lib' compiler option to include 'dom'.
packages/core/src/probe.ts(2,18): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
packages/core/src/probe.ts(4,18): error TS2304: Cannot find name 'setTimeout'.
```

`npm run lint` fails on these, with the messages quoted in the [technical document](core-technical.md#failure-modes):

- an import in `packages/core/src/` of anything but a relative path or `fflate`: a Node module (`node:fs`, `fs`), `@irvis/ui`, `@irvis/media`, a `@irvis/backend-*` package, `react`, `fflate/node`;
- an import of an asynchronous `fflate` function, or `import * as` from `fflate`;
- any dynamic `import()` in `packages/core/src/`;
- in the five measurement directories: a `Math` member outside the list, `Math` reached any other way than `Math.<name>`, `**` or `**=`.

`npm test` fails when a lint directive comment in `packages/core/src/` names no rules or no decision, or configures ESLint inline ([invariant 17](../invariants.md)), and when a `package.json` adds a dependency that breaks the direction core ← media ← ui ← apps/web, makes core depend on anything but `fflate`, lists `electron` outside `apps/desktop`, or belongs to a workspace that the dependency table does not list yet ([invariant 15](../invariants.md)).

## See also

- [Core: technical](core-technical.md)
- [Cameras](cameras-user.md)
- [Architecture decisions](../decisions/architecture.md)

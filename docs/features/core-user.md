# Core

`@irvis/core` (`packages/core`) is the TypeScript package every other part of irvis builds on: the types that connect a camera backend, a recording and the viewer, the camera registry, the `.irvis` recording format, the corrections that turn raw values into the readings a user sees (emissivity, offset, °C or °F, alarms, isotherms), and the palettes and measurements on those readings (min and max, point, line, area, histogram). Its users are the people and agents who write the other packages. It runs unchanged in browsers, Workers, Electron and Node, so it uses only the APIs they all share. The camera registry and the profile schema have their own documents: [cameras](cameras-user.md).

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
| `ByteSink`, `ByteSource` | Asynchronous writes (`append`, `flush`, `close`) and random-access reads (`size`, `read`) of a recording; `MemoryByteSink` and `memoryByteSource` keep the bytes in memory |
| `IrvisWriter`, `IrvisReader` | Write and read `.irvis` recordings ([below](#record-and-read-irvis-files)) |
| `Subscribable`, `Store` | Values over time; `Store` has `getSnapshot()` for React's `useSyncExternalStore` |

And these functions:

| Function | What it does |
| --- | --- |
| `decodeThermalFrame(frame, mode, conversion, cameraState)` | The `ThermalFrame` in a `YuyvFrame` of a video mode: the raw values of the mode's temperature rows |
| `decodeYuyvRaw(frame, rows)` | The raw 16-bit values packed into some rows of a YUYV frame (`raw = lo \| hi << 8`) |
| `decodeYuyvImage(frame, rows)` | The Y, U and V bytes of some rows of a YUYV frame, such as the camera's own image |
| `toCelsius(raw, conversion)`, `toCelsiusArray(raw, conversion)` | Degrees Celsius from raw values with a profile's conversion |
| `correctFrame(frame, settings)` | Corrected readings in °C, with emissivity, reflected temperature and offset ([below](#correct-readings-show-units-raise-alarms-and-paint-isotherms)) |
| `renderPalette(celsius, range, palette)`, `measureFrame(image)` and the other measurements | An RGBA image in one of six palettes, and min, max, point, line, area and histogram readings ([below](#render-a-palette-and-measure)) |

```ts
const mode = profile.videoModes[0];
const thermal = decodeThermalFrame(frame, mode, profile.conversions[0].conversion, {
  origin: 'assumed',
  values: {},
});
const centre = toCelsius(thermal.raw[96 * 256 + 128], thermal.conversion);
```

A frame of the wrong size, or a mode without temperature data, throws an `Error` with one of the messages in the [technical document](core-technical.md#failure-modes). No backend exists yet; the types are what they will implement. The field-by-field description is in the [technical document](core-technical.md#schema).

## Record and read .irvis files

A `.irvis` file holds the raw value of every pixel of every frame within a threshold T, with the conversion to °C and the camera state, so it can be read without the camera profile; a snapshot is a file with one frame. The format is specified in [irvis-format.md](../irvis-format.md). T is in raw sensor units (1/64 K on the P2 Pro, so 8 is 0.125 K and 16 is 0.25 K); every value read back is within T of the value written, and T = 0 is lossless.

```ts
import { IrvisReader, IrvisWriter, reencodeIrvis } from '@irvis/core';

const writer = await IrvisWriter.create(sink, {
  profile, // a CameraProfile, or { id, version, name }
  width: 256,
  height: 192,
  fps: 25,
  path: 'exact', // 'reconstructed' for frames from the browser
  threshold: 8,
});
for (const frame of frames) await writer.appendFrame(frame); // ThermalFrames, one call at a time
await writer.appendViewState(timestamp, { palette: 'iron' }); // only what changed
await writer.close(); // writes the index; without it the file is still readable

const reader = await IrvisReader.open(source);
const { frame } = await reader.readFrame(reader.frameAt(5000)); // the frame at 5 s, a ThermalFrame
```

- `sink` and `source` are a `ByteSink` and a `ByteSource`: an OPFS or picked file, a file written by the desktop app, or `new MemoryByteSink()` and `memoryByteSource(bytes)`.
- The writer flushes the sink about every second of frames and starts a keyframe about every 10 seconds, after a gain, camera-state or conversion change and after a shutter calibration (NUC) that the data show.
- Frame timestamps must not go back, and the conversion and camera state may hold no NaN or infinity. A frame the writer rejects for that, or for its size, changes nothing, and writing can go on. When the sink fails (full storage, a broken connection to the desktop app), every later call rejects with `the writer stopped after an earlier error: …`; close the sink yourself. The file keeps every frame the sink accepted.
- Arrays you get back (`frame.raw`, `frame.uncertain`, `values` from `appendFrame`) are yours to change; the chunk data, the header and the view-state changes are frozen.
- A file whose writing stopped early, after a crash or an unplugged camera, opens anyway: `reader.indexed` is `false`, and `reader.damage` says where reading stopped and why, or is `null` if nothing is missing.
- `reencodeIrvis(source, sink, 16)` writes a smaller copy with a larger threshold; the threshold can never go down. It also repairs a damaged file: the copy is complete, it leaves out what cannot be decoded (`result.skipped` frames), and `result.damage` says where the first damage was.
- `npm run bench:irvis` prints the file size per minute and the time per frame for synthetic scenes ([results](../irvis-format.md#benchmark)).

## Correct readings, show units, raise alarms and paint isotherms

The readings a user sees are the frame's temperatures corrected for the object's emissivity, the temperature it reflects and an offset. Alarms and isotherms work on those corrected readings.

```ts
import {
  DEFAULT_ALARMS,
  correctFrame,
  evaluateAlarms,
  formatTemperature,
  paintIsotherms,
  settingsFromCamera,
  unitDeltaToCelsius,
  unitToCelsius,
  type AlarmState,
} from '@irvis/core';

// Start from what the camera applied, so that nothing changes until the user does.
const start = settingsFromCamera(frame.cameraState);
const settings = { ...start, emissivity: 0.95, reflectedCelsius: 20 };
const celsius = correctFrame(frame, settings); // one °C reading per pixel of a ThermalFrame

let alarms: AlarmState | null = null;
alarms = evaluateAlarms(celsius, frame.uncertain, { ...DEFAULT_ALARMS, highCelsius: 60 }, alarms);
if (alarms.high.active) console.log(`hot: ${formatTemperature(alarms.high.extreme, 'C')}`);

// rgba: the rendered frame, width × height × 4 bytes
paintIsotherms(rgba, celsius, frame.uncertain, [
  { kind: 'between', minCelsius: 30, maxCelsius: 37, color: [0, 255, 0] },
]);

formatTemperature(36.6, 'F'); // '97.9 °F'
unitToCelsius(140, 'F'); // 60: a threshold the user typed in °F
unitDeltaToCelsius(0.9, 'F'); // 0.5: an offset typed in °F
```

- **Emissivity** is from greater than 0 to 1 (1 is a black body), the **reflected temperature** is the °C of the surroundings the object mirrors, and the **offset** (`offsetKelvin`) is a difference in kelvin added at the end. Start the user's settings from `settingsFromCamera(frame.cameraState)`: they change no reading until the user changes them. `DEFAULT_CORRECTION` (ε 1, 20 °C, offset 0) changes nothing only for a camera that applies no emissivity itself; for one that does, ε 1 undoes the camera's correction. The formula is the T⁴ law; how close it is to a real sensor is in the [decision](../decisions/architecture.md#emissivity-is-corrected-with-the-fourth-power-law-and-a-reflected-temperature).
- **The camera's own correction is never applied twice.** When a frame's camera state holds `emissivity` and `reflected-temperature`, the camera has applied them to the raw values, and `correctFrame` corrects from there: settings equal to the camera's change nothing, and other settings give what they would give on uncorrected data. "Equal" means the same numbers: an R typed in °F and converted back can differ in the last bit and then moves readings by about 1e-13 K. In the browser the state holds what the user declared, or the profile's defaults.
- **Units:** readings stay in °C in core; convert with `celsiusToUnit` and `unitToCelsius` for temperatures and `celsiusDeltaToUnit` and `unitDeltaToCelsius` for differences (offset, hysteresis). `formatTemperature(value, unit, digits = 1)` gives `36.6 °C`, and `–` for a pixel without a temperature.
- **Alarms:** `highCelsius` turns on at or above, `lowCelsius` at or below, `null` disables one. Pass the previous `AlarmState` back each frame: an alarm that is on stays on until the hottest (coldest) pixel is more than `hysteresis` (0.5 K by default) past the threshold, so noise does not switch it every frame. Each alarm says how many pixels reach the threshold and where the hottest or coldest pixel is.
- **Isotherms:** above a temperature, below it, or between two, bounds included, painted over an RGBA image with one pixel per reading; later isotherms paint over earlier ones, and alpha is kept. `isothermMask` gives the pixels as a mask instead.
- Uncertain pixels (`frame.uncertain`) and pixels without a temperature (NaN, and every reading at or below 0 K, such as a dead pixel at raw 0; also ±Infinity in readings you build yourself) never turn an alarm on and are never painted.
- Invalid settings throw an `Error` such as `invalid correction: emissivity must be greater than 0 and at most 1`; every message is in the [technical document](core-technical.md#failure-modes).

## Render a palette and measure

The viewer shows corrected readings in a palette and measures them. Every function here takes a `CelsiusImage`, the corrected readings with the frame's size and uncertain mask, or its `celsius` array:

```ts
import {
  autoRange,
  celsiusImage,
  histogram,
  measureArea,
  measureFrame,
  measureLine,
  measurePoint,
  paletteLut,
  renderPalette,
} from '@irvis/core';

const image = celsiusImage(frame, settings); // correctFrame with width, height and frame.uncertain

// Automatic range (null when no pixel has a certain temperature), or the user's own.
const range = autoRange(image) ?? { minCelsius: 20, maxCelsius: 40 };
const rgba = renderPalette(image.celsius, range, 'iron'); // Uint8ClampedArray<ArrayBuffer>, as ImageData wants
ctx.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
const scale = paletteLut('iron'); // 256 colours, coldest first, for the scale bar

const { min, max } = measureFrame(image); // { x, y, index, celsius } each, or null
const centre = measurePoint(image, { x: 128, y: 96 }).mean; // the 3×3 mean
const profile = measureLine(image, { x: 10, y: 96 }, { x: 245, y: 96 }); // profile.celsius per pixel
const box = measureArea(image, { x: 100, y: 70, width: 56, height: 52 }); // box.min, box.max, box.mean
const bins = histogram(image, range, 64); // bins.counts: 64 counts from range.minCelsius to maxCelsius
```

- **Palettes:** `iron`, `white-hot`, `black-hot`, `rainbow`, `red-hot` and `cold-blue` (`PALETTE_IDS`; names for the UI in `PALETTES`), each 256 colours from cold to hot.
- **Range:** the readings from `minCelsius` to `maxCelsius` are split into 256 equal steps; the bottom gets the first colour, the top the last, and readings outside the range get the first or last colour. `autoRange` spans the coldest to the hottest pixel of the frame; a frame where every pixel reads the same gets 1 K around that reading. A manual range needs `minCelsius` below `maxCelsius`.
- **Pixels without a temperature** (NaN, such as a dead pixel at raw 0, and ±Infinity in an image you build yourself) are transparent in the image. Uncertain pixels are coloured by their value; mark them with the overlay.
- **Uncertain pixels and pixels without a temperature count in no measurement:** min and max never land on them, a point, line or area averages only the others (`counted` says how many), and the histogram lists them as `skipped`. When nothing counts, `mean` is NaN and `min` and `max` are `null`. A line profile still holds every sample, with `profile.uncertain` marking the uncertain ones.
- **Point:** the mean of the 3×3 pixels around it; at the edge of the image only the neighbours inside it. When the point's own pixel is uncertain or has no temperature, `centreCounted` is `false` and the mean is its neighbours' only: show that, not a plain reading. **Line:** one sample per pixel from start to end, both included. **Area:** a rectangle of whole pixels inside the image. Positions are whole pixels; a position outside the image throws, for example `point (256, 0) is not a pixel of the 256×192 image`.
- Colours and measurements use only arithmetic that every engine rounds the same way, so a recording gives the same readings in every browser and in Node (#21 will test this in Chromium and WebKit).

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

A `.irvis` file that cannot be read, or a writer call the format does not allow, throws an `IrvisError` with one of the messages in the [technical document](core-technical.md#failure-modes), for example `not an .irvis file: the signature is missing` or `cannot re-encode to threshold 4: it must be an integer of at least the file's 8`.

`npm test` fails when a lint directive comment in `packages/core/src/` names no rules or no decision, or configures ESLint inline ([invariant 17](../invariants.md)), and when a `package.json` adds a dependency that breaks the direction core ← media ← ui ← apps/web, makes core depend on anything but `fflate`, lists `electron` outside `apps/desktop`, or belongs to a workspace that the dependency table does not list yet ([invariant 15](../invariants.md)).

## See also

- [Core: technical](core-technical.md)
- [Cameras](cameras-user.md)
- [The .irvis format](../irvis-format.md)
- [Architecture decisions](../decisions/architecture.md)

## Recover a planar frame

Use `reconstructPlanar(frame, { thermal: { firstRow: 192, rows: 192 }, image: { firstRow: 0, rows: 192 } })` for a 256×384 P2 Pro I420 or NV12 frame. Use the profile's actual row ranges for other modes. Omit `image` if no registered brightness image is available. The result supplies `raw`, `uncertain` and its inverse `confident`, plus `hint.enabled` and `hint.rSquared` for diagnostics. Supply conversion and camera state separately when constructing a `ThermalFrame`.

Reconstruction is experimental and can make multi-kelvin errors. Confidence is a cost-margin heuristic, not a guarantee of accuracy. Monotonic brightness can help; an uninformative upper image automatically disables the hint. No browser capture or UI is added by this API.

Run `node packages/core/test/benchmark/reconstruction.ts` with Node 26 to print synthetic quality and timing results as JSON lines. Each line reports PASS or FAIL against the targets; missing them does not fail CI. See the [technical reference](core-technical.md#planar-reconstruction) for metric definitions and limitations.

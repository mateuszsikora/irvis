# Decisions: architecture

Why irvis is shaped as it is: packages, interfaces, camera profiles, the recording format, hosting and the ffmpeg build. These decisions were made before the code that implements them: each one names the issues that implement it, and until those are merged it describes the intended design, not existing code. The [roadmap](../roadmap.md) holds the plan. How to add a decision: [documentation guide](../guides/documentation.md#decisions).

## The code lives in an npm workspaces monorepo

Status: decided (#3)

Implemented in #5, and each package in the issue that gives it its first code.

One repository holds the core, the UI, the backends, the two apps and the tools, so that a change to an interface and to every user of it lands in one pull request. The planned layout:

| Path | What it holds |
| --- | --- |
| `packages/core` | Pure TypeScript: types, camera registry and profiles (`src/cameras/`), decoders, reconstruction, analysis, palettes, corrections, the `.irvis` codec, PNG and CSV export |
| `packages/ui` | The React viewer |
| `packages/media` | Browser-only code: MP4 export through WebCodecs, `ByteSink` and `ByteSource` for OPFS and `File` |
| `packages/backend-browser` | `getUserMedia`, `MediaStreamTrackProcessor`, the reconstruction Worker |
| `packages/backend-electron` | The renderer side of the desktop backend: an IPC client implementing `CameraBackend`, `ByteSink` and `ByteSource` over the preload API, without importing `electron` |
| `packages/backend-replay` | Playback of `.irvis` files and fixtures |
| `apps/web` | The only UI build, deployed to Netlify and loaded by Electron; it picks the backends and storage at runtime |
| `apps/desktop` | Electron main process (ffmpeg, node-usb, the file writes and reads behind the IPC `ByteSink` and `ByteSource`) and preload |
| `tools/capture-cli` | Node tool for the hardware spikes |
| `fixtures/<camera-id>/` | Short series of real frames for tests |

Packages appear in the pull request that gives them their first real code, together with their rule in the documentation contract, not as empty stubs.

**Rejected:** pnpm workspaces, because they add a tool that every contributor and CI has to install, and npm workspaces cover what the repository needs. **Rejected:** separate repositories per package, because interface changes would need coordinated releases.

## Interfaces live in core as types, and apps inject the backends

Status: decided (#3)

Implemented in #5 (types), #10 (`backend-electron` without `electron` imports), #17 (minimal `backend-replay`), #19 (`Player`, `ByteSink` and `ByteSource` implementations), #20.

`CameraBackend`, `Player`, `RawFrame`, `ThermalFrame`, `CameraProfile`, `ByteSink` and `ByteSource` are types in `packages/core`. Dependencies point one way:

```
core <- media <- ui <- apps/web
core <- media <-------- apps/web
core <- backend-* <---- apps/web
```

`ui` imports `core`, and `media` only for the MP4 export; it never imports a backend package, and it sees backends and storage only through the core interfaces. The renderer, in the browser and in Electron alike, runs only the `apps/web` bundle, so `apps/web` wires the concrete backends and the `ByteSink` and `ByteSource` implementations into the UI at runtime: without the preload API, `backend-browser` and the OPFS and `File` implementations from `media`; with it, `backend-electron` and its IPC `ByteSink` and `ByteSource`. The app, not the UI, decides where a recording goes, and the UI works the same over a camera, a browser stream or a recording.

`apps/desktop` (the main process and the preload) serves the other end: ffmpeg, node-usb, and the file writes and reads with `fs` behind the IPC `ByteSink` and `ByteSource`, limited to the app's recordings directory, so that a read over IPC never becomes a read of an arbitrary path. `backend-electron` ends up in the bundle that Netlify serves too, so it never imports `electron`: it uses only the API that the preload exposes through `contextBridge`, and ESLint forbids the import.

Changes against the interfaces in the specification:

- `CameraBackend.id` is `'browser' | 'electron' | 'replay'`.
- `RawFrame` gains a third variant `{ kind: 'thermal'; frame: ThermalFrame }` for sources that already hold temperatures, such as a recording.
- `Player` (seek, pause, rate, a view-state stream) is a separate interface that `backend-replay` implements next to `CameraBackend`.
- `ByteSink` (append, flush, close) and `ByteSource` (size, read at an offset) return promises, because `File` and IPC are asynchronous. The `.irvis` codec and `backend-replay` see only these types; `media` implements them for OPFS and `File`, the Electron IPC client for files written by the main process. Writes over IPC have a bounded queue, so a slow disk does not grow memory.

Every backend declares `capabilities` (`exactRaw`, `deviceControl`, `concurrentWith`), and the UI offers only what they allow.

**Rejected:** the UI importing the backends directly, because the UI would then choose the backend and the storage itself, and the replay path and component tests would need special cases.

## One UI build serves the web and the desktop app

Status: decided (#3)

Implemented in #10 (the `app://` scheme and window settings), #17.

The specification asks for one UI build in both environments. `apps/web` is built once by Vite with `base: '/'`; Netlify serves it, and Electron loads the same files. The backend is chosen at runtime: a preload API present means Electron, otherwise the browser.

Electron serves the build through its own scheme, `app://irvis/`, registered with `protocol.registerSchemesAsPrivileged` as `standard`, `secure`, `supportFetchAPI` and `stream`, and answered by `protocol.handle` from the packaged `apps/web/dist`. The origin is stable, the page is a secure context, module Workers and localStorage behave as in a browser, and `stream` lets a `<video>` play the MP4 export preview. The window CSP lists `app:` where needed. Whether module Workers and `fetch` from `app://irvis/` also need `corsEnabled` is checked in #10, which corrects this decision if they do. Windows run with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`; the preload exposes only frames, the device list, the commands on the profile's allow-list, and file writes and reads (the IPC `ByteSink` and `ByteSource`) in the recordings directory.

**Rejected:** `file://`, because it needs another `base`, gives a `null` origin and blocks module Workers. **Rejected:** loading the Netlify URL, for security and for offline use. **Rejected:** two builds with different backends compiled in, because the specification asks for one.

## Core uses only APIs that browsers and Node share

Status: decided (#3)

Implemented in #5.

Core runs in the browser, in Workers, in Electron and in Node (tests, `capture-cli`). Its `tsconfig` has `lib: ["ES2022"]` and `types: []`, so DOM and Node APIs do not compile. An `env.d.ts` declares the short list of APIs that exist everywhere: `TextEncoder`, `TextDecoder`, `console`. Adding to that list is a decision. `CompressionStream`, `crypto`, `WebAssembly` and the DOM are not available in core: deflate comes from `fflate` (MIT, synchronous functions only), CRC32 is our own code, and WASM, if the reconstruction needs it, goes into a separate package. ESLint `no-restricted-imports` lets core import only its own files (relative paths) and `fflate`, which keeps out `node:*`, `@irvis/ui`, `@irvis/backend-*`, `@irvis/media` and every package another workspace's dependencies put into the root `node_modules`; tests next to the code may also import `vitest`. A test checks the dependencies in every package's `package.json`.

**Rejected:** the DOM library in core, because then core code would silently use browser-only APIs that fail in Node.

## Measurement code uses only correctly rounded arithmetic

Status: decided (#3)

Implemented in #5 (the ESLint rule), #8, #12, #13, #21 (the parity test).

ECMAScript requires `+`, `-`, `*`, `/` and `Math.sqrt` to be correctly rounded, but lets engines approximate `Math.pow`, `**`, `Math.exp`, `Math.log`, `Math.hypot`, `Math.cbrt`, the trigonometric functions and others. V8 and JavaScriptCore use different implementations, so a reading that goes through them can differ in the last bit between Chrome and Safari, and an exact comparison of readings across engines would fail.

In `packages/core/src/{analysis,corrections,cameras,irvis,reconstruction}/**` an ESLint rule allows only these members of `Math`: the functions `abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`, `sqrt`, `fround`, `imul`, `clz32`, and the constants `PI`, `E`, `SQRT2`, `SQRT1_2`, `LN2`, `LN10`, `LOG2E`, `LOG10E`. It also forbids `**` and access to `Math` through a variable or a computed name. T⁴ in the emissivity correction is computed by multiplication, the fourth root as `sqrt(sqrt(x))`. Readings are then bit-identical in every engine, and the parity test compares them exactly. An exception, such as a camera whose conversion follows the Planck curve, needs its own decision, and the parity test compares those values with a tolerance.

The reconstruction from I420/NV12 (`packages/core/src/reconstruction/`) is inside the rule too. Its output is approximate by nature and is judged by metrics against the exact path, but what it needs (the √|Δ| cost, medians, isotonic regression, R²) fits in the allowed functions, and its output is then the same in every engine. An unavoidable exception in any of these directories is an `eslint-disable` comment that names the rules it disables and the decision allowing it; a test, not ESLint, checks that, because an ESLint directive can silence the rule that would check it.

**Rejected:** comparing readings after rounding to the display precision, because values near a rounding boundary still flip. **Rejected:** a list of forbidden functions, because it lets through every approximated function nobody thought of.

## Emissivity is corrected with the fourth-power law and a reflected temperature

Status: decided (#13)

The sensor receives the radiation of the object and the radiation of the surroundings that the object reflects, and the camera reports it as the temperature of a black body. With temperatures in kelvin and radiation proportional to T⁴ (Stefan–Boltzmann), a reading T_m of an object with emissivity ε that reflects surroundings at R gives the object's temperature as

T⁴ = (T_m⁴ − (1 − ε)·R⁴) / ε

`temperatureCorrection` in `packages/core/src/corrections/emissivity.ts` computes T⁴ by multiplication (`x * x` squared) and the fourth root as `Math.sqrt(Math.sqrt(x))`, so the result is the same in every engine ([why](#measurement-code-uses-only-correctly-rounded-arithmetic)). The temperature offset is added after the emissivity correction, as kelvin, so it shifts the corrected reading by the same amount in °C and °F and does not depend on ε. For a camera that applies nothing itself, emissivity 1 changes nothing, whatever the reflected temperature. A reading at or below 0 K, and one whose T⁴ would come out at or below 0 (the object would be colder than its reflection allows), has no temperature (NaN), like a raw value outside a lookup table.

A real sensor sees a band, not every wavelength, and in the band the radiation grows faster than T⁴ near room temperature. Compared with the Planck radiation integrated over 8–14 µm, a band assumed here because it is typical for these sensors (computed numerically with a bisection on the band integral, not in the repository), the T⁴ law gives for a reflected temperature of 20 °C:

| ε | Reading | T⁴ law | 8–14 µm band | Difference |
| --- | --- | --- | --- | --- |
| 0.95 | 35 °C | 35.73 °C | 35.74 °C | −0.01 K |
| 0.95 | 60 °C | 61.74 °C | 61.80 °C | −0.06 K |
| 0.95 | 100 °C | 103.00 °C | 103.26 °C | −0.26 K |
| 0.8 | 60 °C | 68.04 °C | 68.34 °C | −0.30 K |
| 0.5 | 60 °C | 89.27 °C | 90.99 °C | −1.72 K |
| 0.95 | 300 °C | 306.90 °C | 310.01 °C | −3.11 K |
| 0.5 | 300 °C | 402.54 °C | 470.67 °C | −68.14 K |

For ε of 0.8 and more and objects up to 100 °C the difference stays within 0.3 K, well inside the ±2 °C accuracy these cameras are sold with; for low emissivity at high temperatures the T⁴ law underestimates by kelvins. TODO(owner): the P2 Pro's spectral band from its datasheet, and whether the vendor's app agrees with these numbers.

**Rejected:** the Planck band integral, because it needs `Math.exp`, which engines may approximate, and the camera's spectral response, which nobody has measured. **Rejected:** dividing the reading in kelvin by ε^¼ without the reflected term, because it treats the surroundings as 0 K: for ε = 0.95, a reading of 35 °C and surroundings at 20 °C it gives 39.0 °C instead of 35.7 °C. **Postponed:** the atmosphere (distance, humidity, transmission), which #13 does not ask for; the P2 Pro keeps a distance and a transmission among its TPD parameters, and if #7 shows that the camera applies them itself, they belong to the same relative correction. **Postponed:** a band-radiance table in the profile (data, evaluated with table lookups and interpolation, so still the same in every engine) if a measurement shows that the T⁴ law is not good enough for a camera.

## The software correction works relative to what the camera applied

Status: decided (#13)

If the camera applies an emissivity ε_c and a reflected temperature R_c to its raw values itself, as the P2 Pro may do with its TPD parameters (#7 measures it), correcting its readings with the user's ε would apply emissivity twice. `temperatureCorrection` therefore first undoes the camera's correction, W = ε_c·T_c⁴ + (1 − ε_c)·R_c⁴, which is what a sensor without it would have reported, and then applies the user's: T⁴ = (W − (1 − ε)·R⁴) / ε. Both steps are one formula, T⁴ = a·T_c⁴ + b. When the user's ε and R are the same numbers as the camera's, the reading is returned unchanged, so a camera that applies the same correction as the user is not touched at all. `settingsFromCamera` starts the user's settings from the camera's, so that nothing changes until the user does; `DEFAULT_CORRECTION` (ε 1) would undo the camera's correction instead. The comparison is exact, not within a tolerance: a value that differs in the last bit goes through the formula, which moves the reading by about 1e-13 K, far below anything shown, and a tolerance would only move the edge somewhere else.

What the camera applied is read from the frame's `CameraStateSnapshot`, not from the profile, because a `.irvis` chunk stores the snapshot and a recording has to be readable without the profile. The two state field ids `emissivity` and `reflected-temperature` are reserved for this: a profile may only use them for settings the camera applies to the raw values (`affects: 'data'`), and `validateProfile` checks that they come together with the right kind and unit. A state without them means the camera applies nothing (ε_c = 1). In the browser, where the camera state cannot be read, the snapshot holds what the user declared or the profile's defaults, so the same path covers both.

**Rejected:** assuming the camera applies nothing, because if #7 shows that it does, every reading corrected in software would be wrong, and recordings made before the fix could not be corrected later. **Rejected:** a flag in the profile saying that the camera applies emissivity, because a recording stores only the snapshot, so a file would depend on the profile to be read correctly. **Rejected:** a separate field in the `.irvis` chunk record, because the snapshot already holds the camera's settings and two places for one fact can disagree.

## Alarms and isotherms skip uncertain pixels

Status: decided (#13)

Threshold alarms and isotherms work on corrected readings (emissivity, reflected temperature and offset applied), because those are the numbers the user sees and sets thresholds against. A pixel whose `uncertain` value is not 0 never turns an alarm on and is never painted in an isotherm colour, and neither is a pixel without a temperature (NaN). The reconstruction marks a pixel uncertain when it could not recover the raw value, so the value can be off by kelvins; an alarm turned on by such a pixel, or a hot spot painted where there is none, is worse than missing one pixel. The measurements of #12 skip them the same way: min and max, the point, line and area readings, the histogram and the automatic palette range (`packages/core/src/analysis/measurements.ts`, `render.ts`), so the viewer never puts a min or max marker on an uncertain pixel and one wrong pixel cannot stretch the range. The palette still colours an uncertain pixel by its value, because the viewer can mark it with its overlay and a hole in the image would hide more than it shows.

An alarm that is on stays on until the hottest (for the high alarm) or coldest (for the low one) pixel is more than a hysteresis past the threshold on the other side, 0.5 K by default, because sensor noise around the threshold would otherwise switch it about every frame. Bounds are included: a pixel exactly at the threshold turns it on, and an isotherm includes both ends of its band.

**Rejected:** alarms and isotherms on uncorrected readings, because the user's threshold would then mean another temperature than the one shown. **Rejected:** no hysteresis, because an alarm sound that switches 25 times a second at the threshold is useless. **Postponed:** alarms over an area instead of the whole frame, until several areas exist (#18).

## Palettes are 256-colour ramps defined by stops

Status: decided (#12)

Each of the six palettes (Iron, White Hot, Black Hot, Rainbow, Red Hot, Cold Blue) is a list of colour stops at indexes from 0 to 255 (`packages/core/src/analysis/palettes.ts`), and core builds a 256-entry RGB table from them when it loads: between two stops each channel goes linearly from one colour to the other and is rounded with `Math.round`. Every step is integer arithmetic or correctly rounded, so every engine builds the same bytes, and a test pins a hash of the six tables. A reading v in a range from min to max gets entry floor((v − min) × 256 / (max − min)), clamped to 0 and 255, so the range is split into 256 equal steps and its top reading is the hottest colour. A pixel without a temperature (NaN) is transparent black in the RGBA image, so it shows the viewer's background instead of a colour that would read as a temperature.

The automatic range runs from the coldest to the hottest counted pixel of the frame, without a margin and without smoothing over time; a frame whose counted pixels all read the same gets 1 K centred on that reading (`FLAT_RANGE_SPAN`). Smoothing the range between frames, if the viewer needs it against flicker, belongs to the viewer (#17), which knows the frame rate.

The stops are irvis's own, chosen so that every palette but Rainbow and Black Hot gets brighter with temperature and Black Hot darker; they are not copied from the vendor's app or another product. TODO(owner): compare them with the vendor app's palettes in the screenshots of #11, in particular what "Red Hot" and "Cold Blue" mean there (a colour ramp, as here, or a grey image with only the hottest or coldest part in colour).

**Rejected:** tables of 256 literal colours in the source, because stops are short enough to review and to compare with a screenshot, and a table built from them changes only when a stop does. **Rejected:** palettes as data in the camera profile, because a palette belongs to the viewer, not to a camera. **Rejected:** more than 256 entries, because over a range of 10 K one step is already 0.04 K, finer than the eye tells neighbouring colours apart, and the scale bar shows the same 256 entries.

## The UI is written in React

Status: decided (#3)

Implemented in #5 (the placeholder page of `apps/web` and its component tests), #17.

The viewer has many panels, settings and measurement overlays. Bundle size does not matter for a desktop app and a static site. What matters is the ecosystem (components, i18n, testing tools) and that the people and agents working on the code know it well. Camera frames at 25 per second bypass the React render cycle: the canvas is drawn directly from an external store, and numeric readouts update about five times a second.

**Rejected:** Preact, because its compatibility layer has edge cases and saving about 40 KB buys nothing here. **Rejected:** no framework, because the amount of UI state would end in a hand-written framework.

## Workspace packages are consumed as TypeScript source

Status: decided (#5)

A package's `exports` point at its TypeScript source (`./src/index.ts`), and there is no build step per package. Vite bundles the source into `apps/web`, Vitest transpiles it in tests, and Node 26 runs it directly with type stripping, which `tools/capture-cli` and the Electron main process need. Two settings make the last one work: relative imports carry their extension (`./frames.ts`, `allowImportingTsExtensions`), because Node does not guess extensions, and `erasableSyntaxOnly` forbids `enum`, `namespace` and constructor parameter properties, which Node cannot strip. `tsc --build` only checks the code; core's library project emits declarations into `node_modules/.tsbuild/`, so that `apps/web` type-checks against core's API under its own `lib` without core's `env.d.ts`.

**Rejected:** compiling every package to `dist/` and exporting the JavaScript, because every change then needs a rebuild in dependency order, a stale `dist/` silently runs old code, and the packages are never published to npm. **Rejected:** extensionless imports, because Node cannot resolve them without a loader or a bundler.

## TypeScript stays on 6.0 until typescript-eslint supports 7

Status: decided (#5)

TypeScript 7.0.2, the native compiler, was the latest release when the toolchain was set up (November 2026), but typescript-eslint 8.72.2 accepts only `typescript` `>=4.8.4 <6.1.0`. Type-aware lint rules matter here: `no-floating-promises` catches a forgotten `await` on `ByteSink.append`, which would lose recording data without an error. The root `package.json` therefore pins `typescript` to `~6.0.3`. Move to 7 when typescript-eslint supports it.

**Rejected:** TypeScript 7 with ESLint rules that need no type information, because the rules that catch asynchronous mistakes are exactly the type-aware ones. **Rejected:** TypeScript 7 for `tsc` and 6.0 for ESLint side by side, because the two compilers would disagree on some code and nobody would know which one is right.

## Frames and state in core are subscriptions

Status: decided (#5)

Core has no `EventTarget`, `ReadableStream` or timers ([its APIs](#core-uses-only-apis-that-browsers-and-node-share)), so the types say how values over time are delivered without them: `Subscribable<T>` (`subscribe`, taking a listener and returning an `Unsubscribe`) for camera frames, and `Store<T>`, which adds `getSnapshot`, for state such as `Player.viewState`. Both are bound function properties, not methods, so that callers can pass `store.subscribe` and `store.getSnapshot` on their own, as `useSyncExternalStore(store.subscribe, store.getSnapshot)` does, without losing `this` and without typescript-eslint's `unbound-method` error. `Store` has the shape React's `useSyncExternalStore` needs, which is how the UI draws 25 frames a second without going through React state ([React decision](#the-ui-is-written-in-react)). A listener that is too slow makes the backend drop frames, because a live view wants the newest frame, not a queue.

**Rejected:** `AsyncIterable<RawFrame>`, because it queues or blocks frames for a slow consumer, and every consumer needs its own loop. **Rejected:** methods, because every caller would have to wrap them in arrow functions (`(cb) => store.subscribe(cb)`) and an unbound method fails at runtime in a class-based implementation. **Rejected:** `EventTarget` or `ReadableStream` in the types, because core cannot use them and Node and the browser differ in details.

## A camera is a profile, and its conversion is data

Status: decided (#3)

Implemented in #5 (schema and registry), #6 (the first profile), #7 (commands and camera state).

Adding a camera means a new directory `packages/core/src/cameras/<id>/` (`profile.ts` and a `README.md` with the source and confidence of every constant) and one line in the registry in `packages/core/src/cameras/index.ts`, with no change to the UI, the backends or the codec. A profile declares:

| Part | What it says | Who uses it |
| --- | --- | --- |
| Identification | VID/PID, a name pattern, how to choose when cameras share a PID (the T7 and the TC001 both use 0x5830; when unsure, the user chooses) | device selection |
| Video modes | resolution, frame rate, pixel format, whether a command must enable the mode | ffmpeg arguments in Electron, `getUserMedia` constraints in the browser |
| Frame layout | where the temperature data are and how they are packed, declaratively or as a decoder | the decoder; the reconstruction, to know whether 4:2:0 frames can be recovered |
| Conversion | raw to °C as data: linear, polynomial or LUT per gain mode, optional parameters that change every frame (such as the sensor temperature), with source and confidence | analysis, export, every `.irvis` chunk |
| Sensor | NETD, accuracy, temperature ranges | the default recording threshold, the default palette range |
| Camera state | settings the camera keeps that change the data or their meaning; for the P2 Pro: gain, the TPD parameters (emissivity, reflected temperature, distance and others), the palette of the upper half, the sensor temperature | Electron reads them at connect, after every command, and the sensor temperature about once a second; the browser uses what the user declares |
| Commands | NUC, gain and others with their transport (vendor control transfer or UVC extension unit), codes, parameters and confidence | Electron; the UI builds its controls from this list |

The conversion is data, not the `toCelsius(raw, mode)` function of the specification, so that a `.irvis` file can be read without the profile. A test suite runs against every registered profile: decoding its fixtures, plausible temperatures, `.irvis` round trip, commands that match the schema.

The browser cannot read the camera state. It assumes high gain and factory settings, says so ("camera mode unknown, readings assume high gain") until the user confirms or declares the mode as a software setting, and warns when the data look inconsistent. If the camera applies emissivity to the raw data itself, the software correction works relative to the camera state and never applies emissivity twice ([how](#the-software-correction-works-relative-to-what-the-camera-applied)).

**Rejected:** fixed dimensions and a conversion function in the profile, as in the specification, because the next camera would need code changes outside its directory and recordings would depend on code.

## Loading camera profiles from files at runtime

Status: postponed (#3)

Profiles are compiled into the app, so a new camera is a pull request with its fixtures and tests. Loading a profile from a file without rebuilding the app is postponed until someone needs it; it would need a data-only profile format and a trust model for files from strangers.

## Recordings are .irvis files and MP4 is an export

Status: decided (#3)

Implemented in #14 (format and codec), #15 (the PNG photo), #16 (measurements, v1 frozen), #19 (recording, playback, MP4 export).

A recording keeps the temperature of every pixel in every frame, so that measurements, palette and range can change after the fact. A video file keeps a coloured picture; temperatures cannot be read back from it. A recording therefore writes only a `.irvis` file, and MP4 is an export from it, with palette, range, units, overlays and upscaling chosen at export time (by default, as seen live). A snapshot is a `.irvis` file with one frame, and the PNG photo embeds that one-frame `.irvis` in a private ancillary chunk, so there is one temperature format and irvis opens both files the same way. The format specification is [irvis-format.md](../irvis-format.md), with a version number.

The codec works like a video codec, with a guaranteed error bound: a keyframe about every 10 seconds and after every gain or camera-state change and every detected NUC; 8×8 blocks predicted from the previous decoded frame; per block the encoder picks the cheapest of skip (every pixel within the threshold), resend the block towards a temporally denoised value, or send only the pixels outside the threshold; an escape code for large residuals; deflate at the end. For every pixel and frame, |measured − stored| ≤ T. The threshold T comes from the camera profile (a multiple of the sensor noise, NETD, not of its accuracy: noise sets which detail is real), can be set per file before recording, and T = 0 is lossless. A file can be re-encoded to a larger threshold, never to a smaller one.

Estimates from a simulation on synthetic data (256×192 at 25 fps, random noise σ = 2.5 raw units ≈ 0.04 °C, deflate level 9, 50 frames extrapolated to a minute), to be replaced by measurements on real frames:

| Variant | Static scene | Moving hand |
| --- | --- | --- |
| Uncompressed | 147 MB/min | 147 MB/min |
| T = 0.125 °C, whole blocks only | 4.2 MB/min | 8.3 MB/min |
| T = 0.125 °C, only pixels outside T | 2.4 MB/min | 5.5 MB/min |
| T = 0.25 °C, whole blocks only | 0.28 MB/min | 3.3 MB/min |
| T = 0.25 °C, only pixels outside T | 0.81 MB/min | 3.0 MB/min |
| H.264 video of the same scene | about 0.1 MB/min | about 0.1 MB/min |

Neither block mode wins everywhere, which is why the encoder chooses per block. The simulation has no drift, dead pixels or shutter events. The TypeScript benchmark that replaces the simulation, and its first results on synthetic data, are in the [specification](../irvis-format.md#benchmark).

Writing survives crashes: Electron writes with `fs` in the main process and syncs about every second; the browser writes to OPFS through `createSyncAccessHandle()` in a Worker, flushes about every second, asks for persistent storage and checks the free space first, and offers to recover unfinished recordings at start. A crash, an unplugged camera or a closed tab loses at most about one second. MP4 export uses WebCodecs and an existing muxer, without ffmpeg.

**Rejected:** recording MP4 next to `.irvis`, because the data would be stored twice and the palette fixed in advance. **Rejected:** storing in `.irvis` only the correction to the decoded MP4, because in simulation it saved 0–20% (and lost at T = 0.125 °C), while tying `.irvis` to a bit-exact copy of one MP4 in greyscale without a palette; re-encoding the video, as messengers do, would destroy the data. **Rejected:** a lossless default, because the sensor noise makes lossless data about 38 MB/min.

## The .irvis codec stores values near a denoised estimate

Status: decided (#14)

Issue #14 lists three block modes: skip, resend the block towards a temporally denoised value, and send a mask with only the pixels outside T. The encoder has all three, and the frame body stores a quantised residual for every value it sends, keyframes included. Every value it sends lies within h = ⌊T/4⌋ of a target, and the target is the per-pixel denoised estimate clamped to within T − h of the measured value, so |measured − stored| ≤ T still holds ([how](../irvis-format.md#how-irvis-encodes)). Values therefore land near the noise-free level of the pixel, and the next frame's noise rarely takes them outside T, so the blocks of a still scene stay skipped.

On the benchmark's synthetic scenes ([results](../irvis-format.md#benchmark)), the alternative of storing each sent value at the nearest point within T of the measured one (step 2T + 1) took 8.31 MB/min for a static scene at T = 8 raw and 4.56 MB/min at T = 16, against 1.05 and 0.11 MB/min now, because its values sit anywhere in ±T and half of them fall out with the next frame's noise. Coding the targets exactly (h = 0) took 7.05 and 5.03 MB/min for the moving hand at T = 8 and 16, against 4.72 and 2.72. The quantiser step is stored in each chunk record, so the encoder's settings (h, the weight of the estimate, the choice between the modes) can change without a format change; #16 tunes them on real frames.

**Rejected:** quantising around the measured value with step 2T + 1, for the sizes above. **Rejected:** coding every sent value exactly (h = 0), for the sizes above.

## Each .irvis frame is a record of its own, deflated alone

Status: decided (#14)

A frame record carries its own length and CRC-32, and its body is deflated on its own. A file cut anywhere is then readable up to the last whole frame; a damaged byte costs the rest of its chunk when the index is intact and everything after it when the file has to be scanned, and nothing before it; and a writer appends a frame with one `ByteSink.append` and needs no state from the deflate of earlier frames. The 9 bytes of framing and the few bytes of a fresh deflate block cost about 0.4 KB/s at 25 fps, which is under 0.03 MB/min.

**Rejected:** one deflate stream per chunk with a sync flush after every frame, because a reader would need streaming inflate across records and a damaged record would break the rest of the chunk's stream; whether the shared history would compress better is not measured (TODO(owner): measure in #16 if the deflate share of the files matters). **Rejected:** a CRC per chunk only, because a crash would lose up to 10 s instead of about 1 s.

## .irvis metadata is JSON and frame data are binary

Status: decided (#14)

The header, the chunk records and the view-state records are JSON objects inside CRC-checked records; frame records and the index are binary. Metadata are written once per file, once per chunk (about every 10 s) or when the user changes a setting, so their size does not matter, and JSON keeps them readable with any tool, holds the profile's `Conversion` and `CameraStateSnapshot` as they are, and takes a new field without a new parser. Frames are 25 a second, so they are binary.

**Rejected:** a binary header, because every field added before v1 is frozen would need its own encoding. **Rejected:** JSON for the index, because a one-hour file has 90 000 entries.

## The .irvis threshold is in raw units

Status: decided (#14)

T is an integer number of raw sensor units, and the guarantee is |measured raw − stored raw| ≤ T, checked exactly in integers. A file can hold chunks with different conversions (a gain change), and a conversion can be a polynomial or a table, so one temperature bound would mean different raw bounds in different places and could not be met exactly. The UI converts a bound in kelvin to raw units with the profile's conversion, as the benchmark does with 1/64 K per unit for the P2 Pro.

**Rejected:** T in kelvin in the header, because the codec would then work with a bound that holds only approximately for non-linear conversions.

## Camera profiles carry a version

Status: decided (#14)

`CameraProfile.version` is a positive integer that a profile raises whenever a constant that changes readings changes, and every `.irvis` header records the profile's id and version. A recording keeps its own conversion and needs no profile to be read, but the version tells later which constants it was made with, for example when a conversion is corrected after a measurement.

**Rejected:** recording only the profile id, because a corrected conversion would be indistinguishable from the old one. **Rejected:** a content hash of the profile, because it changes with every edit that changes no reading, such as a corrected source link.

## Motion compensation in .irvis is postponed

Status: postponed (#14)

Predicting a block from a shifted block of the previous frame would help a moving camera or a moving object, but whether it pays off depends on real frames: their noise, how often the camera moves, and how much of a block motion compensation could match within T. Issue #14 asks to decide after measurements on real frames, which come with the fixtures in #16. Version 1 has no motion vectors; adding them needs a new block mode or a new format version.

## The web version is hosted on Netlify and goes to production from release

Status: decided (#3)

Implemented in #5 (`netlify.toml`, "Promote to release"), #24.

GitHub Pages is not available for private repositories on the current plan. Netlify deploys from a private repository and builds a preview for every pull request, which lets the browser path be tried on each change. On the free plan a month has 300 credits and a production deploy costs 15, so about 20 production deploys a month; previews are free ([Netlify pricing](https://www.netlify.com/pricing/), November 2026). Production therefore publishes only from the `release` branch. A manual workflow, "Promote to release", moves it: it checks that the commit is on `main` (`git merge-base --is-ancestor`) and pushes without `--force`, so only reviewed commits reach production and only by fast-forward. Only that job gets `contents: write`. The guarantee is procedural while `release` cannot be protected on this plan: a direct push to `release`, or a run of a changed copy of the workflow from another branch, gets past it ([details](../guides/development.md#promote-to-release)). The site is public even while the repository is private.

**Rejected:** deploying production on every merge to `main`, because parallel work would use up the credits. **Rejected:** Cloudflare Pages as the first choice; it is the fallback if Netlify's limits or reported deploy blocks get in the way.

## The desktop app ships its own LGPL ffmpeg build

Status: decided (#3)

Implemented in #23.

The desktop app needs ffmpeg only to read raw YUYV bytes from the operating system's camera API (AVFoundation, V4L2, DirectShow) and write them to a pipe. A minimal build with just those inputs, the rawvideo output, no `--enable-gpl` and no codecs is LGPL and a few megabytes. The package carries the LGPL text, the build script is in the repository, and the source tarball goes into each GitHub Release. `IRVIS_FFMPEG` points the app at another ffmpeg, which until the release milestone is the only way: the system ffmpeg.

**Rejected:** `ffmpeg-static`, because its builds are GPL (the sources of the exact binary must be offered), contain codecs covered by patents, and weigh about 70–80 MB per platform. **Rejected:** ffmpeg compiled to WASM, because WASM cannot reach the camera APIs of the operating system, and `getUserMedia` delivers the lossy 4:2:0 frames the exact path exists to avoid.

## The capture tool runs on Node type stripping, without tsx

Status: decided (#6)

Issue #6 asked for `tools/capture-cli` as "Node with tsx". Node 26 runs TypeScript itself by stripping the types, which the [decision on TypeScript source](#workspace-packages-are-consumed-as-typescript-source) already relies on for this tool and which the documentation check uses. `npm run spike:m1` is therefore `node tools/capture-cli/src/cli.ts spike`, and `@irvis/core` is imported as source through the workspace link: Node resolves the link to `packages/core/src/`, outside `node_modules`, where it strips types.

**Rejected:** tsx, because it adds a dependency and a second way of running TypeScript whose transforms (for example `enum`) would accept code that Node, Vitest and `erasableSyntaxOnly` reject.

## Captures keep the camera's bytes with an ffmpeg stream copy

Status: decided (#6)

The exact path depends on the bytes reaching irvis as the camera sent them. `capture-cli` asks AVFoundation for `yuyv422` and passes the packets on with `-c:v copy` to a `rawvideo` output on stdout, plus a second stream copy to `framecrc`, which lists the size and the pts of every packet ([how](../features/capture-cli-technical.md#capture)). ffmpeg then never decodes or converts a pixel, so what AVFoundation delivered is not hidden by a conversion. A format with another size per pixel (`nv12`, `bgr0`) or padded rows shows in the packet sizes. A format of the same size, such as `uyvy422`, does not: every packet still has 196 608 B, so the capture reads the format ffmpeg's input stream has from its log and stores it in `meta.json`, and the report says when it is not `yuyv422`. The Electron backend (#20) is expected to use the same arguments, once M1 shows that they work on the camera.

**Rejected:** `-f rawvideo -pix_fmt yuyv422` without the copy, because ffmpeg would silently convert from whatever AVFoundation chose, and every frame would still have the expected size. **Rejected:** cutting the stream by size alone, because a padded or converted frame would pass unnoticed, and a reordered one (`uyvy422`) passes even the packet sizes.

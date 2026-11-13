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
| `packages/backend-electron` | The renderer side of the desktop backend: an IPC client implementing `CameraBackend` |
| `packages/backend-replay` | Playback of `.irvis` files and fixtures |
| `apps/web` | The only UI build, deployed to Netlify and loaded by Electron |
| `apps/desktop` | Electron main process (ffmpeg, node-usb, file writes) and preload |
| `tools/capture-cli` | Node tool for the hardware spikes |
| `fixtures/<camera-id>/` | Short series of real frames for tests |

Packages appear in the pull request that gives them their first real code, together with their rule in the documentation contract, not as empty stubs.

**Rejected:** pnpm workspaces, because they add a tool that every contributor and CI has to install, and npm workspaces cover what the repository needs. **Rejected:** separate repositories per package, because interface changes would need coordinated releases.

## Interfaces live in core as types, and apps inject the backends

Status: decided (#3)

Implemented in #5 (types), #17 (minimal `backend-replay`), #19 (`Player`, `ByteSink` and `ByteSource` implementations), #20.

`CameraBackend`, `Player`, `RawFrame`, `ThermalFrame`, `CameraProfile`, `ByteSink` and `ByteSource` are types in `packages/core`. Dependencies point one way:

```
core <- media <- ui <- apps
core <- backend-* <------ apps
```

`ui` imports `core` and `media` (it calls the MP4 export and the OPFS writer), never a backend package; it sees backends only through the core interfaces. The apps wire the concrete backends into the UI, so the UI works the same over a camera, a browser stream or a recording.

Changes against the interfaces in the specification:

- `CameraBackend.id` is `'browser' | 'electron' | 'replay'`.
- `RawFrame` gains a third variant `{ kind: 'thermal'; frame: ThermalFrame }` for sources that already hold temperatures, such as a recording.
- `Player` (seek, pause, rate, a view-state stream) is a separate interface that `backend-replay` implements next to `CameraBackend`.
- `ByteSink` (append, flush, close) and `ByteSource` (size, read at an offset) return promises, because `File` and IPC are asynchronous. The `.irvis` codec and `backend-replay` see only these types; `media` implements them for OPFS and `File`, the Electron IPC client for files written by the main process. Writes over IPC have a bounded queue, so a slow disk does not grow memory.

Every backend declares `capabilities` (`exactRaw`, `deviceControl`, `concurrentWith`), and the UI offers only what they allow.

**Rejected:** the UI importing the backends directly, because the browser build would then pull in Electron code and the replay path would need special cases.

## One UI build serves the web and the desktop app

Status: decided (#3)

Implemented in #10 (the `app://` scheme and window settings), #17.

The specification asks for one UI build in both environments. `apps/web` is built once by Vite with `base: '/'`; Netlify serves it, and Electron loads the same files. The backend is chosen at runtime: a preload API present means Electron, otherwise the browser.

Electron serves the build through its own scheme, `app://irvis/`, registered with `protocol.registerSchemesAsPrivileged` as `standard`, `secure`, `supportFetchAPI` and `stream`, and answered by `protocol.handle` from the packaged `apps/web/dist`. The origin is stable, the page is a secure context, module Workers and localStorage behave as in a browser, and `stream` lets a `<video>` play the MP4 export preview. The window CSP lists `app:` where needed. Whether module Workers and `fetch` from `app://irvis/` also need `corsEnabled` is checked in #10, which corrects this decision if they do. Windows run with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`; the preload exposes only frames, the device list, the commands on the profile's allow-list and file writes.

**Rejected:** `file://`, because it needs another `base`, gives a `null` origin and blocks module Workers. **Rejected:** loading the Netlify URL, for security and for offline use. **Rejected:** two builds with different backends compiled in, because the specification asks for one.

## Core uses only APIs that browsers and Node share

Status: decided (#3)

Implemented in #5.

Core runs in the browser, in Workers, in Electron and in Node (tests, `capture-cli`). Its `tsconfig` has `lib: ["ES2022"]` and `types: []`, so DOM and Node APIs do not compile. An `env.d.ts` declares the short list of APIs that exist everywhere: `TextEncoder`, `TextDecoder`, `console`. Adding to that list is a decision. `CompressionStream`, `crypto`, `WebAssembly` and the DOM are not available in core: deflate comes from `fflate` (MIT, synchronous functions only), CRC32 is our own code, and WASM, if the reconstruction needs it, goes into a separate package. ESLint `no-restricted-imports` blocks `node:*`, `@irvis/ui`, `@irvis/backend-*` and `@irvis/media` in core, and a test checks the dependencies in every package's `package.json`.

**Rejected:** the DOM library in core, because then core code would silently use browser-only APIs that fail in Node.

## Measurement code uses only correctly rounded arithmetic

Status: decided (#3)

Implemented in #5 (the ESLint rule), #12, #13, #21 (the parity test).

ECMAScript requires `+`, `-`, `*`, `/` and `Math.sqrt` to be correctly rounded, but lets engines approximate `Math.pow`, `**`, `Math.exp`, `Math.log`, `Math.hypot`, `Math.cbrt`, the trigonometric functions and others. V8 and JavaScriptCore use different implementations, so a reading that goes through them can differ in the last bit between Chrome and Safari, and an exact comparison of readings across engines would fail.

In `packages/core/src/{analysis,corrections,cameras,irvis}/**` an ESLint rule allows only these members of `Math`: the functions `abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`, `sqrt`, `fround`, `imul`, `clz32`, and the constants `PI`, `E`, `SQRT2`, `SQRT1_2`, `LN2`, `LN10`, `LOG2E`, `LOG10E`. It also forbids `**` and access to `Math` through a variable or a computed name. T⁴ in the emissivity correction is computed by multiplication, the fourth root as `sqrt(sqrt(x))`. Readings are then bit-identical in every engine, and the parity test compares them exactly. An exception, such as a camera whose conversion follows the Planck curve, needs its own decision, and the parity test compares those values with a tolerance.

The reconstruction from I420/NV12 (`packages/core/src/reconstruction/`) is outside the rule: its output is approximate by nature and is judged by metrics against the exact path, not compared bit by bit. It still prefers the allowed functions, so that its regression tests give the same numbers in Node and in browsers.

**Rejected:** comparing readings after rounding to the display precision, because values near a rounding boundary still flip. **Rejected:** a list of forbidden functions, because it lets through every approximated function nobody thought of.

## The UI is written in React

Status: decided (#3)

Implemented in #17.

The viewer has many panels, settings and measurement overlays. Bundle size does not matter for a desktop app and a static site. What matters is the ecosystem (components, i18n, testing tools) and that the people and agents working on the code know it well. Camera frames at 25 per second bypass the React render cycle: the canvas is drawn directly from an external store, and numeric readouts update about five times a second.

**Rejected:** Preact, because its compatibility layer has edge cases and saving about 40 KB buys nothing here. **Rejected:** no framework, because the amount of UI state would end in a hand-written framework.

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

The browser cannot read the camera state. It assumes high gain and factory settings, says so ("camera mode unknown, readings assume high gain") until the user confirms or declares the mode as a software setting, and warns when the data look inconsistent. If the camera applies emissivity to the raw data itself, the software correction works relative to the camera state and never applies emissivity twice.

**Rejected:** fixed dimensions and a conversion function in the profile, as in the specification, because the next camera would need code changes outside its directory and recordings would depend on code.

## Loading camera profiles from files at runtime

Status: postponed (#3)

Profiles are compiled into the app, so a new camera is a pull request with its fixtures and tests. Loading a profile from a file without rebuilding the app is postponed until someone needs it; it would need a data-only profile format and a trust model for files from strangers.

## Recordings are .irvis files and MP4 is an export

Status: decided (#3)

Implemented in #14 (format and codec), #16 (measurements, v1 frozen), #19 (recording, playback, MP4 export).

A recording keeps the temperature of every pixel in every frame, so that measurements, palette and range can change after the fact. A video file keeps a coloured picture; temperatures cannot be read back from it. A recording therefore writes only a `.irvis` file, and MP4 is an export from it, with palette, range, units, overlays and upscaling chosen at export time (by default, as seen live). A snapshot is a `.irvis` file with one frame, and the PNG photo embeds that one-frame `.irvis` in a private ancillary chunk, so there is one temperature format and irvis opens both files the same way. The format specification will be `irvis-format.md` (planned, M4), with a version number.

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

Neither block mode wins everywhere, which is why the encoder chooses per block. The simulation has no drift, dead pixels or shutter events.

Writing survives crashes: Electron writes with `fs` in the main process and syncs about every second; the browser writes to OPFS through `createSyncAccessHandle()` in a Worker, flushes about every second, asks for persistent storage and checks the free space first, and offers to recover unfinished recordings at start. A crash, an unplugged camera or a closed tab loses at most about one second. MP4 export uses WebCodecs and an existing muxer, without ffmpeg.

**Rejected:** recording MP4 next to `.irvis`, because the data would be stored twice and the palette fixed in advance. **Rejected:** storing in `.irvis` only the correction to the decoded MP4, because in simulation it saved 0–20% (and lost at T = 0.125 °C), while tying `.irvis` to a bit-exact copy of one MP4 in greyscale without a palette; re-encoding the video, as messengers do, would destroy the data. **Rejected:** a lossless default, because the sensor noise makes lossless data about 38 MB/min.

## The web version is hosted on Netlify and goes to production from release

Status: decided (#3)

Implemented in #5 (`netlify.toml`, "Promote to release"), #24.

GitHub Pages is not available for private repositories on the current plan. Netlify deploys from a private repository and builds a preview for every pull request, which lets the browser path be tried on each change. On the free plan a month has 300 credits and a production deploy costs 15, so about 20 production deploys a month; previews are free ([Netlify pricing](https://www.netlify.com/pricing/), November 2026). Production therefore publishes only from the `release` branch. A manual workflow, "Promote to release", moves it: it checks that the commit is on `main` (`git merge-base --is-ancestor`) and pushes without `--force`, so only reviewed commits reach production and only by fast-forward. Only that job gets `contents: write`. The site is public even while the repository is private.

**Rejected:** deploying production on every merge to `main`, because parallel work would use up the credits. **Rejected:** Cloudflare Pages as the first choice; it is the fallback if Netlify's limits or reported deploy blocks get in the way.

## The desktop app ships its own LGPL ffmpeg build

Status: decided (#3)

Implemented in #23.

The desktop app needs ffmpeg only to read raw YUYV bytes from the operating system's camera API (AVFoundation, V4L2, DirectShow) and write them to a pipe. A minimal build with just those inputs, the rawvideo output, no `--enable-gpl` and no codecs is LGPL and a few megabytes. The package carries the LGPL text, the build script is in the repository, and the source tarball goes into each GitHub Release. `IRVIS_FFMPEG` points the app at another ffmpeg, which until the release milestone is the only way: the system ffmpeg.

**Rejected:** `ffmpeg-static`, because its builds are GPL (the sources of the exact binary must be offered), contain codecs covered by patents, and weigh about 70–80 MB per platform. **Rejected:** ffmpeg compiled to WASM, because WASM cannot reach the camera APIs of the operating system, and `getUserMedia` delivers the lossy 4:2:0 frames the exact path exists to avoid.

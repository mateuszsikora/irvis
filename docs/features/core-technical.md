# Core: technical

How `packages/core` is built, checked and laid out, for whoever changes it. The camera registry and the profile schema in `packages/core/src/cameras/` are in [cameras: technical](cameras-technical.md). Why core is shaped this way: [architecture decisions](../decisions/architecture.md).

## Data flow

No backend delivers frames to core yet; the types fix the path, and the YUYV decoders (step 3), the `.irvis` codec (steps 4 and 5), the corrections (step 6) and the palettes and measurements (step 7) exist:

1. A `CameraBackend` (`src/backend.ts`) lists devices and `open()`s one with an `OpenRequest`: the device id, the `CameraProfile` chosen for it, and a `VideoMode.id` of that profile.
2. The `CameraSession` it returns publishes `RawFrame`s (`src/frames.ts`) through `frames`, a `Subscribable<RawFrame>` (`src/store.ts`). A listener that is slow makes the backend drop frames; nothing queues them.
3. `decodeThermalFrame` (`src/yuyv.ts`) turns a `YuyvFrame` into a `ThermalFrame` by the `FrameLayout` of the profile's `VideoMode`: it checks the frame (`checkYuyvFrame`: an even width, a positive height, width × height × 2 bytes) and that it has the mode's size, then `decodeYuyvRaw` reads the thermal rows as one little-endian 16-bit value per pixel, raw = lo | hi << 8, through a `DataView`, so the result does not depend on the platform's byte order or on the alignment of `data`. The result carries the given `Conversion` and `CameraStateSnapshot` and `uncertain: null`. `decodeYuyvImage` splits other rows into Y (one byte per pixel) and U and V (one byte per pair of pixels), which is how the camera's own image in the upper rows is read. `toCelsius` (`src/cameras/conversion.ts`) evaluates the conversion ([cameras: technical](cameras-technical.md#interfaces)). `reconstructPlanar` recovers raw values and uncertainty from a `Yuv420Frame` (see [planar reconstruction](#planar-reconstruction)). A `{ kind: 'thermal' }` frame, from a recording, already is one.
4. `IrvisWriter` (`src/irvis/writer.ts`) writes `ThermalFrame`s to a `ByteSink` (`src/bytes.ts`) as a `.irvis` file ([specification](../irvis-format.md)). `create` checks the options and appends the signature and the header. Each `appendFrame` feeds the frame to `NucDetector` (`src/irvis/nuc.ts`), decides whether the frame starts a chunk (first frame, a forced reason, a changed `gain`, camera state or conversion, a NUC, 10 s since the chunk started), encodes it with `FrameEncoder` (`src/irvis/codec.ts`), deflates the body with `fflate`'s `deflateSync`, frames it as a record with its CRC-32 (`src/irvis/crc32.ts`, `src/irvis/format.ts`), and appends the chunk and frame records in one `append`; it flushes the sink at the first frame and then after every 1 s of frame time. Everything a call can reject (the frame's size, its fields, a timestamp that is not finite or goes back) is checked before anything changes; the chunk, the frame table, the offset and the last timestamp move on only after the sink accepted the bytes. A rejection by the sink, or an error after encoding started, puts the writer in a failed state in which every call rejects, because the detector and the encoder have already moved on to a frame that may not be in the file. `close` appends the index and the trailer and closes the sink.
5. `IrvisReader.open` (`src/irvis/reader.ts`) reads a `ByteSource`: the signature and the header, then the frame table from the index, or, when the trailer or the index is missing or does not fit, by scanning the records in 1 MiB windows up to the last valid one. `readFrame(i)` reads the byte range of frame i's chunk once, decodes from its keyframe with `FrameDecoder`, and continues from there when the next call asks for a later frame of the same chunk; calls run one after another. Opening through the index reads exactly the header, trailer, index and view-state records, not the 1 MiB window. `reencodeIrvis` (`src/irvis/reencode.ts`) pipes a reader into a writer with a larger threshold. A `Player` (`src/player.ts`) will drive playback over the reader (#19).
6. The corrections (`src/corrections/`) turn a `ThermalFrame` into the readings the user sees. `correctFrame(frame, settings)` evaluates `toCelsiusArray` on the raw values with the frame's conversion and passes each reading through `correctionFor(settings, frame.cameraState)`: `cameraCorrection` reads the emissivity and reflected temperature the camera applied from the state fields `emissivity` and `reflected-temperature` (null when the state has neither), and `temperatureCorrection` builds a function of one reading that undoes the camera's correction and applies the user's, T⁴ = a·T_c⁴ + b in kelvin with a = ε_c / ε and b = ((1 − ε_c)·R_c⁴ − (1 − ε)·R⁴) / ε, then adds the offset ([formula](../decisions/architecture.md#emissivity-is-corrected-with-the-fourth-power-law-and-a-reflected-temperature), [relative to the camera](../decisions/architecture.md#the-software-correction-works-relative-to-what-the-camera-applied)). When ε_c and R_c are equal (`===`) to ε and R, or ε_c = ε = 1, the function skips the formula and only adds the offset, so with offset 0 the readings keep their bits; a value that differs in the last bit (an R typed in °F and converted back) goes through the formula and differs by about 1e-13 K. On both paths a reading at or below 0 K (raw 0 on the P2 Pro) or NaN gives NaN. `settingsFromCamera(state)` copies ε_c and R_c into the settings exactly, so settings started from it change no reading of frames in that state. `evaluateAlarms` and `paintIsotherms` take the corrected readings and the frame's `uncertain` mask; both skip uncertain pixels and readings that are not finite (NaN, ±Infinity), as the analysis does ([decision](../decisions/architecture.md#alarms-and-isotherms-skip-uncertain-pixels)). The functions of `src/corrections/units.ts` convert °C to °F and back only for display and input; every reading in core stays in °C.
7. The analysis (`src/analysis/`) works on a `CelsiusImage`: the corrected readings with the frame's width, height and `uncertain` mask, which `celsiusImage(frame, settings)` builds with `correctFrame`. `measureFrame` gives min, max (with their pixel) and mean of the frame; `measurePoint` the mean of the 3×3 pixels around a point, clipped at the image's edge, and whether the point's own pixel counts; `measureLine` the Bresenham profile between two pixels; `measureArea` the same statistics for a rectangle; `histogram` the counts per bin over a range. All of them skip a pixel whose `uncertain` value is not 0 and a reading that is not finite (NaN, and ±Infinity, which `correctFrame` never gives but a `CelsiusImage` built by hand can hold) ([decision](../decisions/architecture.md#alarms-and-isotherms-skip-uncertain-pixels)), sum in row-major order (a line in its own order) and take the first pixel on a tie. `autoRange` is the range from the coldest to the hottest counted pixel, and `renderPalette` maps each reading to entry floor((v − min) × 256 / (max − min)), clamped, of one of six 256-entry tables that `palettes.ts` builds from colour stops when the module loads, into an RGBA image with alpha 255, a reading that is not finite as (0, 0, 0, 0) ([decision](../decisions/architecture.md#palettes-are-256-colour-ramps-defined-by-stops)); `paintIsotherms` paints over that image.

`src/index.ts` re-exports every type, the registry module `src/cameras/index.ts`, the analysis module `src/analysis/index.ts` (everything but the internal `lutOf` and `counts`), the corrections module `src/corrections/index.ts`, `src/yuyv.ts`, the codec module `src/irvis/index.ts` and `src/memory.ts`. It is the package's only entry point (`exports` in `packages/core/package.json` maps `.` to `./src/index.ts`).

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

**.irvis** (`src/irvis/format.ts`): the file layout, the records and the codec are specified field by field in [irvis-format.md](../irvis-format.md). The types that cross the API are `IrvisHeader` (the header's JSON fields), `IrvisChunk` (`reason`, `step`, `conversion`, `gain`, `cameraState`), `ChunkReason` (`start`, `interval`, `gain`, `camera-state`, `conversion`, `nuc`), `RecordingPath` (`exact`, `reconstructed`), `FrameFieldId` (`sensor-temperature`) and `FrameFields`, `ViewStateChange` (`timestamp`, `values`) and `ViewStateValues` (JSON values by name), `IrvisProfileRef` (`id`, `version`, `name`), and from the reader `IrvisFrameInfo` (`offset`, `timestamp`, `keyframe`, `chunk`), `IrvisFrame` (`index`, `keyframe`, `frame: ThermalFrame`, `fields`, `chunk`) and `IrvisDamage` (`offset`, `reason`).

**Corrections** (`src/corrections/`):

| Type | Fields | Notes |
| --- | --- | --- |
| `CorrectionSettings` | `emissivity`, `reflectedCelsius`, `offsetKelvin` | ε greater than 0 and at most 1; R a finite °C above −273.15; the offset a finite difference in kelvin. `DEFAULT_CORRECTION`: ε 1, R 20 °C, offset 0, which changes no reading of a camera that applies nothing itself, but undoes the correction of one that does |
| `CameraCorrection` | `emissivity`, `reflectedCelsius` | What the camera applied, from its state |
| `TemperatureCorrection` | `(celsius: number) => number` | One reading in °C to the corrected one |
| `TemperatureUnit` | `'C' \| 'F'` | `TEMPERATURE_UNITS` lists both, °C first |
| `AlarmSettings` | `highCelsius`, `lowCelsius` (each a number or `null` for off), `hysteresis` (kelvin, at least 0) | `DEFAULT_ALARMS`: both off, hysteresis 0.5 |
| `AlarmState` | `high`, `low`: `AlarmLevel` each | Passed back as `previous` with the next frame |
| `AlarmLevel` | `active`, `pixels` (at or past the threshold), `extreme` (hottest for `high`, coldest for `low`, NaN when no pixel counts), `index` (row-major index of the first pixel at `extreme`, −1 when none) | |
| `Isotherm` | `{ kind: 'above' \| 'below'; celsius; color }` or `{ kind: 'between'; minCelsius; maxCelsius; color }` | Bounds included; `color` an `Rgb`, three integers from 0 to 255 |

**Analysis** (`src/analysis/`):

| Type | Fields | Notes |
| --- | --- | --- |
| `CelsiusImage` | `width`, `height`, `celsius` (`Float64Array`, width × height, row-major), `uncertain` (`Uint8Array` or `null`) | The input of every measurement; `checkImage` checks that the lengths agree |
| `PixelReading` | `x`, `y`, `index` (y × width + x), `celsius` | A pixel and its reading |
| `PixelPoint` | `x`, `y` | Integers inside the image |
| `PixelArea` | `x`, `y` (top-left pixel), `width`, `height` | Integers, at least 1 × 1, inside the image |
| `RegionStats` | `pixels` (in the region), `counted` (certain, with a temperature), `mean` (NaN when `counted` is 0), `min`, `max` (`PixelReading` or `null` when `counted` is 0) | |
| `PointStats` | The `RegionStats` fields and `centreCounted` | `centreCounted` is false when the point's own pixel is uncertain or without a temperature: `mean` then comes from its neighbours only, and the viewer should say so instead of showing it as the point's reading |
| `LineProfile` | `x`, `y` (`Int32Array`), `celsius` (`Float64Array`, uncertain samples included, NaN for a sample without a temperature: ±Infinity becomes NaN), `uncertain` (`Uint8Array`, 1 per uncertain sample), `stats` (`RegionStats` of the samples) | One sample per pixel from the start to the end |
| `Histogram` | `minCelsius`, `maxCelsius`, `counts` (`Uint32Array`, one per bin), `below`, `above` (counted pixels outside the range), `skipped` (pixels that do not count) | A reading v goes to bin min(bins − 1, floor((v − min) × bins / (max − min))); that formula is the definition. Bin k is roughly from min + k × w to min + (k + 1) × w, w = (max − min) / bins, but a reading computed as min + k × w can round into bin k − 1, so a viewer labelling the bins with those values may show a reading at a boundary in the bar next to it |
| `TemperatureRange` | `minCelsius`, `maxCelsius` | Finite, min below max, and max − min finite too (−1e308 to 1e308 is not) |
| `PaletteId` | `'iron' \| 'white-hot' \| 'black-hot' \| 'rainbow' \| 'red-hot' \| 'cold-blue'` | `PALETTE_IDS` lists them in this order |
| `Palette` | `id`, `name` (`Iron`, `White Hot`, `Black Hot`, `Rainbow`, `Red Hot`, `Cold Blue`), `stops` | `PALETTES` holds the six, frozen |
| `PaletteStop` | `index` (0 to 255), `color` (three integers from 0 to 255) | The first stop at 0, the last at 255, indexes rising |

The stops of the six palettes:

| Palette | Stops (index: red, green, blue) |
| --- | --- |
| Iron | 0: 0, 0, 0; 40: 32, 0, 112; 88: 128, 0, 160; 136: 208, 40, 72; 176: 240, 112, 0; 216: 255, 192, 0; 255: 255, 255, 255 |
| White Hot | 0: 0, 0, 0; 255: 255, 255, 255 |
| Black Hot | 0: 255, 255, 255; 255: 0, 0, 0 |
| Rainbow | 0: 0, 0, 96; 40: 0, 0, 255; 88: 0, 200, 255; 128: 0, 224, 0; 168: 255, 240, 0; 212: 255, 96, 0; 255: 255, 0, 0 |
| Red Hot | 0: 0, 0, 0; 96: 200, 0, 0; 176: 255, 160, 0; 255: 255, 255, 255 |
| Cold Blue | 0: 0, 0, 0; 96: 0, 32, 160; 176: 0, 160, 255; 255: 255, 255, 255 |

**Values over time** (`src/store.ts`): `Subscribable<T>` has `subscribe: (listener) => Unsubscribe`; `Store<T>` adds `getSnapshot: () => T`, which returns the same object until the value changes. Both are function properties, not methods: an implementation binds them (or uses arrow functions), so `useSyncExternalStore(store.subscribe, store.getSnapshot)` works and passes typescript-eslint's `unbound-method`. Calling an `Unsubscribe` twice does nothing. [Why subscriptions](../decisions/architecture.md#frames-and-state-in-core-are-subscriptions).

## Interfaces

Everything is exported from `@irvis/core`: the types above, the profile types, `cameraProfiles`, `findProfile`, `matchProfiles`, `validateProfile`, `toCelsius`, `toCelsiusArray` and `DeviceDescription` from the registry ([cameras: technical](cameras-technical.md#interfaces)), and the decoders of `src/yuyv.ts`:

| Name | Signature | Notes |
| --- | --- | --- |
| `checkYuyvFrame` | `(frame: YuyvFrame) => void` | Throws unless the width is a positive even integer, the height a positive integer and `data` has width × height × 2 bytes |
| `decodeYuyvRaw` | `(frame: YuyvFrame, range: RowRange) => Uint16Array` | width × `range.rows` values, row-major; `data` may be a view into a larger buffer at any offset |
| `decodeYuyvImage` | `(frame: YuyvFrame, range: RowRange) => YuyvImage` | `YuyvImage`: `width`, `height` (= `range.rows`), `y` (width × height), `u` and `v` (width / 2 × height), each a new `Uint8Array` |
| `decodeThermalFrame` | `(frame: YuyvFrame, mode: VideoMode, conversion: Conversion, cameraState: CameraStateSnapshot) => ThermalFrame` | `width` is the mode's width, `height` its thermal rows, `timestamp` the frame's |

The `.irvis` codec (`src/irvis/`). Thresholds and tolerances are integers in raw units, from 0 to 32767.

| Name | Signature | Notes |
| --- | --- | --- |
| `IrvisWriter.create` | `(sink: ByteSink, options: IrvisWriterOptions) => Promise<IrvisWriter>` | Options: `profile` (`IrvisProfileRef`), `width`, `height`, `fps`, `path`, `threshold`; optional `thresholdHistory` (default `[]`), `tolerance` (default `threshold`, at most `threshold`: how far a stored value may be from the value given), `frameFields` (default `[]`), `viewState` (default `{}`), `keyframeIntervalMs` (default `DEFAULT_KEYFRAME_INTERVAL_MS`, 10 000; `Infinity` for only the required keyframes), `flushIntervalMs` (default `DEFAULT_FLUSH_INTERVAL_MS`, 1 000), `detectNuc` (default `true`), `deflateLevel` (default `DEFAULT_DEFLATE_LEVEL`, 6), `tuning` (default `DEFAULT_TUNING`) |
| `IrvisWriter.appendFrame` | `(frame: ThermalFrame, options?: { fields?: FrameFields; chunk?: ChunkReason }) => Promise<AppendedFrame>` | `frame.timestamp` must not be before the previous frame's. `chunk` forces a chunk with that reason. `AppendedFrame`: `index`, `chunk` (the reason of the chunk it starts, or `null`), `values` (what a reader will decode, as a copy the writer does not use again), `timestamp` (as stored), `stats` (`BlockStats`: `skip`, `dense`, `sparse`), `bytes` |
| `IrvisWriter.appendViewState` | `(timestamp: number, values: ViewStateValues) => Promise<void>` | Only the settings that changed |
| `IrvisWriter.flush`, `IrvisWriter.close` | `() => Promise<void>` | `close` writes the index and the trailer and closes the sink. `header`, `frameCount` and `size` (bytes the sink accepted) are read-only properties. Await each call before the next. After the sink rejects, every call rejects, `close` included; the caller closes the sink itself, and the file reads by scanning up to its last whole record |
| `IrvisReader.open` | `(source: ByteSource) => Promise<IrvisReader>` | Properties: `header`, `frames` (`IrvisFrameInfo[]`), `viewStates`, `indexed` (the index was used), `damage` (`IrvisDamage` or `null`), `frameCount`, `chunkCount`, `duration` (ms from the first frame to the last) |
| `IrvisReader.readFrame` | `(index: number) => Promise<IrvisFrame>` | Reading in order decodes each frame once; another frame decodes its chunk from the keyframe. The returned `raw`, `uncertain` and `fields` are copies the caller may change; the reader keeps its own for the next frame and for a repeated read. Chunk metadata (`chunk`, `conversion`, `cameraState`), the header and the view-state changes are frozen and shared |
| `IrvisReader.frameAt` | `(timestamp: number) => number` | The last frame at or before `timestamp`; 0 before the first |
| `IrvisReader.frameIterator` | `() => AsyncGenerator<IrvisFrame>` | Every frame in order |
| `reencodeIrvis` | `(source: ByteSource, sink: ByteSink, threshold: number) => Promise<ReencodeResult>` | `threshold` at least the source's. `ReencodeResult`: `frames` (copied), `skipped` (frames left out because their chunk is damaged before them), `bytes`, `damage` (the first damage: `IrvisReader.damage`, or the first frame that failed to decode, whose reason is the error's message). With an intact index, copying goes on at the keyframe after a damaged chunk |
| `FrameEncoder`, `FrameDecoder` | `new FrameEncoder(width, height, tolerance, tuning?)`, `.encode(input, keyframe) => EncodedFrame`; `new FrameDecoder(width, height)`, `.decode(body, keyframe, step) => Uint16Array`, `.current()`, `.reset()` | The frame body before deflate ([frame body](../irvis-format.md#frame-body)); `FrameEncoder.step` is what the decoder needs. `EncodedFrame`: `body`, `values`, `stats`. `EncodedFrame.values`, `decode`'s result and `current()` are copies: changing them does not change what the next frame is predicted from |
| `NucDetector` | `new NucDetector()`, `.push(raw, conversion) => NucEvent \| null`, `.reset()` | `NucEvent`: `frozen` or `step`. Thresholds `NUC_MIN_FROZEN` (2 repeated frames), `NUC_MIN_STEP_KELVIN` (0.5), `NUC_STEP_FACTOR` (10), `NUC_HISTORY` (25) |
| `kelvinPerRaw` | `(conversion: Conversion, raw: number) => number \| null` | The slope of a conversion near `raw`; `null` where it is 0 or undefined |
| `crc32` | `(data: Uint8Array, crc?: number) => number` | CRC-32 as zlib; pass an earlier result to continue |
| `quantiserStep` | `(halfWidth: number) => number` | 2 × halfWidth + 1 |
| `tuningProblems` | `(tuning: EncoderTuning) => string[]` | What `FrameEncoder` and `IrvisWriter.create` reject in a tuning; empty when it can be used |
| `IrvisError` | `class extends Error` | `name` is `IrvisError`; every format and codec error below. An error from the sink or the source itself is passed on unchanged |

Constants: `IRVIS_VERSION` (1), `IRVIS_SIGNATURE`, `FRAME_FIELDS`, `BLOCK_SIZE` (8), `BLOCK_SKIP`, `BLOCK_DENSE`, `BLOCK_SPARSE` (0, 1, 2), `DEFAULT_TUNING` (`EncoderTuning`: `precision` 0.25, `weight` 0.25, `denseBias` 1; [how the encoder uses them](../irvis-format.md#how-irvis-encodes)).

The corrections (`src/corrections/`). Temperatures are °C, differences kelvin:

| Name | Signature | Notes |
| --- | --- | --- |
| `temperatureCorrection` | `(settings: CorrectionSettings, camera: CameraCorrection \| null = null) => TemperatureCorrection` | Throws on settings that `correctionProblems` rejects. The function returns NaN for NaN, for a reading at or below 0 K and for one whose T⁴ comes out at or below 0; when it skips the formula, see [data flow](#data-flow) |
| `settingsFromCamera` | `(state: CameraStateSnapshot, base: CorrectionSettings = DEFAULT_CORRECTION) => CorrectionSettings` | `base` with the camera's ε and R from `cameraCorrection(state)`, or `base` itself when the camera applies none: the starting point for the user's settings. Throws as `cameraCorrection` |
| `cameraCorrection` | `(state: CameraStateSnapshot) => CameraCorrection \| null` | `null` when `values` has neither `emissivity` nor `reflected-temperature` |
| `correctionFor` | `(settings, state: CameraStateSnapshot) => TemperatureCorrection` | `temperatureCorrection(settings, cameraCorrection(state))` |
| `correctFrame` | `(frame: ThermalFrame, settings: CorrectionSettings) => Float64Array` | One corrected reading per pixel, row-major; uncertain pixels are corrected too |
| `correctedCelsius` | `(raw: number, conversion: Conversion, correction: TemperatureCorrection) => number` | One raw value |
| `correctionProblems` | `(settings: CorrectionSettings) => string[]` | Empty when the settings can be used |
| `evaluateAlarms` | `(celsius: Float64Array, uncertain: Uint8Array \| null, settings: AlarmSettings, previous: AlarmState \| null = null) => AlarmState` | An alarm is on when a pixel is at or above `highCelsius` (at or below `lowCelsius`), or when it was on in `previous` and the extreme pixel is still within `hysteresis` of the threshold. Pixels with `uncertain` not 0 and readings that are not finite (NaN, ±Infinity) are skipped |
| `alarmProblems` | `(settings: AlarmSettings) => string[]` | |
| `inIsotherm` | `(celsius: number, isotherm: Isotherm) => boolean` | False for a reading that is not finite (NaN, ±Infinity) |
| `isothermMask` | `(celsius: Float64Array, uncertain: Uint8Array \| null, isotherm: Isotherm) => Uint8Array` | 1 inside the band on a certain pixel, 0 elsewhere |
| `paintIsotherms` | `(rgba: Uint8Array \| Uint8ClampedArray, celsius: Float64Array, uncertain: Uint8Array \| null, isotherms: readonly Isotherm[]) => number[]` | In place: red, green and blue of every certain pixel inside a band become its colour, alpha stays; later isotherms paint over earlier ones. Returns the pixels inside each band |
| `isothermProblems` | `(isotherm: Isotherm) => string[]` | |
| `celsiusToUnit`, `unitToCelsius` | `(value: number, unit: TemperatureUnit) => number` | °F = °C × 9 / 5 + 32 and back as (°F − 32) × 5 / 9; unchanged for `C` |
| `celsiusDeltaToUnit`, `unitDeltaToCelsius` | `(delta: number, unit: TemperatureUnit) => number` | × 9 / 5 and × 5 / 9 for `F`, for offsets and hystereses |
| `unitSymbol` | `(unit: TemperatureUnit) => string` | `°C` or `°F` |
| `formatTemperature` | `(celsius: number, unit: TemperatureUnit, digits = 1) => string` | `toFixed(digits)` of the value in `unit`, a space and the symbol (`36.6 °C`); a result that rounds to zero has no minus sign; `–` (en dash) for a value that is not finite |

Constant: `KELVIN_OFFSET` (273.15). Everything in `src/corrections/` uses only the `Math` members the measurement rule allows: T⁴ is `x * x` squared and the fourth root `Math.sqrt(Math.sqrt(x))`.

The analysis (`src/analysis/`). Temperatures are °C:

| Name | Signature | Notes |
| --- | --- | --- |
| `celsiusImage` | `(frame: ThermalFrame, settings: CorrectionSettings) => CelsiusImage` | `correctFrame(frame, settings)` with the frame's `width`, `height` and `uncertain` (the same array, not a copy) |
| `checkImage` | `(image: CelsiusImage) => void` | Throws unless width and height are positive integers, `celsius` has width × height readings and `uncertain`, when given, as many values |
| `measureFrame` | `(image: CelsiusImage) => RegionStats` | Min and max with their position, and the mean, of the whole frame |
| `measurePoint` | `(image: CelsiusImage, point: PixelPoint) => PointStats` | The 3×3 pixels around `point`, of those inside the image: 9, 6 along an edge, 4 in a corner. `mean` is the point's reading; `centreCounted` whether the point's own pixel is in it |
| `measureLine` | `(image: CelsiusImage, from: PixelPoint, to: PixelPoint) => LineProfile` | Bresenham's line, both ends included: max(\|Δx\|, \|Δy\|) + 1 samples, neighbouring samples at most one pixel apart in each direction |
| `measureArea` | `(image: CelsiusImage, area: PixelArea) => RegionStats` | Row-major over the rectangle |
| `checkArea` | `(image: CelsiusImage, area: PixelArea) => void` | Throws unless `area` is inside the image |
| `histogram` | `(image: CelsiusImage, range: TemperatureRange, bins: number, area: PixelArea \| null = null) => Histogram` | `bins` an integer from 1 to 65 536; the whole frame, or only `area`. A reading v goes to bin floor((v − min) × bins / (max − min)) |
| `autoRange` | `(image: CelsiusImage) => TemperatureRange \| null` | From `measureFrame`'s min to its max; `FLAT_RANGE_SPAN` (1 K) centred on the reading when they are equal; `null` when no pixel counts |
| `rangeProblems`, `checkRange` | `(range: TemperatureRange) => string[]`, `=> void` | `checkRange` throws on what `rangeProblems` lists |
| `paletteIndex` | `(celsius: number, range: TemperatureRange) => number` | floor((v − min) × 256 / (max − min)), clamped to 0 and 255; −1 for a reading that is not finite (NaN, ±Infinity) |
| `renderPalette` | `(celsius: Float64Array, range: TemperatureRange, palette: PaletteId, out: Uint8ClampedArray<ArrayBuffer> \| null = null) => Uint8ClampedArray<ArrayBuffer>` | 4 bytes per reading, row-major, as `ImageData`: the palette entry of `paletteIndex` and alpha 255; (0, 0, 0, 0) for a reading that is not finite. The type is `Uint8ClampedArray<ArrayBuffer>` because `lib.dom`'s `ImageData` does not take the default `Uint8ClampedArray<ArrayBufferLike>`; core has no `lib.dom`, so a typed assignment in `render.test.ts` checks it. Uncertain pixels are coloured like the others. Writes into `out` when given and returns it |
| `paletteLut` | `(id: PaletteId) => Uint8Array<ArrayBuffer>` | A new copy of the palette's 768 bytes: red, green, blue of entry 0 (coldest) to 255 (hottest), for a scale bar |
| `findPalette` | `(id: PaletteId) => Palette` | Throws for an unknown id |
| `buildLut`, `stopsProblems` | `(stops: readonly PaletteStop[]) => Uint8Array<ArrayBuffer>`, `=> string[]` | The table from stops: each channel linear between two stops, `Math.round` (halves up). `stopsProblems` reports untyped input (a hole in the list, a stop without a colour) instead of throwing |

Constants: `PALETTE_SIZE` (256), `FLAT_RANGE_SPAN` (1). Everything in `src/analysis/` uses only the `Math` members the measurement rule allows (`floor`, `round`, `min`, `max`, `abs`), so the tables, the colours and every measurement are the same in every engine. A mean depends on the order of the sum, which is fixed: row-major for a frame, an area and a point, the line's own order for a line.

In memory (`src/memory.ts`), for tests and for a one-frame `.irvis` that is not a file:

| Name | Signature | Notes |
| --- | --- | --- |
| `MemoryByteSink` | `new MemoryByteSink()`, the `ByteSink` methods, `size`, `bytes()` | Copies every chunk on `append`; `bytes()` returns them as one new array. `append` and `flush` reject after `close` |
| `memoryByteSource` | `(bytes: Uint8Array) => ByteSource` | Reads are views into `bytes`, which is not copied |

## Configuration

| File | What it sets |
| --- | --- |
| `packages/core/package.json` | `@irvis/core`, `"type": "module"`, `exports` → `./src/index.ts`. One dependency, `fflate` `^0.8.3`, for deflate in the `.irvis` codec. |
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

**Exceptions.** In all of `packages/core/src/`, an `eslint-disable`, `eslint-disable-line` or `eslint-disable-next-line` comment names the rules it disables and, after ` -- `, a decision as `docs/decisions/<file>.md#<anchor>`; inline configuration (`/* eslint <rule>: … */`, `eslint-env`, `global`, `globals`, `exported`) is not allowed. As in ESLint, only `eslint-disable-line` and `eslint-disable-next-line` count in a `//` comment; every other keyword is a directive only in a `/* */` comment, so `// exported for the tests` is plain text. ESLint cannot enforce this, because a directive can silence the rule that would check it (`// eslint-disable-line` alone silences everything on its line). `packages/core/test/eslint-directives.test.ts` therefore parses every `.ts` and `.tsx` file under `packages/core/src/` with `@typescript-eslint/parser` and checks each directive comment; `eslint-enable` needs nothing. Because the reason is a `docs/` reference in a code comment, `npm run docs-check` also fails when the named decision does not exist. `fflate`'s declarations (0.8.3) compile with `lib: ["ES2022"]`, `types: []` and `skipLibCheck: false`, so core imports it directly, without a wrapper module with its own declarations.

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

The decoders throw an `Error` with one of these messages:

| Message | Cause |
| --- | --- |
| `YUYV frame width <width> is not a positive even integer` | YUYV packs two pixels in four bytes |
| `YUYV frame height <height> is not a positive integer` | |
| `YUYV frame has <bytes> bytes, expected <expected> for <width>×<height>` | `data` does not hold exactly one frame |
| `rows must be a positive integer, not <rows>` | The `RowRange` has no rows |
| `rows <first> to <last> are not inside the <height>-row frame` | The `RowRange` starts before row 0, at a fractional row, or ends past the frame |
| `video mode '<id>' carries no temperature data` | `decodeThermalFrame` with a mode whose `layout` is `null` |
| `frame is <width>×<height>, video mode '<id>' is <width>×<height>` | `decodeThermalFrame` with a frame of another size |

The `.irvis` code throws `IrvisError` with these messages; `<…>` stands for a number or a name:

| Message | Cause |
| --- | --- |
| `invalid .irvis options: <problems>` | `IrvisWriter.create` with inconsistent options; the problems are joined by `; ` and are those of the header (below) and `tolerance must be an integer from 0 to the threshold`, `keyframeIntervalMs must be a positive number or Infinity`, `flushIntervalMs must be a positive number or Infinity`, `deflateLevel must be an integer from 0 to 9`, `tuning.precision must be a number from 0 to 1`, `tuning.weight must be a number from 0 to 1`, `tuning.denseBias must be a positive number` |
| `frame is <w>×<h>, the recording is <w>×<h>`, `frame has <n> raw values, expected <n>`, `uncertain mask has <n> values, expected <n>` | `appendFrame` with a frame of another size |
| `frame conversion has a number that is not finite`, `camera state value '<id>' is not a finite number` | `appendFrame` with NaN or ±Infinity in the conversion or the camera state, which a JSON chunk record cannot hold. The writer stays usable |
| `frame timestamp is not finite`, `frame timestamp <t> is before the previous frame's <t0>`, `frame timestamp is too far from the previous one` | `appendFrame` with a NaN or infinite timestamp, one before the previous frame's as given (`<t0>`), or one more than about 285 years after it. The writer stays usable |
| `frame field '<id>' is not declared in the header` | `appendFrame` with a field the header does not list |
| `view-state timestamp is not finite` | `appendViewState` with a NaN or infinite timestamp |
| `wait for the previous call to the writer to settle` | A writer call while another is pending |
| `the writer is closed` | A writer call after `close` |
| `the writer stopped after an earlier error: <message>` | A writer call after the sink rejected an `append`, `flush` or `close` (whose own error the failing call passed on), or after an error once encoding had started |
| `not an .irvis file: the signature is missing` | The first 8 bytes are not the signature |
| `the header record is damaged: <reason>` | The record after the signature is cut short, fails its CRC (`CRC-32 mismatch`) or is not a header |
| `.irvis version <v> is not supported; this reader reads version 1` | Another format version |
| `invalid header: <problems>` | One or more of: `profile needs an id, a positive integer version and a name`, `width and height must be positive integers`, `fps must be a positive number`, `bitDepth must be 16`, `path must be 'exact' or 'reconstructed'`, `threshold must be an integer from 0 to 32767`, `thresholdHistory must be a list of thresholds`, `thresholdHistory may not hold a threshold above the current one`, `frameFields must list distinct fields from: sensor-temperature`, `viewState must be an object`; also `the header is not a JSON object` and `the header is not valid JSON` |
| `frame <i> is not in the file (it has <n>)` | `readFrame` with an index outside the frame table |
| `frame <i> at byte <offset> is damaged: <reason>`, `chunk <c> at byte <offset> is damaged: <reason>`, `chunk <c> is shorter than its records` | A record's CRC fails, or the source returns fewer bytes, when the frame is decoded: the index was intact but the data are not |
| `frame <i> could not be decoded`, `frame <i> is not in the file` | Internal errors of the reader's cursor; not expected |
| `frame <i> does not inflate`, `frame <i> is shorter than its uncertain mask`, `frame body has <n> bytes after its last value`, `frame body has <n> bytes, fewer than its <b> blocks`, `unknown block mode <m>`, `unexpected end of data at byte <n>`, `varint at byte <n> is too long` | A frame body or index that is damaged although its CRC matches |
| `cannot re-encode to threshold <t>: it must be an integer of at least the file's <t1>` | `reencodeIrvis` with a smaller threshold |
| `tolerance <t> is not an integer from 0 to 32767`, `invalid encoder tuning: <problems>` (the `tuning.` problems above), `varint <v> is not a non-negative safe integer`, `the first frame must be a keyframe`, `frame has <n> values, expected <n> for <w>×<h>`, `a frame that is not a keyframe has no previous frame` | `FrameEncoder` and `FrameDecoder` used directly against their contract |

A file cut short or damaged is not an error when it is opened: `IrvisReader.damage` holds the offset and one of these reasons, and the frames before it are readable: `the file ends inside a record header`, `the file ends inside a record`, `CRC-32 mismatch`, `a frame comes before the first chunk`, `a chunk does not start with a keyframe`, `a keyframe does not start a chunk`, `unknown record type <t>`, `the file ends after a chunk record`, `a record offset is outside the file`, `the source returned fewer bytes than its size` (the source shrank between `size()` and `read()`), or the message of an `IrvisError` from a record whose content does not parse (`invalid chunk record`, `invalid view-state record`, `a chunk record is not valid JSON`, `a view-state record is not valid JSON`, `unknown frame flags <f>`, `frame timestamp is not finite`, `unexpected end of data at byte <n>`, `varint at byte <n> is too long`). `MemoryByteSink` rejects with `MemoryByteSink is closed` after `close`.

The corrections throw an `Error` with one of these messages:

| Message | Cause |
| --- | --- |
| `invalid correction: <problems>` | `temperatureCorrection`, `correctionFor` or `correctFrame` with settings that `correctionProblems` rejects; the problems, joined by `; `, are `emissivity must be greater than 0 and at most 1`, `reflectedCelsius must be a finite number above -273.15`, `offsetKelvin must be a finite number` |
| `camera state 'emissivity' must be a number greater than 0 and at most 1`, `camera state 'reflected-temperature' must be a finite number of °C above -273.15` | `cameraCorrection` (and so `correctionFor`, `correctFrame`, `settingsFromCamera`) with a state that has one of the two fields but not the other, a value that is not a number, or one out of range. Readings corrected from such a state would be wrong without a sign, so the frame is refused |
| `invalid alarm settings: <problems>` | `evaluateAlarms` with `highCelsius must be a finite number or null`, `lowCelsius must be a finite number or null` or `hysteresis must be a finite number of at least 0` |
| `invalid isotherm <i>: <problems>` | `isothermMask` (with `<i>` 0) or `paintIsotherms` with `celsius must be a finite number`, `minCelsius and maxCelsius must be finite numbers`, `minCelsius must not be above maxCelsius` or `color must be three integers from 0 to 255` |
| `uncertain mask has <n> values, expected <n>` | `evaluateAlarms`, `isothermMask` or `paintIsotherms` with a mask of another length than the readings |
| `RGBA image has <n> bytes, expected <n>` | `paintIsotherms` with an image that is not 4 bytes per reading |
| `digits must be an integer from 0 to 3, not <digits>` | `formatTemperature` |

The analysis throws an `Error` with one of these messages:

| Message | Cause |
| --- | --- |
| `image size <w>×<h> is not two positive integers`, `image has <n> readings, expected <n>`, `uncertain mask has <n> values, expected <n>` | A `CelsiusImage` whose size and arrays disagree, in any measurement or in `checkImage` |
| `point (<x>, <y>) is not a pixel of the <w>×<h> image`, `line start (<x>, <y>) …`, `line end (<x>, <y>) …` (the same text) | `measurePoint` or `measureLine` with a position outside the image or between pixels |
| `area <w>×<h> at (<x>, <y>) is not inside the <W>×<H> image` | `measureArea`, `histogram` or `checkArea` with a rectangle that leaves the image, is empty or is not whole pixels |
| `invalid range: <problems>` | `paletteIndex`, `renderPalette` or `histogram` with `minCelsius and maxCelsius must be finite numbers`, `minCelsius must be below maxCelsius` or `the span from minCelsius to maxCelsius must be finite` |
| `bins must be an integer from 1 to 65536, not <bins>` | `histogram` |
| `RGBA image has <n> bytes, expected <n>` | `renderPalette` with an `out` that is not 4 bytes per reading |
| `unknown palette '<id>'` | `findPalette` or `paletteLut` with an id outside `PALETTE_IDS` (only from untyped input) |
| `invalid palette stops: <problems>` | `buildLut` with `a palette needs at least two stops`, `every stop must be an object with an index and a color`, `the first stop must be at index 0`, `the last stop must be at index 255`, `stop indexes must be integers that rise` or `every stop color must be three integers from 0 to 255` |

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
| `packages/core/src/yuyv.test.ts` | `decodeYuyvRaw` reads lo and hi bytes, only the given rows, and a frame that is a view into a larger buffer, and rejects rows outside the frame ([invariant 19](../invariants.md)); `decodeYuyvImage` splits Y, U and V; `checkYuyvFrame` rejects a wrong byte count and an odd width; `decodeThermalFrame` decodes the mode's thermal rows and rejects a mode without temperature data and a frame of another size. Synthetic frames only. |
| `packages/core/src/irvis/codec.test.ts` | `FrameEncoder` and `FrameDecoder` on synthetic scenes: lossless at tolerance 0, every value within tolerances 1 to 100 on static, moving and odd-sized (37×29) frames, with a 320 °C tip appearing, dead pixels at 0 and 65535 and a NUC ([invariant 22](../invariants.md)); arrays returned by the encoder and decoder that the caller changes ([invariant 22](../invariants.md)); escaped residuals; skip in a static scene and other modes in a moving one; the errors for a first non-keyframe, a wrong size and damaged bodies |
| `packages/core/src/irvis/irvis.test.ts` | Writer and reader together: values within T with the header, conversion, camera state, uncertain masks, frame fields and view-state changes read back; lossless at T = 0 ([invariant 22](../invariants.md)); timestamps with gaps and fractions, `frameAt`, `duration`; chunks at the start, at the interval, after a gain, camera-state and conversion change and after a NUC ([invariant 23](../invariants.md)); frames in any order; a flush every second; a file cut every 7 bytes and one without its trailer read up to the last valid record with the same frame table as the index, a damaged frame with and without the index, and a chunk record followed by another ([invariant 24](../invariants.md)); exact reads of the header, the index and 60 view-state records (less than half the file); wrong signature, version and header; the writer's errors; a sink that rejects (every later call rejects and the file keeps its guarantee), a timestamp that goes back (the writer stays usable), returned arrays that the caller changes ([invariant 22](../invariants.md)), invalid tuning and intervals, a conversion or camera state with a number that is not finite (rejected, the writer stays usable), an equal conversion with its keys in another order or with −0, a repeated timestamp that the stored previous one rounded above; re-encoding 4 → 16 → 20 within the new threshold, with the history and the chunk reasons kept, a smaller threshold refused, a file cut short copied up to the damage, and one with an intact index and a damaged frame copied without the rest of that chunk ([invariant 25](../invariants.md)) |
| `packages/core/src/irvis/nuc.test.ts`, `crc32.test.ts`, `buffer.test.ts` | `NucDetector` (no event in noise, a frozen run, a frame delivered twice ignored, a jump of the mean, a jump below 0.5 K) and `kelvinPerRaw`; the CRC-32 check value and continuation; varint and zigzag round trips and their errors |
| `packages/core/src/corrections/emissivity.test.ts` | The default settings without a camera correction, and a correction equal to the camera's, return every reading with the same bits (−0 included); NaN at and below 0 K also when the formula is skipped; a camera that assumed another reflected temperature at the user's ε (a = 1, b ≠ 0); a black-body reading of an object at ε 0.2 to 0.95 corrects back to the object within 1e-9 K; two known values (60 °C → 61.7418 °C and 35 °C → 35.7311 °C at ε 0.95, R 20 °C); the offset added after the correction; NaN at and below 0 K and below what the reflection allows; the settings' problems; `cameraCorrection` from a state with both fields, neither, one, and a string; a camera that applied ε 0.95, R 25 °C: the same settings leave its readings unchanged, ε 1 gives the uncorrected reading, and another ε gives what that ε gives on the uncorrected reading ([invariant 26](../invariants.md)); `settingsFromCamera` with and without a camera correction, and that the default settings undo a camera's correction while settings from the camera do not; `correctFrame` on a frame with raw 0 (NaN on both paths) and a camera state that changes nothing |
| `packages/core/src/corrections/alarms.test.ts` | Thresholds with their bounds included; both alarms off; uncertain pixels, NaN and ±Infinity never turn an alarm on ([invariant 27](../invariants.md)); the hysteresis keeps an alarm on and does not switch one on; an alarm that was on turns off when every pixel is uncertain; invalid settings and a mask of another size |
| `packages/core/src/corrections/isotherms.test.ts` | Bounds included and NaN outside every band; uncertain pixels, NaN and ±Infinity never painted, alpha kept, counts per band ([invariant 27](../invariants.md)); a later isotherm over an earlier one; invalid isotherms (a colour of 2 or 4 values included), images and masks |
| `packages/core/src/corrections/units.test.ts` | °C to °F and back at −40, 0, 37 and 100 °C; differences; the symbols; `formatTemperature` with rounding, no minus sign on zero, NaN and invalid digits |
| `packages/core/src/analysis/palettes.test.ts` | The six ids and names, 768 bytes each; each table at its stops; White Hot as a grey ramp and Black Hot its reverse; luminance rising for Iron, White Hot, Red Hot and Cold Blue and falling for Black Hot; an FNV-1a hash of the six tables (`7c4558a4`) and one Iron entry, so that a change of a stop or of the interpolation shows ([invariant 30](../invariants.md)); `paletteLut` returns a copy; interpolation with a half rounded up; invalid stops, untyped ones with a hole or without a colour reported instead of thrown, and unknown ids |
| `packages/core/src/analysis/render.test.ts` | `paletteIndex` at the bounds, inside, outside, and −1 for NaN and ±Infinity ([invariant 30](../invariants.md)); invalid ranges, one whose span overflows included; `autoRange` over counted pixels only, ±Infinity left out, on a flat frame and on one without counted pixels ([invariant 29](../invariants.md)); `renderPalette` colours, alpha, NaN and ±Infinity transparent, the `Uint8ClampedArray<ArrayBuffer>` and `Uint8Array<ArrayBuffer>` types that `ImageData` needs, `out` reused and of the wrong size, and that rising readings never get a colder entry with readings that are not exact in binary |
| `packages/core/src/analysis/measurements.test.ts` | `measureFrame` min and max with position, the first pixel on a tie, uncertain, NaN and ±Infinity pixels skipped, no pixel counted ([invariant 29](../invariants.md)); `measurePoint` 3×3 mean, 4 and 6 pixels at a corner and an edge, a 1×1 image, skipped pixels and `centreCounted`, invalid points; `measureLine` samples, backwards and vertical lines, a single pixel, the end reached in all 81 directions of a 9×9 grid, uncertain samples kept in the profile and left out of the statistics, ±Infinity written as NaN; `measureArea` statistics, skipped pixels, invalid rectangles; `histogram` bins with the top of the range in the last, below, above and skipped (Infinity included), an area; `celsiusImage` and `checkImage` |
| `packages/core/test/irvis-scenes.ts` | Not a test: seeded synthetic scenes (static, moving hand, hot tip, dead pixels, NUC) for the tests and the benchmark |
| `packages/core/test/benchmark/irvis.ts` | Not a test: `npm run bench:irvis`, with `-- --level <0-9>` for another deflate level ([benchmark](../irvis-format.md#benchmark)) |
| `packages/core/src/cameras/*.test.ts`, `packages/core/src/cameras/infiray-p2pro/profile.test.ts` | The registry, `validateProfile`, the conversions and the P2 Pro profile: [cameras: technical](cameras-technical.md#tests). |

Not covered: real camera frames (they come with the fixtures in #16), so the codec's sizes and the NUC heuristics are known only for synthetic data; whether the P2 Pro applies emissivity to its raw values (#7) and how the T⁴ law compares with the vendor's app on a real object; that the types fit the backends, which do not exist yet; files larger than memory, whose 1 MiB scanning windows only the cut-file test exercises at a small size; bit-identical decoding, palette tables and measurements in browsers (#21; the tests run in Node only); whether the palettes look like the vendor app's (#11); the TypeScript library settings, which `npm run typecheck` exercises on every run but no test asserts (a file that uses `document` was checked by hand when they were set up). The ESLint test cannot see a rule that type-aware linting would add or change for a real file.

## See also

- [Core](core-user.md)
- [Cameras: technical](cameras-technical.md)
- [Testing guide](../guides/testing.md)

## Planar reconstruction

`src/reconstruction/index.ts` exports `reconstructPlanar(frame, { thermal, image? })` for `Yuv420Frame`. `thermal` is a `RowRange`; optional `image` has the same number of rows and supplies spatially registered brightness. Dimensions must be positive even integers; both ranges start on even rows and contain a positive even number of rows. Plane offsets and strides support padded I420 and NV12, including typed-array subviews. Plane storage is read only. Returns width, height, timestamp, raw, byte masks `confident` and its inverse `uncertain`, hint diagnostics and the number of ICM passes (1–4). Attach the caller's conversion and camera state to make a `ThermalFrame`; neither can be inferred from planar bytes.

`src/reconstruction/planar.ts` implements `simulateYUYVtoI420(YuyvFrame)`: tightly packed I420, unchanged Y, U/V rounded vertically with `(a + b + 1) >> 1`. It models no range scaling or colour conversion. `hint.ts` builds per-frame medians, spread tolerances and an isotonic brightness mapping. The reconstruction preserves low bytes and considers both sums compatible with rounded chroma, up to 32 candidates from smooth, edge and gradient proposals. Viterbi follows each column; ICM includes left, right, above and below neighbours. Confidence uses the final local cost margin, not a probability. Constants and limitations: [decision](../decisions/architecture.md#planar-reconstruction-preserves-the-rounded-chroma-observation).

`compareFrames(reference, reconstructed, planar, thermal, kelvinsPerRaw, milliseconds)` returns fractions `yMatch`, `chromaModelMatch` (±1), `exactMatch`, `flatRegionMatch`; row-major indices `byteJumps` for errors ≥3 K; mean, nearest-rank p99 and maximum absolute errors in kelvins; and the supplied elapsed milliseconds. The positive linear kelvin scale is supplied explicitly (1/64 for the assumed high-gain P2 Pro model). Flat pixels have all available four-neighbours within 0.5 K in the reference; no flat pixels gives `null`. Y and chroma metrics compare the planar input to the reference, independently of reconstruction. Timing belongs to the caller so core needs no platform clock.

Errors are `planar dimensions must be positive even integers`, `invalid planar layout`, `planar plane is outside its buffer or has an invalid stride`, `reconstruction rows must be positive, pair-aligned and inside the frame`, `hint image must have the thermal dimensions`, `simulation requires an even height` (in addition to the YUYV validation errors), and `invalid comparison dimensions, scale or time`.

`packages/core/test/reconstruction.test.ts` covers the conversion, exact simple pair-aligned scenes without hints too, padded NV12 parity, garbage hint rejection, invalid input and known metric values. Regression floors cover twenty deterministic seeds, blurred and unblurred, with monotonic and garbage upper images, at 64×48. The full-size 256×192 benchmark lives at `packages/core/test/benchmark/reconstruction.ts`; run `node packages/core/test/benchmark/reconstruction.ts` under Node 26. It includes background, hand, 320 °C tip, checkerboard and twenty random rectangle scenes, three 3×3 box-blur passes when enabled, and realistic monotonic or garbage image rows. After three warmups it reports median time from three runs per case, all comparison metrics, CPU/Node identity, and PASS/FAIL against 30 ms, 99.9% flat exactness and p99 ≤0.5 K. Failure to reach targets does not set a failing exit code; timing on CPUs other than Apple M1/M2 is explicitly noncomparable. Synthetic results do not validate real browser transfers or camera accuracy.

Core's Vitest project allows 60 seconds per test and hook so shared-runner contention does not turn functional regression checks into speed tests. Performance targets remain in non-gating benchmarks; see the [testing guide](../guides/testing.md#shared-runner-load).

## Photo export

`packages/core/src/export/` exports three functions through the core entry point:

- `exportSnapshot(frame, options): Promise<Uint8Array>` captures the frame arrays
  and metadata before awaiting, then uses `MemoryByteSink` and `IrvisWriter`
  to append one frame and close the file. `SnapshotOptions` accepts writer
  options except width and height (taken from the frame); threshold defaults
  to 0. Profile, fps and path remain required. Optional `fields` supplies
  the declared frame fields. Writer validation and errors apply.
- `exportPng(frame, options): Promise<Uint8Array>` calls `celsiusImage`,
  `renderPalette`, `exportSnapshot` and the internal `encodePng`.
  `PngOptions` extends snapshot options with palette (default iron),
  range (default auto), and correction (default `settingsFromCamera`).
  Auto range falls back to 0–1 °C when no certain finite reading exists.
  Input-image, correction, palette and range validation errors propagate.
  PNG is encoded in pure TypeScript with synchronous fflate, without DOM.
- `exportCsv(image: CelsiusImage): string` validates with `checkImage` and
  writes `x,y,celsius,uncertain`, one row per pixel in row-major order,
  CRLF separators and a final CRLF, without BOM. Celsius values use
  JavaScript's locale-independent string conversion without rounding;
  non-finite values are empty. Nonzero mask values produce 1, otherwise 0.
  Callers use `celsiusImage` to apply the desired corrections first.

The PNG layout and reader integration are specified in
[PNG photos](../irvis-format.md#png-photos). Export buffers reside in memory;
the caller saves the returned bytes or CSV text through its platform backend.

PNG framing failures throw `IrvisError` prefixed with
`invalid thermal PNG: `. Reasons are `signature is missing`,
`truncated chunk`, `invalid chunk length`, `invalid chunk type`,
`CRC mismatch`, `IHDR must be first`, `invalid IHDR`,
`invalid dimensions`, `duplicate irVs chunk`, `invalid IEND`,
`IDAT is missing`, `irVs chunk is missing`, `unknown critical chunk`,
`IEND is missing`, `irVs is not an .irvis file`,
`snapshot index is missing or damaged`, or
`expected one frame matching IHDR dimensions`. Embedded codec errors
propagate as ordinary .irvis errors.

`packages/core/src/export/export.test.ts` covers snapshot metadata and buffer
reuse, PNG framing/CRCs and inflated RGBA bytes, reopening through
`IrvisReader`, malformed containers, CSV values and uncertainty, and range
fallback/validation. It uses synthetic data; external image-editor behaviour
is not covered.

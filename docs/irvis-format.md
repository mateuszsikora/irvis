# The .irvis format

Version: 1 (draft)

The specification of `.irvis`, the file irvis records temperatures in: a recording of any length, and a snapshot, which is a recording with one frame. It is for anyone who writes a reader or a writer, in irvis or elsewhere. A file holds the raw value of every pixel in every frame, within a stated error bound T, and everything needed to turn the values into degrees Celsius, so it can be read without the camera profile. MP4 is an export from it ([decision](decisions/architecture.md#recordings-are-irvis-files-and-mp4-is-an-export)).

Version 1 is a draft: it may still change without a version bump until the fixtures issue ([#16](https://github.com/mateuszsikora/irvis/issues/16)) measures the codec on real frames and freezes it. From then on, a change to the layout, a new record type or a new frame field needs a new version, and this document says what changed between versions. The implementation is `packages/core/src/irvis/` ([core: technical](features/core-technical.md#interfaces)).

## Encoding conventions

- Integers are little-endian. `u8`, `u32` are unsigned; `f64` is an IEEE 754 double.
- `varint` is unsigned LEB128: 7 bits per byte, low bits first, the high bit set on every byte but the last; at most 8 bytes and 2⁵³ − 1. `svarint` is the varint of the zigzag mapping of a signed integer (0, −1, 1, −2, … → 0, 1, 2, 3, …).
- JSON is UTF-8 without a byte order mark, as `JSON.stringify` writes it. Numbers are doubles and round-trip exactly.
- Deflate is raw DEFLATE (RFC 1951) without a zlib or gzip wrapper. irvis writes it with `fflate`'s `deflateSync` at level 6; any level reads.
- CRC-32 is the CRC of zlib and PNG (polynomial 0xEDB88320, reflected, initial and final XOR 0xFFFFFFFF); the check value of the ASCII bytes `123456789` is 0xCBF43926.
- Raw values and the threshold are in raw sensor units: unsigned 16-bit integers whose meaning the chunk's conversion gives. Under the P2 Pro's high-gain conversion one unit is 1/64 K, so T = 8 is 0.125 K and T = 16 is 0.25 K.
- Timestamps are milliseconds on the source's monotonic clock, as in `ThermalFrame.timestamp`.

## File layout

```
signature   8 bytes   0x89 'I' 'R' 'V' 'I' 'S' 0x0D 0x0A
header      record (type 1)
...         chunk (2), frame (3) and view-state (4) records
index       record (type 5)          only in a complete file
trailer     16 bytes                 only in a complete file
```

The signature's first byte is outside ASCII and its last two are CR LF, so a transfer that strips the eighth bit or converts line endings breaks it, as with PNG. The header record follows the signature directly. Then come the records of the recording in the order they were written: each chunk record is followed by the keyframe that starts the chunk and the other frames of the chunk; view-state records may come anywhere after the header. A writer that stops early (a crash, an unplugged camera, a closed tab) leaves a valid file without the index and the trailer, possibly with a partial record at the end; [reading](#reading-and-recovery) handles both.

## Records

```
type      u8       1 header, 2 chunk, 3 frame, 4 view state, 5 index
length    u32      bytes of the payload
payload   length bytes
crc       u32      CRC-32 of type, length and payload
```

A record adds 9 bytes to its payload. A reader that finds a type it does not know, a length that runs past the end of the file, or a CRC that does not match stops there (see [reading](#reading-and-recovery)).

## Header

The payload is a JSON object:

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | number | The format version, `1` |
| `profile` | `{ id, version, name }` | The camera profile the recording was made with: its id (`infiray-p2pro`), its version (a positive integer the profile raises when a constant that changes readings changes) and its name. For information only: reading needs no profile |
| `width`, `height` | positive integers | Thermal pixels per row and rows |
| `fps` | positive number | The nominal frame rate; each frame's timestamp says when it was taken |
| `bitDepth` | `16` | Bits per raw value |
| `path` | `"exact"` or `"reconstructed"` | Raw values from the camera's bytes, or reconstructed from the browser's lossy 4:2:0 frames |
| `threshold` | integer, 0 to 32767 | T: every stored value is within T raw units of the measured one. `0` is lossless |
| `thresholdHistory` | list of integers | The thresholds of earlier encodings, oldest first, each at most `threshold`; empty unless the file was [re-encoded](#re-encoding) |
| `frameFields` | list of field ids | The [frame fields](#frame-records) every frame record carries, in this order; distinct |
| `viewState` | object | The view settings at the start of the recording ([view state](#view-state-records)) |

A reader rejects a header whose `version` is not one it reads, and a header that breaks a rule in the table.

## Chunks and keyframes

A chunk is a run of frames that share a conversion and a camera state. It starts with a chunk record, whose payload is a JSON object, followed by a keyframe:

| Field | Type | Meaning |
| --- | --- | --- |
| `reason` | string | Why the chunk starts: `start` (the first frame), `interval` (10 s since the last keyframe), `gain` (the `gain` camera-state value changed), `camera-state` (another camera-state value or its origin changed), `conversion` (the conversion changed), `nuc` (the data show a NUC) |
| `step` | odd positive integer | The quantiser step of the chunk's frames, 2h + 1 ([frame body](#frame-body)) |
| `conversion` | object | Raw to °C, as the profile's `Conversion`: `{ "kind": "linear", "scale", "offset" }`, `{ "kind": "polynomial", "coefficients" }` (c0 first, at least two) or `{ "kind": "lut", "firstRaw", "celsius" }` ([cameras: technical](features/cameras-technical.md#schema)) |
| `gain` | string or null | The `gain` value of the camera state, or null when the state has none |
| `cameraState` | `{ origin, values }` | `origin` is `camera` (read from the camera), `declared` (set by the user, as in the browser) or `assumed` (the profile's defaults); `values` maps state field ids to strings or numbers |

A keyframe depends on no earlier frame, so playback can start at any chunk. irvis's writer starts a chunk:

1. at the first frame;
2. when a frame's camera state or conversion differs from the chunk's (a gain change is reported as `gain`);
3. at the first frame after a NUC that the data show, because the browser cannot ask the camera and the camera calibrates on its own: the first frame that differs after a run of at least 2 (`NUC_MIN_FROZEN`) frames that repeat the previous one exactly (the camera holds the picture while the shutter is closed; a single repeated frame is a backend delivering a frame twice and is ignored), or a frame whose mean differs from the previous frame's by more than 0.5 K (`NUC_MIN_STEP_KELVIN`, through the slope of the conversion) and by more than 10 times (`NUC_STEP_FACTOR`) the median of the last 25 (`NUC_HISTORY`) frame-to-frame steps;
4. when 10 s (`DEFAULT_KEYFRAME_INTERVAL_MS`) of frame time have passed since the chunk started.

A step of the mean also fires when the scene itself changes that much (a hot object filling the view), which costs one extra keyframe. These thresholds are tuned on synthetic data only; the fixtures issue (#16) tunes them on real NUC events. Only rule 2 is required of a writer: a reader takes the conversion and the camera state of a frame from its chunk.

## Frame records

```
flags        u8                 bit 0 keyframe, bit 1 uncertain mask present; other bits 0
time         f64 or svarint     keyframe: the timestamp in ms; otherwise: µs since the previous frame
fields       f64 × n            one per entry of the header's frameFields, NaN for no value
body         the rest           deflate of: [uncertain mask] [frame body]
```

**Time.** A keyframe stores its timestamp exactly. Any other frame stores the whole number of microseconds since the stored timestamp of the previous frame, d = round((t − t_prev) × 1000), and its timestamp is t_prev + d / 1000, computed in doubles in exactly that order by writer and reader. Timestamps are therefore exact at keyframes and within 0.5 µs elsewhere, and a dropped frame shows as a longer interval instead of shifting the frames after it. Timestamps never decrease: a reader may rely on that for seeking. irvis's writer rejects a frame whose timestamp is before the previous frame's as given, and stores d as at least 0, so a repeated timestamp that the previous stored one rounded above stays equal instead of going back.

**Numbers in chunk records.** JSON has no NaN or infinity, so a conversion or a camera-state number that is not finite cannot be stored; irvis's writer rejects such a frame. A JSON copy also turns −0 into 0, so the writer compares conversions with `===`, which treats them as equal.

**Frame fields.** Values that change every frame and that the conversion may need. Version 1 knows one field id, `sensor-temperature` (the sensor temperature, `cur_vtemp` on the P2 Pro, in the camera's units until [#7](https://github.com/mateuszsikora/irvis/issues/7) defines them). A new field id needs a new format version.

**Uncertain mask.** With flag bit 1, the deflated data start with ⌈width × height / 8⌉ bytes: bit i (byte i >> 3, bit i & 7, least significant first) is 1 when pixel i, in row-major order, is uncertain, which the browser's reconstruction reports for values it could not recover exactly (`ThermalFrame.uncertain`). The issue calls it the `confident` mask; the bits are its negation. Without the flag every value is exact. The threshold guarantee holds for uncertain pixels too, against the reconstructed value.

## Frame body

The values of a frame are decoded in the order frames are stored; each frame after a keyframe is predicted from the previous decoded frame. Every value the decoder computes is clamped to 0…65535. A residual q is stored as one byte if its zigzag mapping z is below 255, and otherwise as the byte 255 (the escape code) followed by `varint(z − 255)`, so even a 320 °C tip entering a block (about 19 000 raw units) is one escaped residual. `step` is the chunk's.

**Keyframe.** width × height residuals, one per pixel in row-major order. Pixel (x, y) is predicted from its decoded neighbours left (a), above (b) and above-left (c) by the LOCO-I median predictor: in row 0, a (0 for the first pixel); in column 0, b; otherwise min(a, b) if c ≥ max(a, b), max(a, b) if c ≤ min(a, b), else a + b − c. The value is clamp(prediction + q × step).

**Other frames.** The frame is split into blocks of 8 × 8 pixels in row-major order, ⌈width / 8⌉ × ⌈height / 8⌉ of them; blocks at the right and bottom edges are as wide and tall as what is left. The body holds three parts one after the other:

1. one mode byte per block: 0 skip, 1 dense, 2 sparse;
2. for each sparse block, in block order, a mask of ⌈n / 8⌉ bytes, n being the pixels of the block: bit k, least significant first, is pixel k of the block in row-major order;
3. the residuals, block by block: none for a skip block, one per pixel for a dense block, one per set mask bit for a sparse block, each pixel in row-major order within its block.

With p the pixel's value in the previous decoded frame: a skip block keeps p; a dense block, and a set mask bit, give clamp(p + q × step); a clear mask bit keeps p. A body with an unknown mode, too few bytes, or bytes left after its last residual is damaged.

### How irvis encodes

A decoder needs only the rules above; this is how irvis's encoder (`FrameEncoder` in `packages/core/src/irvis/codec.ts`) chooses what to store, and why every value stays within T. With T the tolerance and h = ⌊T × 0.25⌋ the quantiser's half-width (step = 2h + 1):

1. It keeps a denoised estimate e per pixel: the first value, then e + 0.25 × (m − e) for each new measured value m, or m itself when |m − e| > T (a real change, not noise). The estimate survives keyframes.
2. The target of each pixel is round(e) clamped to [m − (T − h), m + (T − h)]. Every value it stores is the nearest value of the form prediction + q × step to the target, which is within h of it, so |m − stored| ≤ (T − h) + h = T. Clamping to 0…65535 only moves a value towards its target.
3. In a frame that is not a keyframe, a pixel is outside T when |m − p| > T. A block with no pixel outside T is skipped. Otherwise the encoder estimates the cost of both other modes with the Elias gamma length of each residual's zigzag code, plus one bit per pixel for the mask of a sparse block, and resends the block whole (dense, every pixel moved to its target) when that costs at most as much as sending only the pixels outside T (sparse). Skipped pixels and clear mask bits keep p, which is within T by the test.

Placing values near the denoised estimate, not at the edge of the tolerance, keeps the next frame's noise within T, so a static scene stays skipped; that and the per-block choice are why the [benchmark](#benchmark) beats the earlier simulation. These settings (`DEFAULT_TUNING`: precision 0.25, weight 0.25, dense bias 1) change file sizes, not the format, and the fixtures issue (#16) tunes them on real frames.

## View-state records

The payload is a JSON object `{ "timestamp": <ms>, "values": { … } }`: the view settings that changed at that time, on the frames' clock, and only those. The header's `viewState` holds the settings at the start. Version 1 does not fix the setting names or their values, and `IrvisReader` returns every name and value as written, without checking them. No code writes or reads view settings yet; the viewer will ([#17](https://github.com/mateuszsikora/irvis/issues/17), [#19](https://github.com/mateuszsikora/irvis/issues/19)). The planned names for the corrections follow the fields of core's types ([core](features/core-user.md#correct-readings-show-units-raise-alarms-and-paint-isotherms)), so that a value can be stored as the type holds it:

| Name | Planned value |
| --- | --- |
| `units` | `"C"` or `"F"` (`TemperatureUnit`) |
| `emissivity` | `CorrectionSettings.emissivity`: a number greater than 0 and at most 1 |
| `reflectedCelsius` | `CorrectionSettings.reflectedCelsius`: °C, above −273.15 |
| `offsetKelvin` | `CorrectionSettings.offsetKelvin`: kelvin added after the emissivity correction |
| `alarms` | `AlarmSettings`: `{ "highCelsius", "lowCelsius", "hysteresis" }`, a threshold a number or `null` |
| `isotherms` | a list of `Isotherm`: `{ "kind": "above" \| "below", "celsius", "color": [r, g, b] }` or `{ "kind": "between", "minCelsius", "maxCelsius", "color" }` |

These are the user's settings. What the camera applied itself is in the chunk's `cameraState` (`emissivity`, `reflected-temperature`), and readings are corrected relative to it ([decision](decisions/architecture.md#the-software-correction-works-relative-to-what-the-camera-applied)). Photo exports (#15) use the types from [#12](https://github.com/mateuszsikora/irvis/issues/12): `palette`, a `PaletteId` (`"iron"`, `"white-hot"`, `"black-hot"`, `"rainbow"`, `"red-hot"` or `"cold-blue"`); `range`, `"auto"` or a `TemperatureRange` `{ "minCelsius", "maxCelsius" }`; and `measurements`, whose schema waits for several measurements at once (#18). Photo exports write the resolved numeric range and correction settings as specified in [PNG photos](#png-photos). TODO(owner): fix the remaining view-setting names and schemas, with code that writes and reads them, before v1 is frozen in #16.

## Index and trailer

The index record comes after the last frame; its payload is the deflate of:

```
varint   chunk count;   per chunk:  varint offset − previous chunk's offset (the first: − 0)
varint   frame count;   per frame:  varint offset − previous frame's offset, u8 flags, then
                                    f64 timestamp (keyframe) or svarint µs (other), as in its record
varint   view count;    per view:   varint offset − previous view's offset
```

Offsets are file offsets of the records. Frame k belongs to the chunk of the last keyframe at or before it. The trailer is the index record's offset as two `u32` (low, then high), followed by the 8 bytes `IRVISIDX`; it ends the file. Everything in the index can be rebuilt by scanning the records.

## Reading and recovery

irvis's reader (`IrvisReader.open`):

1. checks the signature and reads the header record, exactly its bytes, which must be valid;
2. if the file ends in a trailer whose index record is valid, ends where the trailer starts, inflates, and fits the chunk and frame offsets, takes the frame table from it and reads the view-state records it lists; if any of that fails, it scans as in step 3. These reads take each record's exact bytes, so opening a long file costs the header, the index and the view-state records, not the frames;
3. otherwise scans the records from the header on and stops at the first that is cut short, fails its CRC, has an unknown type or invalid content, or breaks the order (a frame before the first chunk, a chunk that does not start with a keyframe, a keyframe that does not start a chunk). A chunk record at the end without its keyframe is dropped. Everything before the stop is readable; the reader reports where it stopped and why.

A frame record's CRC is checked again when the frame is decoded, so a file whose index is intact but whose frame data are damaged fails on that frame only. The writer flushes its sink at the first frame and then whenever 1 s (`DEFAULT_FLUSH_INTERVAL_MS`) of frame time has passed, so a crash loses about the last second. It changes its own state (the chunk, the frame table, the offset, the last timestamp) only after the sink accepted a record; when the sink rejects an append or a flush, the bytes it holds are unknown, so the writer refuses every later call, `close` included, instead of predicting the next frame from one that may be missing. The file then reads by scanning up to its last whole record.

## Re-encoding

A file with threshold T1 can be re-encoded to a threshold T2 ≥ T1, never to a smaller one: the encoder treats the stored values as the input with the tolerance T2 − T1, so they change by at most T2 − T1 and stay within T2 of the measured values. The new header has `threshold` T2 and appends T1 to `thresholdHistory`. Chunk boundaries and reasons, timestamps, frame fields, masks and view-state records are copied. Re-encoding a file that was cut short or lost its index copies it up to its last valid record. With an intact index, a frame that does not decode costs the rest of its chunk, whose frames depend on it, and copying goes on at the next keyframe; every view-state record is copied. The result is a complete file either way. T2 = T1 copies the values exactly.

## Benchmark

`npm run bench:irvis` (`packages/core/test/benchmark/irvis.ts`) writes synthetic scenes through `IrvisWriter` and reads them back. The scenes are 256 × 192 at 25 fps with Gaussian noise σ = 2.5 raw units (about 0.04 K): a static room with a mug, and a hand at 34 °C moving across it. 250 frames (one keyframe interval, 10 s) are extrapolated to a minute; uncompressed that is 147.5 MB/min. Result on an Apple M2 Pro with Node 26.13, November 2026:

| Scene | T (raw) | MB/min | skip | dense | sparse | encode ms/frame | decode ms/frame | max error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| static | 0 | 42.55 | 0.0% | 100.0% | 0.0% | 3.14 | 1.23 | 0 |
| static | 8 | 1.05 | 72.4% | 0.0% | 27.6% | 1.23 | 0.53 | 8 |
| static | 16 | 0.11 | 99.8% | 0.0% | 0.2% | 0.98 | 0.34 | 16 |
| moving hand | 0 | 46.64 | 0.0% | 100.0% | 0.0% | 3.25 | 1.37 | 0 |
| moving hand | 8 | 4.72 | 58.1% | 7.9% | 34.0% | 1.30 | 0.47 | 8 |
| moving hand | 16 | 2.72 | 89.1% | 6.3% | 4.6% | 1.12 | 0.40 | 16 |

The earlier simulation estimated, for T = 0.125 K (8 raw), 2.4 to 4.2 MB/min static and 5.5 to 8.3 MB/min with movement, and for T = 0.25 K (16 raw), 0.28 to 0.81 and 3.0 to 3.3 MB/min ([decision](decisions/architecture.md#recordings-are-irvis-files-and-mp4-is-an-export)). With the same noise model the codec does better in every case. Real frames have drift, dead pixels, shutter events and noise that is not Gaussian; until the fixtures issue (#16) runs the benchmark on them, these numbers are an upper bound on what synthetic data can show, not a prediction. Sending only the pixels outside T was the cheapest in a static scene at T = 8, resending whole blocks wins in places with movement, and skip dominates at T = 16, so no single block mode wins everywhere. Deflate level 9 instead of 6 (`npm run bench:irvis -- --level 9`) saved under 1%: 1.04 instead of 1.05 MB/min for the static scene and 4.71 instead of 4.72 for the moving hand at T = 8.

## Not decided yet

- Motion compensation: [postponed](decisions/architecture.md#motion-compensation-in-irvis-is-postponed) until the codec is measured on real frames (#16).
- An own entropy coder instead of deflate: not tried; it would need a measured gain first.
- The names and schemas of the view settings ([view state](#view-state-records)).

## Versions

| Version | Changes |
| --- | --- |
| 1 (draft) | First version ([#14](https://github.com/mateuszsikora/irvis/issues/14)) |

## See also

- [Core: technical](features/core-technical.md#interfaces): the writer, the reader and their errors.
- [Architecture decisions](decisions/architecture.md#recordings-are-irvis-files-and-mp4-is-an-export)

## PNG photos

Version 1 (draft) also defines the private ancillary chunk `irVs`. The payload
is exactly one complete version-1 .irvis file, including signature, index and
trailer, with one frame. Its dimensions must equal PNG IHDR dimensions.
There is exactly one `irVs` chunk, after IHDR and before IEND; the writer
places it after IDAT. No extra wrapper or compression surrounds the payload.

PNG follows the [W3C PNG specification](https://www.w3.org/TR/png-3/):
chunk lengths and CRCs are big-endian, and the CRC covers the four type bytes
and payload. The lowercase i means ancillary, r means private, uppercase V
is the reserved bit, and lowercase s means safe to copy. Editors may retain
the original thermal frame while changing the visible image; measurements
always use that frame, not the PNG pixels.

The writer produces 8-bit RGBA (colour type 6), non-interlaced, filter 0 on
each row, with zlib-wrapped DEFLATE in IDAT. This differs from the raw
DEFLATE inside .irvis. Non-finite temperatures render transparent black.

`IrvisReader.open` detects PNG by signature, reads the PNG into memory,
checks chunk boundaries and CRCs, extracts the snapshot, requires an intact snapshot index, checks its dimensions
and frame count and decodes the frame before returning the normal reader.
It rejects missing or duplicate thermal chunks and nested PNG payloads.
It does not decode or validate the compressed visible image. Ordinary PNGs
without `irVs` cannot provide thermal readings.

The photo writer stores `palette`, the resolved `range`
(`minCelsius`, `maxCelsius`), and `emissivity`, `reflectedCelsius`,
`offsetKelvin` in the embedded header's view state, overriding those keys
in caller-supplied view settings. These settings describe the visible image.

# Capture tool: technical

How `tools/capture-cli` (workspace `@irvis/capture-cli`) captures, probes and measures, for whoever changes it. How to use it: [capture tool](capture-cli-user.md). It runs on Node 26 with type stripping, without a build ([decision](../decisions/architecture.md#the-capture-tool-runs-on-node-type-stripping-without-tsx)), and imports `@irvis/core` for the profile, the decoders and the conversion.

## Data flow

`src/cli.ts` parses the command line (`main(argv)`, with `node:util` `parseArgs`) and calls the functions in `src/commands.ts`. The profile is always `infiray-p2pro` (`PROFILE_ID`); `modeByRows('384')` picks its video mode with that many rows.

### Capture

1. `captureCommand` looks the device name up with `listDevices` (`ffmpeg -hide_banner -nostdin -f avfoundation -list_devices true -i ""`, parsed by `parseDeviceList`) and calls `capture` in `src/capture.ts`.
2. `capture` creates `<out>/frames/` and fails if it already holds files, reads the version with `ffmpeg -hide_banner -version` (`parseFfmpegVersion`), and starts ffmpeg with `captureArgs`:

   ```
   -hide_banner -nostdin -loglevel info -f avfoundation -framerate <fps> -video_size <w>x<h>
   -pixel_format yuyv422 -t <seconds> -i <index>:none
   -map 0:v -c:v rawvideo -pix_fmt + -fps_mode passthrough -enc_time_base demux -f rawvideo pipe:1
   -map 0:v -c:v copy -f framecrc <out>/packets.framecrc
   ```

   The stdout output decodes and packs raw pixels in the unchanged input format: `-pix_fmt +` disables automatic conversion, `-fps_mode passthrough` avoids frame duplication or dropping, and `-enc_time_base demux` preserves input timestamp precision. This removes packet allocation padding that would shift subsequent frame boundaries in a stream copy. The framecrc output remains a stream copy of the original packets ([decision](../decisions/architecture.md#capture-output-packs-pixels-without-automatic-conversion)). What AVFoundation itself delivers shows up in two places. A format with another number of bytes per pixel (`nv12`, `bgr0`) or padded rows changes the packet sizes in `packets.framecrc`. A format with the same 2 bytes per pixel, such as `uyvy422` (`[U Y0 V Y1]` instead of `[Y0 U Y1 V]`), keeps every packet at 196 608 B, so only ffmpeg's log tells: `Overriding selected pixel format to use <format> instead.`, and the input's `Stream #0:0: Video: rawvideo (<tag>), <format>, <w>x<h>` line. ffmpeg's stderr goes to `<out>/ffmpeg.log`.
3. `FrameSplitter` cuts stdout into frames of width × height × 2 bytes (196 608 in the 384 mode), whatever the pipe's chunk sizes. For each whole frame, the arrival time is `performance.now()` minus the time taken just before ffmpeg was started; the frame is gzipped (`node:zlib`, default level) to `frames/<6-digit index>.yuyv.gz`. Each write handles its own failure at once: the first failed write stops ffmpeg with SIGINT, and after ffmpeg exits `capture` fails with `<out>: writing frame <n> failed: <message>`, where `<n>` is the lowest frame index whose write failed (writes finish out of order) and writes no `meta.json`.
4. `-t` ends the capture. If ffmpeg is still running `--seconds` plus `STOP_GRACE_SECONDS` (20) later, it gets SIGINT and, 3 s after that, SIGKILL.
5. After ffmpeg exits and every frame is written, `capture` reads the delivered pixel format from `ffmpeg.log` with `parseInputPixelFormat` (the fallback AVFoundation announced, else the format of the `Stream #0:0` line under `Input #0`, else `null`) and writes `meta.json` ([schema](#schema)). `captureCommand` fails when no frame arrived; otherwise it prints one line, followed by `formatWarning`'s line when the format is not `yuyv422`.

### Probe

`probe` prints, in order: the ffmpeg version; the device's name from `listDevices`; the modes from `modesProbeArgs` (`-framerate 1 -video_size 1x1`, which AVFoundation rejects with `Supported modes:` and one `<w>x<h>@[<min> <max>]fps` line each, parsed by `parseSupportedModes`); the pixel formats from `pixelFormatProbeArgs` at 256×384, or the first mode if there is none (`-pixel_format monob`, which no UVC camera offers, so AVFoundation lists `Supported pixel formats:` and says `Overriding selected pixel format to use <format> instead.`; `parsePixelFormats`; one frame is read into `-f null -`); and `probeUsb` from `src/usb.ts`. Each ffmpeg run is stopped after 15 s.

`probeUsb` imports node-usb (`usb` 2.x, with legacy and WebUSB APIs) by a computed specifier, so that its declarations, which need the DOM library, stay out of this Node project; `src/usb.ts` declares the members it uses. It lists `webusb.getDevices()` with the profile's USB IDs and prints the names, versions, classes, interfaces and endpoints. Then it opens the device and reads the configuration descriptor with two GET_DESCRIPTOR control transfers (9 bytes for the total length, then all of it); `describeConfiguration` prints one line per descriptor and decodes the UVC class-specific ones: extension units (id, GUID, number of controls), uncompressed and MJPEG formats (FourCC, GUID, bits per pixel) and frames (size, buffer size, default and listed frame rates). A failure to load node-usb, list devices, open the device or read the descriptor becomes a line of the output, not an error.

### Report

`reportCommand(dir, frame)` finds the capture directories (`dir` itself if it has `meta.json`, else its subdirectories that do) and runs `reportCapture` on each. `reportCapture` reads `meta.json` (`readMeta`), `packets.framecrc` (`parseFramecrc`; missing means no packet list) and the frames, and `analyse` reads every frame twice:

1. **Per frame.** The thermal rows of the profile's mode become raw values with `decodeYuyvRaw` from `@irvis/core`; per frame: mean, population standard deviation over pixels ("spread"), minimum, maximum, the centre (mean of the 2×2 pixels around the centre: columns 127–128, rows 95–96 of the thermal block), and whether every raw value equals the previous frame's. Every ⌊n / 50⌋-th frame, at most 50 (`UPPER_SAMPLES`), the image rows (or the whole frame in a mode without temperature data) are split with `decodeYuyvImage`: Y minimum and maximum, U and V statistics, the share of U and V bytes within 128 ± 2 (`NEUTRAL_UV`), and the Spearman rank correlation, ties averaged, of Y with the raw value of the same pixel index.
2. **Events.** Kelvin per raw unit is the slope of the conversion at the median frame mean. Three kinds, each a heuristic to be checked against the data:
   - `frozen`: a run of frames whose raw values repeat the frame before exactly. The event starts at the last frame that differs; `frames` counts it and the repeats; the step is the mean of the frame after the run minus the mean of that first frame.
   - `flat`: a run of frames whose spread is below 0.25 (`FLAT_FRACTION`) of the median spread, as when a closed shutter fills the view.
   - `step`: a frame whose mean differs from the previous one by more than 0.5 K (`STEP_MIN_KELVIN`) and more than 10 times (`STEP_FACTOR`) the median of these differences, outside the frames of the other events.
3. **Noise.** Over the longest run of frames that no event covers (an event covers its frames and the frame after), if it has at least 25 frames (`NOISE_MIN_FRAMES`), the temporal population standard deviation of every pixel, read a second time from the files. The report gives the median and the mean over pixels in mK, and the median again after subtracting from each frame its mean minus the run's mean of frame means, which removes global drift and flicker. It is an estimate of the NETD only when the scene is static.
4. **Temperatures**, with the profile's first conversion (high gain) through `toCelsius`: minimum, maximum and centre of the preview frame (the middle frame, `⌊n / 2⌋`, or `--frame`, clamped to the capture); a histogram of its pixels in bins of max(1, ⌈range / 30⌉) °C starting at a multiple of the bin width; over every frame, the lowest minimum, the highest maximum and the mean and standard deviation of the centre. "Looks like temperature data" means the median frame mean is between −40 and 200 °C and the median spread is above 0. With a reference reading, the difference is the centre mean minus the reading.
5. **Timing.** From the arrival times: the span from the first to the last frame, frames per second as (n − 1) / span, the intervals' statistics with the 99th percentile, and late intervals, longer than 1.5 (`LATE_FACTOR`) nominal periods. From the packets' pts in their time base, the same rate and spread, and missing frames: each interval of about k nominal periods (rounded) counts k − 1.
6. **Size and format.** "Every frame has the expected size" holds when there are frames, `trailingBytes` is 0 and, if the packet list exists, it has one packet per frame, each of `frameBytes`. The pixel format comes from `meta.json` and is printed by `pixelFormatText`: `yuyv422, as requested`, `<format>, not yuyv422: the bytes are reordered or converted, so the values below are wrong`, or `unknown (ffmpeg.log does not say)`.

`formatReport` turns the result into the Markdown block, `upperVerdict` into "greyscale (U and V within 128 ± 2)" when at least 99% of U and V bytes are neutral (else "colour: U and V vary, so probably a palette") and "brightness rises with temperature" for a median Spearman of at least 0.9, "falls" for at most −0.9, else "is not a monotonic function of temperature". `reportCapture` writes `report.md`, `report.json` and the previews. For a session, `formatSummary` writes the summary table and five lines before the blocks: the size, the pixel formats delivered, the 384 answer, the upper half and the agreement with the Android app. When a capture with temperature data has a known format other than `yuyv422`, the 384 answer is `unknown: AVFoundation delivered <formats>, not yuyv422, so the bytes were not as the camera sent them`, naming only the formats other than `yuyv422` (the line above it lists every format of the session), because swapped bytes cannot look like temperatures whether or not the mode needs a command; otherwise it is `yes` only when every such capture has the expected size and looks like temperature data. A capture without a report gets `No report: <message>`.

### Spike

`spike` in `src/spike.ts` asks for the device (`guessDevice` suggests the first name matching `/usb camera|thermal|p2|t7/i`; `chooseDevice` takes Enter as the suggestion and asks again for an empty answer without one, a non-number or an index not in the list), writes `probe.txt`, runs `SCENARIOS` in order (each through `captureCommand` into `<session>/<id>/`, labelled with its id; a failed capture is printed and skipped; if it left no `meta.json`, as when a frame could not be written, it has no block of its own, so `sessionHeader` lists it under `Failed captures:` as `` - `<id>`: <message> ``, while a capture without frames keeps its `meta.json` and gets `No report: …`), stores the Android reading with `setReference` for the scenarios that ask for one, and ends with `reportCommand` on the session (or with `No captures; the probe is in <session>/probe.txt.` and the failed captures, when every scenario was skipped or failed), with a header naming the session and holding the probe output in a collapsed `<details>` block.

## Schema

A capture directory:

| Path | Content |
| --- | --- |
| `frames/000000.yuyv.gz`, … | One gzip file per frame: width × height × 2 bytes for YUYV, packed without pixel conversion; packet allocation padding is excluded |
| `meta.json` | Below |
| `packets.framecrc` | ffmpeg's framecrc output: `#tb 0: <num>/<den>`, then `0, <dts>, <pts>, <duration>, <size>, 0x<adler32>` per packet |
| `ffmpeg.log` | ffmpeg's stderr |
| `report.md`, `report.json` | Written by `report`; `report.json` is the `CaptureReport` from `src/report.ts` |
| `preview-image.pgm`, `preview-image.png` | Y of the image rows of the preview frame, 8 bits |
| `preview-thermal.pgm`, `preview-thermal.png` | Raw values of the preview frame: 16-bit big-endian PGM (maxval 65535); 8-bit PNG stretched from the minimum (0) to the maximum (255) |

A session directory holds `probe.txt`, `report.md` and one capture directory per scenario.

`meta.json` (`CaptureMeta` in `src/meta.ts`):

| Field | Meaning |
| --- | --- |
| `format`, `version` | `"irvis-capture"`, `1`; `readMeta` rejects anything else |
| `createdAt` | ISO 8601 time when the capture ended |
| `label` | `--label` or the scenario id; `null` without one |
| `referenceCelsius` | The Android app's centre reading, from `--reference` or `reference`; `null` without one |
| `device` | `index` and `name` (`null` if `list` did not show the index) |
| `profile` | `infiray-p2pro` |
| `mode` | `id`, `width`, `height`, `fps` of the profile's video mode |
| `frameBytes` | width × height × 2 |
| `requestedSeconds` | `--seconds` |
| `pixelFormat` | The format of ffmpeg's input stream from `ffmpeg.log` (`yuyv422` is what capture asks for); `null` when the log does not say. `readMeta` reads a file without the field as `null` |
| `ffmpeg` | `path`, `version` (`null` if unknown), `args` exactly as passed, `exitCode` and `signal` |
| `system` | `platform`, `arch`, `release` (`os.release()`), `macos` (`sw_vers -productVersion`, `null` elsewhere), `node` |
| `timing` | `firstFrameMs` (`null` without frames), `endMs`, `stoppedByTimeout`; milliseconds since just before ffmpeg was started |
| `frames` | One `{ file, arrivalMs }` per whole frame, in order |
| `trailingBytes` | Bytes after the last whole frame |

## Interfaces

| Command | Options | Output |
| --- | --- | --- |
| `list` | | `AVFoundation video devices:` and `  [<index>] <name>` per device, or `No AVFoundation video devices.` |
| `probe` | `--device <index>` | The lines described in [Probe](#probe) |
| `capture` | `--device <index>`, `--seconds <s>`, `--mode 384\|192`, `--out <dir>`, optional `--label <text>`, `--reference <°C>` | `<out>: <n> frames, the first <ms> ms after ffmpeg started; ffmpeg exited with <code>` (or `ffmpeg was stopped after the time limit`) |
| `report` | `<dir>`, optional `--frame <n>` | The Markdown report |
| `reference` | `<dir> <°C>` | `<dir>: Android reading <°C> °C stored; run report again` |
| `spike` | optional `--out <dir>` (default `captures/m1-<yyyymmdd>-<hhmmss>`) | Prompts, then the session report and `Written to <dir>/report.md. Paste it into the issue; keep the frames local.` |
| `--help`, `-h`, `help`, nothing | | The usage |

npm scripts: `npm run capture -- <command>` and `npm run spike:m1` ([development guide](../guides/development.md#npm-scripts)). `list`, `probe`, `capture` and `spike` need macOS; `report` and `reference` run anywhere. A `.yuyv.gz` frame reads back with `gunzipSync`, and `@irvis/core` decodes it ([core: technical](core-technical.md#interfaces)).

## Configuration

| Name | Default | Read by |
| --- | --- | --- |
| `IRVIS_FFMPEG` | unset: the first executable `ffmpeg` in a `PATH` directory | `findFfmpeg` in `src/ffmpeg.ts` |
| `UPPER_SAMPLES`, `LATE_FACTOR`, `FLAT_FRACTION`, `STEP_MIN_KELVIN`, `STEP_FACTOR`, `NEUTRAL_UV`, `NOISE_MIN_FRAMES` | 50, 1.5, 0.25, 0.5, 10, 2, 25 | `analyse` in `src/report.ts` ([Report](#report)) |
| `STOP_GRACE_SECONDS` | 20 | `capture` |

`package.json` of the workspace depends on `@irvis/core` and `usb` (`^2.19.1`, MIT, with bundled prebuilt native binaries). `tsconfig.lib.json` (`src/` without tests) and `tsconfig.test.json` use `lib: ["ES2024"]` and `types: ["node"]` (`"vitest"` too for the tests) and reference core's library project; `vitest.config.ts` names the Vitest project `capture-cli` and allows 60 s per test, because the report tests build and read back synthetic captures.

## Failure modes

Every error is printed as `capture-cli: <message>`. Options are checked before the platform, so a usage error is reported the same way on every system. Usage errors (`UsageError` in `src/cli.ts`) add a blank line and the usage, and exit with 2; `CliError` (`src/errors.ts`) exits with 1; any other error prints its stack and exits with 1.

| Message | Kind | Cause |
| --- | --- | --- |
| `<option> is required` | usage | `--device`, `--seconds`, `--mode`, `--out`, `<dir>` or `<°C>` missing or empty |
| `<option> must be an integer of at least 0, not '<value>'` | usage | `--device` or `--frame` (a negative value needs the form `--device=-1`, or `parseArgs` reports it) |
| `--seconds must be a positive number of at most 36000, not '<value>'` | usage | `MAX_SECONDS` in `src/cli.ts`, ten hours |
| `reference takes <dir> <°C>, not <arguments>` | usage | More than two arguments. `reference` does not go through `parseArgs`, so a negative reading (`reference <dir> -5`) is a value; `--` is ignored |
| `--mode must be 384 or 192, not '<value>'` | usage | The heights of the profile's modes |
| `'<value>' is not a temperature` | usage | `--reference` or `<°C>` is not a number (a comma counts as the decimal point). A negative `--reference` needs the form `--reference=-5` |
| `unknown command '<command>'` | usage | |
| Node's `parseArgs` messages, such as `Unknown option '--x'` | usage | |
| `capture-cli <command> uses AVFoundation and runs only on macOS; this is <platform>` | error | `list`, `probe`, `capture` or `spike` elsewhere |
| `IRVIS_FFMPEG=<path> is not an executable file` | error | |
| `ffmpeg not found: install it (brew install ffmpeg) or set IRVIS_FFMPEG to its path` | error | |
| `<out> already holds frames; choose an empty directory` | error | `frames/` is not empty |
| `<out>: no frames arrived (ffmpeg exited with <code>); see <out>/ffmpeg.log`, `<out>: no frames arrived (ffmpeg was stopped after the time limit); see <out>/ffmpeg.log` | error | The spike prints it and goes on with the next scenario |
| `<out>: writing frame <n> failed: <message>` | error | A frame file could not be written (full disk, permissions); ffmpeg was stopped |
| `<dir> does not exist`, `<dir> is not a directory`, `<dir> cannot be read: <message>`, `<dir> has no meta.json and no capture directories`, `<dir> has no meta.json` | error | `report`, `reference` |
| `<dir>/meta.json is not an irvis-capture version 1 file`, `<dir>/meta.json is not valid JSON: <message>` | error | In a session report each becomes `No report: …` for that capture |
| `<dir> has no frames; see <dir>/ffmpeg.log` | error | `report` of a capture without frames; in a session it becomes `No report: …` |
| `unknown profile '<id>' or video mode '<id>'` | error | `meta.json` names something the registry does not have |
| `no AVFoundation video devices; connect the camera and run the spike again` | error | The spike found no camera at all |
| `type the index of the thermal camera`, `'<answer>' is not a device index`, `there is no device [<answer>] in the list above` | spike | The first question; the spike prints the message and asks again |
| `'<answer>' is not a temperature` | spike | The Android reading; asked again |

## Tests

| File | Covers |
| --- | --- |
| `tools/capture-cli/src/ffmpeg.test.ts` | Parsing the device list, the modes, the pixel formats, the version and framecrc from ffmpeg output; `parseInputPixelFormat` from the fallback line and from the input stream, not an output stream; `captureArgs` packs pixels without conversion and preserves original packet sizes ([invariant 20](../invariants.md)); `findFfmpeg` with `IRVIS_FFMPEG`, `PATH` and their messages |
| `tools/capture-cli/src/units.test.ts` | `FrameSplitter` across chunk boundaries; ranks, Spearman, summaries, quantiles, histogram; PGM and PNG files; GUIDs and UVC descriptors; the command line's usage errors, an empty `--device`, the ten-hour limit, a negative `reference` reading; `formatWarning`; `parseCelsius`; `guessDevice` and `chooseDevice`; `sessionHeader` with and without failed captures |
| `tools/capture-cli/test/capture.test.ts` | `capture` with a shell script standing in for ffmpeg: 2.5 frames on stdout become two frame files and 98 304 trailing bytes, the version, `ffmpeg.log`, `packets.framecrc`, `meta.json`, and `uyvy422` read from the log; a frame that cannot be written (a read-only `frames/`) fails with its message. Runs on Linux and macOS without ffmpeg |
| `tools/capture-cli/test/report.test.ts` | `reportCapture` and `reportCommand` on synthetic capture directories from `test/synthetic.ts`: exact frames, 25 fps, temperatures, the reference difference, greyscale upper half with rising brightness, a frozen run of 5 repeated frames in 100, a flat run and a step of the mean each found as one NUC event, the noise of known synthetic noise (40 mK), wrong packet sizes, the 192 mode, a session summary, and a session with `uyvy422` and a broken `meta.json` ([invariant 21](../invariants.md)) |
| `tools/capture-cli/test/synthetic.ts` | Not a test: writes a capture directory as `capture` would, without ffmpeg |

Not covered: running the real ffmpeg (`capture` with AVFoundation, `probe`, `listDevices`), the time limit of `capture`, the spike's prompts, and node-usb with a real device in CI, because CI has no camera. Local M2 observations are recorded separately in [M2 findings](../findings/m2.md). The heuristics of the report are tested only on synthetic data, and the owner's results in [M1 findings](../findings/m1.md) are the first check against a real camera.

## See also

- [Capture tool](capture-cli-user.md)
- [Cameras: technical](cameras-technical.md)
- [Core: technical](core-technical.md)

## M2 USB diagnostics

`src/usb-command.ts` handles `usb` separately from the M1 parser. It uses node-usb 2.x's legacy device API via a dynamic import with local structural types. Version 3.x exposes WebUSB instead and does not supply `getDeviceList`; the runtime import test prevents that incompatible upgrade. OUT callbacks return a transferred byte count, while IN callbacks return a Buffer. Transfer logging preserves either shape without applying buffer formatting to numbers. Default access opens without claiming or detaching; `--detach` explicitly detaches interface 0 without a stream and attempts reattachment in cleanup. `--iokit <executable>` instead invokes `iokit-request.c` through `run` (two-second timeout), without opening the node-usb device. This helper uses IOKit DeviceRequest and never seizes an interface. `60-irvis.rules` grants local desktop uaccess for the two profile PIDs.

`src/usb-protocol.ts` implements bounded ready polling, long TPD operations, standard palette operations and state snapshots. Every snapshot retains failed fields as error objects; `cur_vtemp` is an experimental two-byte read, preserved as hex. Commands and constants come from the P2 Pro profile; see [protocol](../protocol.md). Mutating command failures still trigger a state readback in `finally`, except during cancellation. Logs preserve every transfer and error. No setting is restored automatically.

Options: `--device <bus>:<address>` (required with multiple cameras), `--out <file>` (JSONL, exclusive create), `--seconds <1..3600>` (default 12), `--video <index-or-path>`, `--detach`, `--iokit <executable>`. JSONL records contain `time` (ISO UTC), `event` and `data`; events include session, devices, kernel, transfer, state-before/after, command-start/end, state-sample, frame and errors. The output file's parent directory must exist. Errors propagate to the CLI's error handler; partial logs remain available.

`src/usb-video.ts` launches AVFoundation or V4L2 ffmpeg with strict `+yuyv422`, packs 196608-byte frames, and logs raw-unit statistics without assuming a temperature conversion. Output uses `-fps_mode passthrough`, so timestamp gaps do not produce synthetic duplicate frames. It checks startup after four seconds, again before the command and during the observation loop. `check()` rejects a live process when its last complete frame is older than `VIDEO_STALL_MS` (2000 ms), with `video stream stalled: no complete frame for more than 2000 ms`; partial frames do not refresh the deadline. Stderr, frame count and trailing bytes remain in the log. Frame heuristics and experiment interpretation are in [M2 findings](../findings/m2.md). Stopping ffmpeg sends SIGTERM and escalates to SIGKILL after two seconds. Session SIGINT/SIGTERM handlers cancel waits and prevent new transfers, wait for an in-flight transfer to settle within its existing timeout, stop ffmpeg, attempt driver reattachment and close the USB handle. Cleanup still attempts USB restoration if stopping video fails. Handlers are removed in an outer `finally`; an `interrupted` event records the signal and the process exits with 130 (SIGINT) or 143 (SIGTERM). Uncatchable SIGKILL cannot run cleanup. Statistics are streamed, not retained in memory; this probe does not save images.

`src/usb-protocol.test.ts` tests ordered packets, endian boundaries, short replies, camera errors, invalid parameters, state error preservation and frame-half separation. `src/usb-video.test.ts` covers passthrough arguments and a live process that emits one frame then stalls. `src/usb-command.test.ts` covers both cancellation signals after detach, listener removal, exit codes and stopping video during startup. Hardware permissions, ffmpeg USB coexistence, IOKit request execution and setting effects remain owner tests.

`src/usb-runtime.test.ts` imports the installed USB package without enumerating or opening hardware and checks both the legacy enumeration and WebUSB exports. Cancellation mocks use numeric OUT callback results, matching the native library.

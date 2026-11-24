# Invariants

Numbered domain rules, each enforced by the tests listed under it. Cite a rule by number ("invariant 4"). A number is never reused; a rule that stops holding is struck through with the reason. How to add one: [documentation guide](guides/documentation.md#invariants).

Invariants 1 to 14 belong to the documentation contract, 15 to 17 to the architecture of the TypeScript packages, 18 to the camera registry, 19 to the YUYV decoder, 20 and 21 to the capture tool, 22 to 25 to the `.irvis` format, 26 to 28 to the corrections, 29 and 30 to the analysis, 31 to 33 to USB capture, 34 and 35 to planar reconstruction, and 36 to the browser backend.

- **1.** A changed path that a rule owns fails the check unless some changed path matches that rule's documentation regex.
  - `tools/docs-check/test/rules.test.ts::rules::owned path without doc fails`
  - `tools/docs-check/test/rules.test.ts::rules::owned path with doc passes`
- **2.** Commits since the merge base, staged changes, unstaged changes and untracked files all count, on both the source and the documentation side.
  - `tools/docs-check/test/rules.test.ts::rules::untracked source counts`
  - `tools/docs-check/test/rules.test.ts::rules::untracked doc counts`
  - `tools/docs-check/test/rules.test.ts::rules::staged doc counts`
  - `tools/docs-check/test/rules.test.ts::rules::unstaged doc counts`
  - `tools/docs-check/test/rules.test.ts::rules::staged source counts`
  - `tools/docs-check/test/rules.test.ts::rules::unstaged source counts`
- **3.** Deleting or moving an owned file needs the same documentation as editing it.
  - `tools/docs-check/test/rules.test.ts::rules::deletion needs doc`
  - `tools/docs-check/test/rules.test.ts::rules::rename needs doc`
- **4.** Changes to the paths in `EXCLUDE` (test files, documentation, agent tooling and the rest) never need documentation.
  - `tools/docs-check/test/rules.test.ts::rules::tests only change passes`
  - `tools/docs-check/test/rules.test.ts::rules::every exclusion needs no doc`
  - `tools/docs-check/test/rules.test.ts::carve-outs::pr template needs no doc`
  - `tools/docs-check/test/rules.test.ts::carve-outs::agent tooling needs no doc`
- **5.** A file whose diff changes only versions needs no documentation; any other change in the same file does, and a filter that raises fails the check.
  - `tools/docs-check/test/bumps.test.ts::version-bump filter::bump only passes`
  - `tools/docs-check/test/bumps.test.ts::version-bump filter::bump with other change fails`
  - `tools/docs-check/test/bumps.test.ts::version-bump filter::changed action name is not a bump`
  - `tools/docs-check/test/bumps.test.ts::version-bump filter::moved uses line is not a bump`
  - `tools/docs-check/test/bumps.test.ts::version-bump filter::crashing filter fails`
- **6.** A path that no other rule owns needs a feature document that is new since the merge base; an edited document, or one git detects as a rename, does not count. Deleting such a path needs nothing.
  - `tools/docs-check/test/rules.test.ts::catch-all::unowned path needs new feature doc`
  - `tools/docs-check/test/rules.test.ts::catch-all::new feature doc satisfies catch all`
  - `tools/docs-check/test/rules.test.ts::catch-all::moved doc is not new`
  - `tools/docs-check/test/rules.test.ts::catch-all::new script is caught`
  - `tools/docs-check/test/rules.test.ts::catch-all::deleting unowned path needs no new doc`
- **7.** The base is `--base`, else `origin/main`, else `main`; without one, or without a merge base, the check exits 2 and never compares with another branch.
  - `tools/docs-check/test/rules.test.ts::base branch::no base exits 2`
  - `tools/docs-check/test/rules.test.ts::base branch::no merge base exits 2`
  - `tools/docs-check/test/rules.test.ts::base branch::missing base ref exits 2`
  - `tools/docs-check/test/rules.test.ts::base branch::base option`
  - `tools/docs-check/test/rules.test.ts::base branch::origin main before main`
- **8.** `SKIP_DOCS_CHECK=1` skips the check only when `CI` is unset.
  - `tools/docs-check/test/rules.test.ts::skip::skip works locally`
  - `tools/docs-check/test/rules.test.ts::skip::skip ignored in ci`
- **9.** The ownership-map and exclusions tables in `docs/features/README.md` equal `RULES` and `EXCLUDE`.
  - `tools/docs-check/test/integrity.test.ts::integrity::map row differs fails`
  - `tools/docs-check/test/integrity.test.ts::integrity::map row missing fails`
  - `tools/docs-check/test/integrity.test.ts::integrity::map row extra fails`
  - `tools/docs-check/test/integrity.test.ts::integrity::exclusion differs fails`
- **10.** `docs/decisions/README.md` equals the output of `tools/docs-check/src/decisions-index.ts`.
  - `tools/docs-check/test/integrity.test.ts::integrity::stale decisions index fails`
  - `tools/docs-check/test/decisions-index.test.ts::decisions index::stale index fails check`
- **11.** This repository passes its own integrity checks.
  - `tools/docs-check/test/integrity.test.ts::this repository::integrity of this repository`
- **12.** ~~Every test id in this file names an existing test, with the method in the named class.~~ Retired in #30: there are no Python tests. That a test id names an existing Vitest test is invariant 14.
- **13.** A `package.json` change that only changes version ranges (strings without `:` or `/`) of existing keys in `dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies` needs no documentation; a change to `engines`, `packageManager` or any other field, an added, removed or moved dependency, a change of a dependency's source (`npm:`, `file:`, `workspace:`, `github:`, `user/repo`), and a file that does not parse do.
  - `tools/docs-check/test/bumps.test.ts::package.json bumps::dependency bump passes`
  - `tools/docs-check/test/bumps.test.ts::package.json bumps::reformatted bump in a package passes`
  - `tools/docs-check/test/bumps.test.ts::package.json bumps::engines change fails`
  - `tools/docs-check/test/bumps.test.ts::package.json bumps::package manager change fails`
  - `tools/docs-check/test/bumps.test.ts::package.json bumps::bump with engines change fails`
  - `tools/docs-check/test/bumps.test.ts::package.json bumps::added dependency fails`
  - `tools/docs-check/test/bumps.test.ts::package.json bumps::removed dependency fails`
  - `tools/docs-check/test/bumps.test.ts::package.json bumps::alias change fails`
  - `tools/docs-check/test/bumps.test.ts::package.json bumps::dependency moved to another field fails`
  - `tools/docs-check/test/bumps.test.ts::package.json bumps::invalid json is not a bump`
- **14.** A test id names `describe` literals and then an `it` or `test` literal, each a plain string literal whose value, with escapes resolved, equals the name exactly, that appear in the file in that order.
  - `tools/docs-check/test/integrity.test.ts::Vitest ids::vitest id passes`
  - `tools/docs-check/test/integrity.test.ts::Vitest ids::vitest id with missing name fails`
  - `tools/docs-check/test/integrity.test.ts::Vitest ids::vitest id with missing describe fails`
  - `tools/docs-check/test/integrity.test.ts::Vitest ids::vitest id out of order fails`
  - `tools/docs-check/test/integrity.test.ts::Vitest ids::vitest id needs a plain literal`
  - `tools/docs-check/test/integrity.test.ts::integrity::invariant with missing test fails`
- **15.** Dependencies between workspaces point one way: every workspace in `packages/`, `apps/` and `tools/` is listed with the irvis packages it may depend on, and depends on no other; core depends on nothing outside irvis but `fflate`; only `apps/desktop` depends on `electron`.
  - `packages/core/test/package-dependencies.test.ts::package dependencies::lists every workspace in the dependency table`
  - `packages/core/test/package-dependencies.test.ts::package dependencies::point only from apps towards core`
  - `packages/core/test/package-dependencies.test.ts::package dependencies::keep core free of packages other than fflate`
  - `packages/core/test/package-dependencies.test.ts::package dependencies::keep electron in apps/desktop`
- **16.** ESLint lets code in `packages/core/src/` import only relative paths and `fflate` (tests next to the code also `vitest`), so Node modules, `@irvis/ui`, `@irvis/media`, `@irvis/backend-*` and packages hoisted from other workspaces are rejected; from `fflate` only the synchronous functions, and never as a namespace; no dynamic `import()`.
  - `packages/core/test/eslint-rules.test.ts::core imports::rejects Node modules`
  - `packages/core/test/eslint-rules.test.ts::core imports::rejects the UI, media and backend packages`
  - `packages/core/test/eslint-rules.test.ts::core imports::rejects packages that core does not declare`
  - `packages/core/test/eslint-rules.test.ts::core imports::rejects dynamic import()`
  - `packages/core/test/eslint-rules.test.ts::core imports::allows vitest only in tests next to the code`
  - `packages/core/test/eslint-rules.test.ts::core imports::allows only the synchronous fflate functions`
- **17.** ESLint allows, in `packages/core/src/{analysis,corrections,cameras,irvis,reconstruction}/`, only the listed `Math` members, reached as `Math.<name>`, and no `**`. An exception to any lint rule in `packages/core/src/` is a disable comment that names its rules and a decision; a comment without them, and inline ESLint configuration, fail the tests.
  - `packages/core/test/eslint-rules.test.ts::Math allow-list::allows correctly rounded functions in measurement code`
  - `packages/core/test/eslint-rules.test.ts::Math allow-list::rejects approximated functions and indirect access`
  - `packages/core/test/eslint-directives.test.ts::eslint directives in core::name their rules and a decision in every file of packages/core/src`
  - `packages/core/test/eslint-directives.test.ts::eslint directives in core::rejects a disable comment without rules`
  - `packages/core/test/eslint-directives.test.ts::eslint directives in core::rejects a disable comment without a decision`
  - `packages/core/test/eslint-directives.test.ts::eslint directives in core::rejects inline configuration`
- **18.** Every profile in the camera registry passes `validateProfile`, and no two share an id.
  - `packages/core/src/cameras/index.test.ts::camera registry::holds only valid profiles`
  - `packages/core/src/cameras/index.test.ts::camera registry::has unique profile ids`
- **19.** The thermal rows of a YUYV frame decode as one little-endian 16-bit value per pixel (raw = lo | hi << 8), only from the given rows, wherever the frame's bytes lie in their buffer; rows outside the frame and frames of the wrong size are rejected.
  - `packages/core/src/yuyv.test.ts::decodeYuyvRaw::reads lo and hi bytes`
  - `packages/core/src/yuyv.test.ts::decodeYuyvRaw::reads only the given rows`
  - `packages/core/src/yuyv.test.ts::decodeYuyvRaw::reads a frame that is a view into a larger buffer`
  - `packages/core/src/yuyv.test.ts::decodeYuyvRaw::rejects rows outside the frame`
  - `packages/core/src/yuyv.test.ts::checkYuyvFrame::rejects a frame with the wrong byte count`
- **20.** The capture tool never lets ffmpeg convert pixels: it asks AVFoundation for `yuyv422` and packs the input pixel format with `-c:v rawvideo -pix_fmt +`, disabling automatic pixel conversion. Frame timing passes through, and the packet list remains a stream copy of the original input. The M2 video observer also passes timestamps through without synthesizing duplicate frames.
  - `tools/capture-cli/src/ffmpeg.test.ts::captureArgs::packs pixels without conversion and lists original packets`
  - `tools/capture-cli/src/usb-video.test.ts::USB video observation::preserves timestamp gaps and rejects a live process that stops producing frames`
- **21.** When AVFoundation delivered another pixel format than `yuyv422` for a capture with temperature data, the session report does not answer whether the 384 mode needs a command, and says which format arrived. A packet-size mismatch also gives an unknown answer rather than implying a USB command is needed.
  - `tools/capture-cli/test/report.test.ts::report::does not answer the 384 question when AVFoundation changed the format`
  - `tools/capture-cli/test/report.test.ts::report::flags packets of the wrong size`
- **22.** Every raw value a `.irvis` reader decodes is within the file's threshold T of the value that was written, in every frame and through temperature jumps, dead pixels at 0 and 65535 and a NUC, also when the sink failed during writing or the caller changed an array it got back; at T = 0 the values are equal.
  - `packages/core/src/irvis/codec.test.ts::frame codec::is lossless at tolerance 0`
  - `packages/core/src/irvis/codec.test.ts::frame codec::keeps every value within the tolerance`
  - `packages/core/src/irvis/codec.test.ts::frame codec::keeps the guarantee through temperature jumps, dead pixels and a NUC`
  - `packages/core/src/irvis/irvis.test.ts::irvis round trip::reads back every frame within the threshold, with its metadata`
  - `packages/core/src/irvis/irvis.test.ts::irvis round trip::is lossless at threshold 0`
  - `packages/core/src/irvis/codec.test.ts::frame codec::returns arrays that the encoder and decoder do not use again`
  - `packages/core/src/irvis/irvis.test.ts::irvis writer failures::refuses every call after the sink fails, and the file keeps its guarantee`
  - `packages/core/src/irvis/irvis.test.ts::irvis writer failures::does not let a change to a returned array reach the next frame`
  - `packages/core/src/irvis/irvis.test.ts::irvis writer failures::rejects encoder settings and intervals that would break the guarantee`
- **23.** A `.irvis` writer starts a chunk, whose first frame is a keyframe, at the first frame, when the gain, the camera state or the conversion changes, after a NUC that the data show, and after the keyframe interval; every frame is read back with its chunk's conversion and camera state, and a frame whose conversion or camera state JSON cannot hold is rejected instead of written.
  - `packages/core/src/irvis/irvis.test.ts::irvis round trip::starts a chunk at the start, every interval, after a gain, camera-state or conversion change and after a NUC`
  - `packages/core/src/irvis/irvis.test.ts::irvis writer input::rejects a conversion or camera state that JSON cannot hold, and stays usable`
- **24.** A `.irvis` file cut at any byte, or without its index, is read up to its last valid record with the same frames as the complete file; a damaged record stops reading there and loses nothing before it.
  - `packages/core/src/irvis/irvis.test.ts::irvis recovery::reads a file cut at any byte up to its last valid record`
  - `packages/core/src/irvis/irvis.test.ts::irvis recovery::rebuilds the frame table that the index holds`
  - `packages/core/src/irvis/irvis.test.ts::irvis recovery::stops at a damaged record`
  - `packages/core/src/irvis/irvis.test.ts::irvis recovery::stops at a chunk record that another chunk record follows`
- **25.** Re-encoding a `.irvis` file to a threshold T2 keeps every value within T2 of the measured one and records the earlier threshold; a threshold below the file's is refused; with an intact index, a damaged frame costs only the rest of its chunk.
  - `packages/core/src/irvis/irvis.test.ts::reencodeIrvis::keeps every value within the new threshold of the measured one`
  - `packages/core/src/irvis/irvis.test.ts::reencodeIrvis::refuses a smaller threshold`
  - `packages/core/src/irvis/irvis.test.ts::reencodeIrvis::skips the rest of a damaged chunk when the index is intact`
- **26.** The emissivity correction never applies the camera's own correction twice: settings equal to the emissivity and reflected temperature in a frame's camera state return every reading with the same bits, other settings give what they give on the reading without the camera's correction, and the default settings change no reading of a camera that applies no correction itself.
  - `packages/core/src/corrections/emissivity.test.ts::temperatureCorrection::returns the reading unchanged with the default settings`
  - `packages/core/src/corrections/emissivity.test.ts::camera correction::changes nothing when the settings equal what the camera applied`
  - `packages/core/src/corrections/emissivity.test.ts::camera correction::never applies emissivity twice`
  - `packages/core/src/corrections/emissivity.test.ts::correctFrame::leaves the readings of a camera that applied the same settings unchanged`
- **27.** Uncertain pixels and pixels without a temperature (NaN or ±Infinity) never turn a threshold alarm on and are never painted by an isotherm.
  - `packages/core/src/corrections/alarms.test.ts::evaluateAlarms::never turns on for uncertain pixels or pixels without a temperature`
  - `packages/core/src/corrections/isotherms.test.ts::isotherms::never mark uncertain pixels or pixels without a temperature`
- **28.** A camera profile uses the state field ids `emissivity` and `reflected-temperature` only together, as number fields that affect the raw data, with unit `''` and `°C` and defaults in range.
  - `packages/core/src/cameras/validate.test.ts::validateProfile::accepts the emissivity fields of a camera that applies emissivity itself`
  - `packages/core/src/cameras/validate.test.ts::validateProfile::rejects emissivity fields that the correction cannot read`
- **29.** Uncertain pixels and pixels without a temperature (NaN or ±Infinity) count in no measurement: they are never the min or the max, are left out of the mean of a frame, point, line and area and out of the histogram bins, and do not widen the automatic palette range.
  - `packages/core/src/analysis/measurements.test.ts::measureFrame::skips uncertain pixels and pixels without a temperature`
  - `packages/core/src/analysis/measurements.test.ts::measurePoint::skips uncertain pixels and pixels without a temperature`
  - `packages/core/src/analysis/measurements.test.ts::measureLine::marks uncertain samples and leaves them out of its statistics`
  - `packages/core/src/analysis/measurements.test.ts::measureArea::skips uncertain pixels and pixels without a temperature`
  - `packages/core/src/analysis/measurements.test.ts::histogram::counts readings outside the range apart and skips uncertain ones`
  - `packages/core/src/analysis/render.test.ts::autoRange::spans the counted pixels only`
- **30.** A palette range maps its bottom reading to entry 0, its top reading to entry 255 and finite readings outside it to the nearer end, a reading that is not finite to no entry; the six palette tables are built with the same bytes every time.
  - `packages/core/src/analysis/render.test.ts::paletteIndex::maps the range onto 256 entries and clamps outside it`
  - `packages/core/src/analysis/palettes.test.ts::palettes::are built with the same bytes every time`

- **31.** P2 Pro gain selection sends the command and continuation in order, with the selector and value big-endian, before checking completion. TPD reads decode the two-byte reply big-endian and reject short replies.
  - `tools/capture-cli/src/usb-protocol.test.ts::USB protocol::encodes gain as two ordered vendor transfers before polling completion`
  - `tools/capture-cli/src/usb-protocol.test.ts::USB protocol::reads TPD with big endian selector, length and response`
  - `tools/capture-cli/src/usb-protocol.test.ts::USB protocol::rejects malformed responses and camera status errors`

- **32.** USB diagnostics must allow restoring the T7's observed raw emissivity value 128 without assuming a temperature-correction ratio.
  - `tools/capture-cli/src/usb-protocol.test.ts::USB protocol::can restore the raw emissivity value 128 observed on the T7`

- **33.** USB descriptor probing authorizes requested IDs before WebUSB filters discovery results; an empty ID list includes all discovered devices. Devices outside a nonempty ID list are not opened.
  - `tools/capture-cli/src/usb-runtime.test.ts::authorizes the requested camera before WebUSB filtering and reads its descriptors`
  - `tools/capture-cli/src/usb-runtime.test.ts::authorizes all devices for an empty probe ID list`

- **34.** Planar reconstruction preserves the observed low bytes and rounded chroma model, and I420 and padded NV12 inputs give identical results.
  - `packages/core/test/reconstruction.test.ts::planar reconstruction::pins synthetic regression quality and preserves the observation model`
  - `packages/core/test/reconstruction.test.ts::planar reconstruction::gives identical I420 and padded NV12 results`
- **35.** Registered monotonic brightness can enable the planar hint; deterministic garbage upper halves disable it. The simple synthetic scenes without an edge inside a row pair reconstruct exactly even without a hint.
  - `packages/core/test/reconstruction.test.ts::planar reconstruction::disables garbage hints and enables registered monotonic hints`
  - `packages/core/test/reconstruction.test.ts::planar reconstruction::recovers scenes without edges inside row pairs exactly`

- **36.** Browser diagnostics request exact profile dimensions and exact `resizeMode: none`, reject mismatched dimensions and RGB frames before copying, and copy the full coded rectangle without requesting format conversion, retaining layout and converting timestamps to milliseconds.
  - `packages/backend-browser/test/frame.test.ts::browser capture::requests profile dimensions without resizing and the selected device`
  - `packages/backend-browser/test/frame.test.ts::browser capture::rejects mismatched dimensions and RGB frames before copying bytes`
  - `packages/backend-browser/test/frame.test.ts::browser capture::copies the full coded rectangle without requesting format conversion`

- **37.** Desktop simulation compares only profile thermal rows; unsynchronized live pairs never claim bit-exact or flat-region match metrics.
  - `apps/web/src/Comparison.test.tsx::desktop comparison::compares only thermal rows against the exact reference`
  - `apps/web/src/Comparison.test.tsx::desktop comparison::does not claim bit-exact metrics for unsynchronized live frames`

- **38.** Photo snapshots are lossless by default and preserve frame metadata and uncertainty even if the source reuses its raw buffer.
  - `packages/core/src/export/export.test.ts::photo export::round trips a lossless snapshot with metadata and captures reused buffers`
- **39.** PNG photo pixels match the selected palette and corrections, and the embedded frame reopens through the ordinary thermal reader.
  - `packages/core/src/export/export.test.ts::photo export::writes a standard RGBA PNG and opens its embedded frame through IrvisReader`
- **40.** Temperature CSV preserves row-major coordinates, unrounded Celsius readings and uncertainty; non-finite readings are empty.
  - `packages/core/src/export/export.test.ts::photo export::exports row-major Celsius without rounding and marks uncertain or missing readings`

- **41.** Real packed P2 Pro fixtures retain their captured bytes and decode the thermal half as little-endian raw values; the frozen v1 file remains lossless, and every newly encoded real pixel stays within T.
  - `packages/core/test/real-frames.test.ts::real camera frames::preserves packed capture bytes and thermal decoding`
  - `packages/core/test/real-frames.test.ts::real camera frames::reads the frozen v1 recording exactly in reverse order`
  - `packages/core/test/real-frames.test.ts::real camera frames::bounds every real pixel through lossless and lossy recording`
- **42.** The P2 Pro high-gain recording suggestion rounds twice the measured scene noise upward to whole raw units; profile recording thresholds fit the codec's integer range 0–32767.
  - `packages/core/src/cameras/infiray-p2pro/profile.test.ts::infiray-p2pro profile::derives the recording threshold from twice the measured scene noise`
  - `packages/core/src/cameras/validate.test.ts::validateProfile::rejects recording thresholds outside the codec range`

- **43.** Viewer manual colour bounds must be finite and ordered; invalid edits cannot be applied.
  - `packages/ui/test/viewer.test.tsx::Viewer::offers six palettes and rejects reversed manual bounds`
- **44.** Scale lock holds colour bounds across scene changes, and uncertain pixels do not determine automatic bounds.
  - `packages/ui/test/render.test.ts::FrameRenderer::holds locked bounds across changing scenes and marks uncertain pixels`

- **45.** Closing an obsolete Electron capture session cannot stop a newer session, including across adapter instances.
  - `apps/web/src/viewer-session.test.tsx::viewer sessions::keeps the newer Electron capture running after Start Stop Start with a delayed open`
  - `apps/web/src/viewer-backend.test.ts::viewer backend::isolates capture ownership across adapter instances and drops obsolete errors`
- **46.** Retrying capture clears the old error and ignores later errors from closed browser sessions.
  - `apps/web/src/viewer-session.test.tsx::viewer sessions::clears capture errors on retry and ignores errors from the closed browser session`

- **47.** After Stop, display settings redraw the retained frame without restarting capture.
  - `packages/ui/test/viewer.test.tsx::Viewer::redraws the retained frame when settings change after Stop`

- **48.** Pending capture errors belong to the mounted source and profile; changing either isolates the new view from old errors without suppressing current errors.
  - `apps/web/src/viewer-session.test.tsx::viewer sessions::ignores pending capture errors after switching to Demo and back before starting again`
  - `apps/web/src/viewer-session.test.tsx::viewer sessions::isolates pending errors when the camera profile changes and still reports current errors`

- **49.** Clearing measurement objects preserves independent global tracking; at least three points, lines and areas can coexist.
  - `packages/ui/test/viewer.test.tsx::measurement controls::keeps three of each object, edits and deletes objects, and preserves tracking on clear`
- **50.** An uncertain point or centre pixel has no measurement marker; local extrema skip uncertain pixels.
  - `packages/ui/test/measurements.test.ts::viewer measurements::excludes uncertain markers and reports local extrema for multiple objects`
- **51.** Disabling a triggered viewer alarm stops its oscillator immediately and prevents stale trigger updates from restarting sound.
  - `packages/ui/test/viewer.test.tsx::measurement controls::silences a triggered alarm immediately when disabled`


- **52.** A rejected photo import leaves the current live alarm operational.
  - `packages/ui/test/alarm-lifecycle.test.tsx::alarm lifecycle::keeps live alarms working after a rejected photo import`
- **53.** Alarm triggers and hysteresis belong to the frame source; retained or obsolete frames cannot trigger a new session before its first frame.
  - `packages/ui/test/alarm-lifecycle.test.tsx::alarm lifecycle::waits for a new session frame and ignores retained frames and obsolete emissions`
  - `packages/ui/test/render.test.ts::FrameRenderer::resets alarm hysteresis when the frame source changes`
- **54.** Stop disables a photo alarm while retaining editable measurements; resuming it requires explicit re-enabling.
  - `packages/ui/test/alarm-lifecycle.test.tsx::alarm lifecycle::stops photo audio and requires explicit re-enabling while keeping the photo editable`


- **55.** Camera capture errors cannot affect photo status or audio, but errors rendering the current photo still silence its alarm; returning to capture restores camera error handling.
  - `packages/ui/test/alarm-lifecycle.test.tsx::alarm lifecycle::scopes capture errors to the camera across photo analysis and return to live capture`
  - `packages/ui/test/alarm-lifecycle.test.tsx::alarm lifecycle::still reports photo rendering errors and silences photo audio`


- **56.** Captured overlay pixels and lossless thermal values are copied before asynchronous photo export can observe reused buffers.
  - `packages/core/src/export/export.test.ts::photo export::preserves supplied overlay pixels and independent lossless temperatures`
- **57.** Captured raw values and uncertainty follow the displayed mirrors and rotation.
  - `packages/ui/test/photos.test.ts::photo geometry::transforms thermal pixels and uncertainty with displayed mirrors and rotation`
- **58.** Gallery analysis starts with fresh editable measurements and leaves original photo bytes unchanged; deletion does not erase active analysis.
  - `packages/ui/test/photo-workflow.test.tsx::photo workflow::captures into the gallery and opens fresh measurements while preserving original bytes`
- **59.** Failed photo saves do not claim success, and failed deletions keep gallery entries visible.
  - `packages/ui/test/photo-workflow.test.tsx::photo workflow::reports failed saves without claiming success and leaves failed deletions visible`

- **60.** A recording player seeks relative to the first frame timestamp, restores accumulated view state, and suppresses obsolete asynchronous deliveries.
  - `packages/backend-replay/test/player.test.ts::recording player::seeks relative to the first timestamp and restores accumulated view state`
  - `packages/backend-replay/test/player.test.ts::recording player::suppresses obsolete seeks and all deliveries after close`
- **61.** A recorder bounds pending thermal work, copies accepted frame values, and never reports successful finalization after a storage write fails.
  - `packages/media/test/recorder.test.ts::recorder::bounds pending work and preserves lossless frame values and timestamps`
  - `packages/media/test/recorder.test.ts::recorder::reports write failure and rejects finalization while closing storage`

- **62.** Playback correction comes from the opened recording, follows recorded changes until an explicit host correction edit, and is isolated from previously opened sources.
  - `packages/ui/test/playback-correction.test.tsx::playback correction::restores each recording independently and resets manual overrides on reopen`
  - `packages/ui/test/playback-correction.test.tsx::playback correction::follows recorded changes and seeks until an explicit correction edit, ignoring obsolete players`

- **63.** Recorded correction changes preserve measurement identities and their monotonic ID counter, so editing or deleting a selected object leaves other measurements intact.
  - `packages/ui/test/playback-correction.test.tsx::playback correction::preserves measurement identities and independent edits across recorded correction changes`

- **64.** A recorder flushes each accepted frame before releasing backpressure; losing every unflushed byte preserves the preceding complete frames. A one-second stalled operation stops further submissions and cannot report successful finalization.
  - `packages/media/test/recorder.test.ts::recorder::recovers the last durable frame when a crash discards the next unflushed write`
  - `packages/media/test/recorder.test.ts::recorder::stops accepting frames after one second of stalled storage`
- **65.** Audio packets align to thermal timestamps with pre-roll trimmed and gaps/end padded; incomplete or corrupt final packets do not invalidate earlier audio.
  - `packages/media/test/audio-sidecar.test.ts::audio sidecar::aligns samples to the thermal clock, trimming pre-roll and padding gaps and the end`
  - `packages/media/test/audio-sidecar.test.ts::audio sidecar::recovers all complete packets at every torn-write boundary and rejects corrupt tails`

- **66.** Desktop USB control rejects ambiguous device matches and only dispatches commands from the selected profile.
  - `apps/desktop/test/capture.test.js::desktop capture::refuses ambiguous USB selection`
  - `apps/desktop/test/capture.test.js::desktop capture::reads state, allow-lists commands and refreshes per-frame sensor bytes`

- **67.** A camera-reported gain without a verified conversion disables readings even when the host assumes high gain.
  - `packages/ui/test/render.test.ts::FrameRenderer::refuses a camera-reported gain without a conversion despite the host assumption`

- **68.** Failed or invalid camera gain readback blocks conversion instead of restoring the host's high-gain assumption; a subsequent valid state read restores the known gain.
  - `apps/desktop/test/capture.test.js::desktop capture::blocks gain conversion after failed readback and recovers only on a valid read`
  - `packages/ui/test/render.test.ts::FrameRenderer::blocks missing or unknown camera gain without falling back to high`
- **69.** ~~Refreshing the camera list preserves an existing selection, otherwise selects the first available camera, or clears it when no cameras remain.~~ Retired: the camera list moved from the viewer's Camera setup to the app's Source select, which never picks a camera on its own; see invariant 81.

- **70.** The recorded exact path preserves every raw value and reading between Node, Chromium, WebKit and Electron; the shared viewer displays the same min/max/centre readings in C, F and K.
  - `packages/ui/test/parity/parity.integration.mjs::preserves exact recorded readings and viewer wiring across runtimes`

- **71.** Desktop commands cannot overlap, and gain commands resolve only after matching readback; thrown readback cannot retain the old gain.
  - `apps/desktop/test/capture.test.js::desktop capture::rejects overlapping commands and confirms gain readback`
  - `apps/desktop/test/capture.test.js::desktop capture::discards stale gain when command readback throws`

- **72.** Browser camera controls cannot dispatch commands, even if given a dispatcher.
  - `packages/ui/test/camera-controls.test.tsx::CameraControls::disables commands in the browser even with a dispatcher`

- **73.** A command-generation change starts a recording keyframe even when the gain before and after the omitted frames is identical.
  - `packages/core/src/irvis/irvis.test.ts::irvis round trip::starts a keyframe after commands even when the recorded gain is unchanged`

- **74.** Camera command feedback belongs to one connection: Stop/Start clears it, and an old command's completion cannot change the new connection's status or pending state.
  - `packages/ui/test/viewer.test.tsx::Viewer::clears camera command confirmation on Stop and Start`
  - `packages/ui/test/viewer.test.tsx::Viewer::ignores an old command failure while a new session waits for confirmation`

- **75.** Numeric camera settings are bounded and encoded by the selected profile; invalid values cannot cause USB transfers and success requires matching raw readback.
  - `apps/desktop/test/capture.test.js::desktop capture::encodes bounded camera settings and confirms their raw readback`
  - `apps/desktop/test/capture.test.js::desktop capture::rejects missing nonfinite and out of range settings before USB access`
  - `packages/core/src/cameras/infiray-p2pro/profile.test.ts::infiray-p2pro profile::rejects unsafe numeric command encodings`

- **76.** A host emissivity edit on exact live frames is relative to the camera's applied correction, matching replay instead of correcting twice.
  - `packages/ui/test/render.test.ts::FrameRenderer::uses camera emissivity for relative correction of live exact frames`

- **77.** A camera correction reset confirms writes sequentially, clears host correction only after full success, and sends no remaining writes after the session panel unmounts.
  - `packages/ui/test/camera-controls.test.tsx::CameraControls::confirms each reset write before clearing host correction`
  - `packages/ui/test/camera-controls.test.tsx::CameraControls::stops a partial reset on failure and keeps host correction`
  - `packages/ui/test/camera-controls.test.tsx::CameraControls::does not continue a reset after its camera session ends`

- **78.** Temperature limits mark readings uncertain before host correction while retaining exact raw bytes and the mask in replay; excluded readings cannot trigger alarms.
  - `packages/ui/test/render.test.ts::FrameRenderer::retains exact raw bytes but excludes out-of-range readings in live and replay`
  - `packages/core/src/cameras/infiray-p2pro/profile.test.ts::infiray-p2pro profile::rejects invalid reading limits without changing the conversion`

- **79.** Automatic sensor range waits for settling and consecutive threshold crossings, shares command confirmation locking, and stops automatic requests after failure.
  - `packages/ui/test/sensor-range.test.ts::SensorRangePolicy::requires settling and consecutive threshold crossings in both directions`
  - `packages/ui/test/sensor-range.test.ts::SensorRangePolicy::rejects isolated peaks, boundary readings and unknown state`
  - `packages/ui/test/camera-controls.test.tsx::CameraControls::waits for automatic gain confirmation and exits Auto on failure`
  - `packages/ui/test/camera-controls.test.tsx::CameraControls::disables Auto for a video mode without temperature data`

- **80.** An unknown camera emissivity or reflected temperature blocks only Host correction: camera readings, photos and recording frames remain, and the viewer warns. While gain, emissivity or reflected temperature is unknown, the desktop poll repeats the full state read with a backoff from 1 s to 30 s and reads sensor bytes in between.
  - `packages/ui/test/render.test.ts::FrameRenderer::keeps camera readings and recording when the camera correction is unknown`
  - `apps/desktop/test/capture.test.js::desktop capture::repeats the full state read while gain, emissivity or reflected temperature is unknown`
  - `apps/desktop/test/capture.test.js::desktop capture::backs off repeated full state reads to 30 seconds and polls sensor bytes between them`

- **81.** The Source select offers Demo and every listed camera; a refresh keeps the selected camera, and a selected camera missing from the list stays selected as disconnected with Start disabled.
  - `apps/web/src/App.test.tsx::App::offers Demo and every connected camera as the source, and only thermal video modes`
  - `apps/web/src/App.test.tsx::App::keeps a camera that disappears on refresh selected as disconnected and disables Start`

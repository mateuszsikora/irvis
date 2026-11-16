# Roadmap

For anyone, person or agent, who picks up work on irvis: what is planned, in which order, with which acceptance criteria, and what the owner does. Read it before starting a milestone pull request. Each work item is a GitHub issue in a milestone, M0 to M6.

This document is a plan. It is an exception to "write what is true now" in the [documentation guide](guides/documentation.md#style): it says what is planned, and other documents never cite it for what the code does ([decision](decisions/docs.md#plans-and-spike-reports-live-in-docs-as-marked-exceptions)). A document that does not exist yet is named without the `docs/` prefix and marked "(planned, M<n>)"; the pull request that creates it turns the mention into a link. Why the architecture is shaped as it is: [architecture decisions](decisions/architecture.md).

Plan changes go through pull requests to this file. The owner's specification (12 Nov 2026) is not in the repository; this document carries its requirements and says where the plan departs from it.

## Goal

irvis is an open-source viewer for USB-C thermal cameras:

- a desktop app in Electron for macOS, Windows and Linux;
- an experimental web version in Chrome, Edge and Safari;
- one TypeScript core without DOM and Node APIs, and one UI build, shared by both;
- feature parity with the vendor's Android app as the target. Hardware features (USB commands to the camera) exist only in the desktop app; the web version shows them greyed out with "available in the desktop app";
- cameras supported through camera profiles, so that a new model (for example TOPDON TC001) is added without touching the UI, the backends or the recording format;
- MIT licence; the repository is private now and public later.

The first camera is the TOOLTOP T7, a rebrand of the InfiRay P2 Pro.

## Features

The target is parity with the vendor's Android app. The original T7-manual list is supplemented by the owner-accepted [Android feature catalogue](findings/android-app.md) from [#11](https://github.com/mateuszsikora/irvis/issues/11).

The [Android functional audit](findings/android-app.md) records tests on the owner-confirmed TOOLTOP T7 and maps the observed controls to M4/M5 issues. It adds evidence for kelvins, region highlighting, measurement editing/reset and limits, saved-photo analysis and annotations, optional recording audio, and gallery management. Thermal-parameter validation and range switching were exercised, but their host/camera boundary still needs protocol evidence. The circular arrow resets measurement objects; it does not establish a manual NUC control. The accepted targets are handed off to #17, #18, #19 and #22; unresolved command semantics remain implementation work in #22, not an inventory blocker.

| Feature | Kind | Browser | Desktop |
| --- | --- | --- | --- |
| Live view, scaling, smoothing, rotation, mirroring | software | yes | yes |
| Palettes: Iron, White Hot, Black Hot, Rainbow, Red Hot, Cold Blue | software | yes | yes |
| Automatic or manual palette range, scale lock, scale bar | software | yes | yes |
| Min, max and centre tracking with markers | software | yes | yes |
| Measurement: point, line, area (three of each in the vendor app), editing, deletion and reset | software | yes | yes |
| Emissivity, temperature correction, °C, °F and K | software, unless the camera computes it | yes | yes |
| Threshold alarms, isotherms, region highlighting | software | yes | yes |
| Photo (PNG with temperature data), recording (`.irvis` with MP4 export) | software | yes | yes |
| Saved-photo measurements, annotations and gallery management | software | yes | yes |
| Optional audio for video recording (#19) | software | yes | yes |
| Ambient and reflected temperature inputs (camera-side contribution unresolved) | software inputs; verify camera commands in #22 | host correction only | host correction and verified commands |
| Shutter calibration (NUC) on demand | hardware | greyed out | yes |
| High or low gain range | hardware | greyed out | yes |
| Settings stored in the camera | hardware | greyed out | yes |
| Diagnostics and comparison mode | developer | diagnostics | full |

UI rules:

- Hardware features are visible in the browser but greyed out, with "available in the desktop app" and a download link.
- When the reconstruction reports uncertain pixels, the UI can mark them (optional overlay) and puts no min or max marker on them.
- The UI uses simple English only. Translation catalogues, language selection and a Polish skeleton are out of scope ([decision](decisions/architecture.md#the-ui-uses-simple-english-only)).

Out of scope for now: mobile apps and iOS (Safari on iPhone does not see external cameras), Firefox (no `MediaStreamTrackProcessor`), signing and notarisation of builds (a separate task later), and any use of closed InfiRay libraries: the protocol is our own, reconstructed from public sources.

## What is known about the camera

From community reverse engineering (EEVblog, P2Pro-Viewer), not from vendor documentation:

| Fact | Value | Certainty |
| --- | --- | --- |
| Interface | USB UVC, Realtek bridge, PID 0x5830 (shared with TOPDON TC001) | confirmed by several sources |
| Video mode | YUYV 256×384 at 25 Hz; there is also a 256×192 mode without raw data | confirmed |
| Rows 0–191 | processed 8-bit image from the camera (AGC) | confirmed; whether greyscale or a palette is to be checked |
| Rows 192–383 | raw 16-bit little-endian per pixel, packed in the YUYV bytes: `[Y0 U Y1 V] = [p0.lo p0.hi p1.lo p1.hi]` | confirmed |
| Temperature | `T[°C] = raw / 64 − 273.15` in high gain | to be verified; low gain probably uses another divisor |
| Commands | NUC (shutter), gain and others through USB vendor control transfers | protocol reconstructed in P2Pro-Viewer, untested on macOS |

Risks that the spikes settle:

1. Does the camera send 256×384 with raw data right away, or does a USB command have to switch it on?
2. What does the upper half look like (greyscale or palette, is brightness monotonic in temperature)?
3. Which frame format does the browser get on macOS? Chrome and Safari capture through AVFoundation, which may convert YUY2 to NV12 with an unknown chroma filter or squeeze the range.
4. Can node-usb send USB commands on macOS while the system UVC driver holds the camera?

## How the work runs

- The implementer has no camera. Every step that needs hardware ends in a script with instructions (`npm run spike:m<n>`) and a result format; the owner runs it and posts the output in the issue.
- The spikes M1 to M3 end with a report in `docs/findings/`, one file per spike, such as [m1.md](findings/m1.md). Work that does not depend on a spike's result goes on in parallel; work that does waits for the owner's decision.
- Milestones do not run strictly in sequence. The specification asked for one after another; the owner agreed to any order that leads to the finished product.
- Every uncertain constant (temperature divisor, command codes) lives in the camera profile with a comment on its source and confidence.
- Code from other projects only under their licence, with attribution in `NOTICE`. The protocol is described in our own words in [protocol.md](protocol.md).

## Milestones

### M0. Repository skeleton

| Issue | Pull request |
| --- | --- |
| [#3](https://github.com/mateuszsikora/irvis/issues/3) | This roadmap, the [architecture decisions](decisions/architecture.md), and the rule that plans may live in `docs/` |
| [#4](https://github.com/mateuszsikora/irvis/issues/4) | The documentation check learns TypeScript: Vitest test ids in invariants, a `package.json` bump filter that parses JSON, exclusions for test helpers, fixtures and `NOTICE` |
| [#5](https://github.com/mateuszsikora/irvis/issues/5) | npm workspaces, strict TypeScript, Vitest, ESLint, Prettier; core types and the empty camera registry; a hello world in `apps/web` with `netlify.toml`; the "Promote to release" workflow; a CI job for TypeScript |

The three pull requests go in this order, because #3 and #4 change the same files of the documentation contract.

**Acceptance:** `npm test` and `npm run build` pass in CI.

**Owner:** connect the repository in Netlify with the production branch `release` (after #5).

### M1. Spike: exact data via ffmpeg

| Issue | Pull request |
| --- | --- |
| [#6](https://github.com/mateuszsikora/irvis/issues/6) | YUYV decoder and the `infiray-p2pro` profile in core; `tools/capture-cli` with `list`, `probe`, `capture` and `report` (frame size, fps, jitter, temperatures, upper half, NETD, automatic NUC events); `npm run spike:m1` |
| [#16](https://github.com/mateuszsikora/irvis/issues/16) | Short excerpts of real frames in `fixtures/`, regression tests, NETD and the default recording threshold in the profile, codec benchmark on real data, `.irvis` v1 frozen. Needs [#14](https://github.com/mateuszsikora/irvis/issues/14) |

**Acceptance (from the specification):** every frame has 196 608 B; the lower half gives sensible temperatures (room about 20–25 °C, hand about 30–35 °C) that agree with the Android app within ±2 °C; the report says whether the 384 mode works without commands, what the upper half looks like, the latency and the fps stability.

**Scope update (owner, 15 Nov 2026):** the Android comparison is waived for #6. The spike records plausible temperatures without claiming reference accuracy; conversion confidence stays reported. Original AVFoundation packets have 512 allocation bytes beyond the 196608-byte image; the capture packs image pixels without conversion and retains source packet sizes in its report ([measured results](findings/m1.md)).

**Owner:** install ffmpeg (Homebrew; the app ships its own build only from #23), run `npm run spike:m1` on macOS (Android readings are optional under the scope update above), keep the long series locally or attach them to a GitHub Release.

### M2. Spike: USB commands

| Issue | Pull request |
| --- | --- |
| [#7](https://github.com/mateuszsikora/irvis/issues/7) | [protocol.md](protocol.md); commands in the profile; `capture-cli usb` on macOS and Linux; NUC and gain while ffmpeg streams; reading and testing the camera state (gain, TPD parameters, `pseudo_color`, `cur_vtemp`) |

P2Pro-Viewer (MIT) sends gain as a vendor control transfer, but has no NUC command: its README lists "NUC shutter control" as not done. The NUC command has to come from other sources or from experiments.

**Acceptance (from the specification):** an audible shutter click after NUC and a range change visible in the data, or a documented reason why it is not possible and a proposed workaround.

**Owner:** run the script on macOS (and Linux, if available), listen for the click, post the log.

### M3. Spike: browser and comparison mode

| Issue | Pull request |
| --- | --- |
| [#8](https://github.com/mateuszsikora/irvis/issues/8) | Reconstruction of raw values from I420/NV12 in core, from scratch (there is no prototype code); synthetic scenes; comparison metrics; benchmark against the targets without failing CI |
| [#9](https://github.com/mateuszsikora/irvis/issues/9) | `packages/backend-browser` and a diagnostics page for Chrome and Safari: exact constraints with `resizeMode: 'none'`, frame format panel, reconstruction in a Worker, planar frame dumps |
| [#10](https://github.com/mateuszsikora/irvis/issues/10) | The first Electron window (`app://irvis/`, sandboxed), ffmpeg in the main process, `getUserMedia` in parallel, three comparison variants (simulation, live, dumps), `report.json` |

Targets for the reconstruction (from the specification): Y matches the low bytes in 100% of samples (full 0–255 range); the browser chroma equals the libyuv model ±1 in at least 99% of samples; as few byte jumps (error ≥ 3 K) as possible, with their locations; at least 99.9% bit-exact pixels in flat regions; absolute error p99 ≤ 0.5 K; at most 30 ms per frame on Apple M1/M2. The prototype described in the specification reached 100% on simple scenes and 99.25% on average (98.4% minimum) on blurred scenes, at 40–55 ms per frame in Node, on synthetic data only. Regression tests assert what the implementation reaches; the targets are reported by the benchmark.

**Acceptance (from the specification):** a report with these metrics for Chrome and Safari on macOS and a verdict: reconstruction works, works partly, or does not work.

**Owner:** run `npm run spike:m3:web` in Chrome and Safari and `npm run spike:m3:desktop`, on a static scene; post the reports.

### M4. Shared UI and software features

| Issue | Pull request |
| --- | --- |
| [#11](https://github.com/mateuszsikora/irvis/issues/11) | Accepted text-only Android feature catalogue and M4/M5 handoff |
| [#12](https://github.com/mateuszsikora/irvis/issues/12) | Six palettes (Iron, White Hot, Black Hot, Rainbow, Red Hot, Cold Blue), render to RGBA, automatic and manual range; min and max with position, point (3×3 mean), line, area, histogram |
| [#13](https://github.com/mateuszsikora/irvis/issues/13) | Emissivity with reflected temperature, offset, °C and °F, threshold alarms, isotherms |
| [#14](https://github.com/mateuszsikora/irvis/issues/14) | The `.irvis` container and codec, [irvis-format.md](irvis-format.md) |
| [#15](https://github.com/mateuszsikora/irvis/issues/15) | Photo export: PNG with the one-frame `.irvis` embedded in a private chunk, CSV |
| [#17](https://github.com/mateuszsikora/irvis/issues/17) | A minimal `packages/backend-replay` that plays synthetic frames and fixtures from memory; the React viewer on top of it: live view, scale bar, controls generated from capabilities and profile commands, greyed-out hardware features in the browser, uncertain-pixel overlay, simple English UI (no localization layer) |
| [#18](https://github.com/mateuszsikora/irvis/issues/18) | Several points, lines and areas at once; editing/reset, tracking, region highlighting, units/corrections/alarms and saved-photo analysis from #11 |
| [#19](https://github.com/mateuszsikora/irvis/issues/19) | `packages/media`; crash-safe recording to `.irvis` (Electron `fs`, browser OPFS); `.irvis` playback through `Player` in `backend-replay`, with full measurements; MP4 export through WebCodecs; photo/annotation/gallery workflows and optional microphone audio from #11 |
| [#20](https://github.com/mateuszsikora/irvis/issues/20) | The browser and desktop backends completed, ffmpeg arguments per system |
| [#21](https://github.com/mateuszsikora/irvis/issues/21) | Playwright runs the same fixtures through `backend-replay` in Chromium, WebKit and Electron; readings are bit-identical with Node |

**Acceptance (from the specification):** the same recorded frames in `fixtures/` give identical readings in both environments (exact path). #21 automates this with `npm run test:parity` ([coverage and exclusions](guides/testing.md#cross-runtime-acceptance-21)). It covers the exact path, the UI wiring and the differences between V8 and JavaScriptCore, not the real camera backends; the spikes and the M5 checklist cover those.

**Owner:** Android feature list accepted in #11; the [catalogue and evidence](findings/android-app.md) are the reference for M4/M5.

### M5. Hardware features in the desktop app

| Issue | Pull request |
| --- | --- |
| [#22](https://github.com/mateuszsikora/irvis/issues/22) | `command()` through the preload, limited to the profile's allow-list; NUC, gain and camera settings in the UI; greyed out in the browser; `findings/m5-checklist.md` (planned, M5) |

**Acceptance (from the specification):** every option works on the real camera.

**Owner:** go through the checklist on the camera.

### M6. Release

| Issue | Pull request |
| --- | --- |
| [#23](https://github.com/mateuszsikora/irvis/issues/23) | electron-builder packages (dmg, nsis or zip, AppImage and deb), unsigned; node-usb prebuilds; the own LGPL ffmpeg build per platform; the udev rule in the deb package |
| [#24](https://github.com/mateuszsikora/irvis/issues/24) | Release workflow on a tag for macOS, Windows and Ubuntu; artifacts and ffmpeg sources in the GitHub Release; the `release` branch moved for Netlify |
| [#25](https://github.com/mateuszsikora/irvis/issues/25) | README with supported cameras, browser limits, minimum versions and links |
| [#26](https://github.com/mateuszsikora/irvis/issues/26) | History audit for secrets and files that must not be public, licence review, then CI as a required check |

**Owner:** switch the repository to public after #26.

## Order of work

1. #3, then #4, then #5. The owner connects Netlify.
2. #6 as early as possible, then #7, so that the owner can run them on the camera.
3. In parallel, without hardware: #8, #14, #12, #13 and, after #14, #15 in core, tested on synthetic frames; #17, which creates the minimal `backend-replay` and builds the viewer on synthetic frames.
4. After the results of #6 and with #14 in place: #16. After #7: #22. After #10: the decision on the browser path.
5. M4 closes with #21, M5 with the checklist, then M6.

## Risks

| Risk | Settled in | Fallback |
| --- | --- | --- |
| The 384 mode needs a command | #6 | `y16_preview_start` (0x010a) from #7 before the stream starts; in the browser then only the image, without temperatures |
| macOS does not send commands while the UVC driver holds the camera | #7 | A native helper through IOKit `DeviceRequest`; at worst commands only on Linux (tested in #7) and Windows |
| AVFoundation squeezes the Y range or filters chroma differently from libyuv | #9, #10 | Calibrate the chroma model from frame pairs; if the bytes cannot be recovered, the browser shows the image only |
| Reconstruction slower than 30 ms per frame | #8 | Profiling, fewer candidates, WASM in a separate package |
| Reconstruction from scratch misses the targets | #8 | A report with numbers; the browser path marks uncertain pixels or shows the image only |
| Another divisor for low gain | #7 | The same scene in both modes; the conversion in the profile with confidence "measured" |
| Real noise, dead pixels or the shutter spoil `.irvis` compression | #16 | Block mode per block, a higher default threshold, motion compensation, a lower data frame rate |
| The own ffmpeg build fails on a platform | #23 | System ffmpeg through `IRVIS_FFMPEG` with instructions; at worst a native capture addon |
| WebCodecs, `MediaStreamTrackProcessor` or OPFS missing in older Safari | #9, #19 | Minimum Safari version in the README; recording in memory with a warning; MP4 export where it works |
| The NUC command is unknown | #7 | Other sources; at worst only the camera's automatic shutter |
| The browser does not know the camera state (gain, TPD, palette) and readings are silently wrong | #7 | Assume high gain with a visible warning, let the user declare the mode, warn on inconsistent data |
| The camera applies emissivity to the raw data and the app applies it again | #7 | Software correction relative to the camera state stored in the `.irvis` chunk |
| Netlify's free-plan credits run out, or deploys block (forum reports from July–August 2026, not verified) | after #5 | Production only from `release`; Cloudflare Pages |

## Deviations from the specification

1. Milestones do not run strictly in sequence (see [How the work runs](#how-the-work-runs)).
2. The camera profile is generalised: no hard-coded `width: 256; height: 384; thermalRow0: 192`, and the conversion is data instead of a `toCelsius` function ([decision](decisions/architecture.md#a-camera-is-a-profile-and-its-conversion-is-data)).
3. "Video recording" is a `.irvis` recording with MP4 export ([decision](decisions/architecture.md#recordings-are-irvis-files-and-mp4-is-an-export)).
4. The "own raw format (header + Uint16Array)" is merged into `.irvis`: a snapshot is a one-frame recording, and the PNG photo embeds that one-frame `.irvis`, so there is one temperature format.
5. Netlify instead of GitHub Pages ([decision](decisions/architecture.md#the-web-version-is-hosted-on-netlify-and-goes-to-production-from-release)).
6. An own LGPL ffmpeg build instead of `ffmpeg-static` ([decision](decisions/architecture.md#the-desktop-app-ships-its-own-lgpl-ffmpeg-build)).
7. New packages `backend-replay` and `media`, which the proposed repository layout does not have.
8. `CameraBackend.id` gains `'replay'`, `RawFrame` gains a `thermal` variant, and there is a new `Player` interface ([decision](decisions/architecture.md#interfaces-live-in-core-as-types-and-apps-inject-the-backends)).

## Open questions

- The factor k in the default recording threshold (k × NETD), after #6.
- Motion compensation in `.irvis` v1, after the measurements in #16.
- Whether the camera applies emissivity itself (#7); if it does, the P2 Pro profile gets the state fields `emissivity` and `reflected-temperature`. The formula is decided ([decision](decisions/architecture.md#emissivity-is-corrected-with-the-fourth-power-law-and-a-reflected-temperature)).
- How to know the gain mode without commands: from the data, or only from the user's declaration (#7).
- The NUC command for the P2 Pro (#7).
- Does TOPDON TCView on Windows work with the T7 (same PID)? It could serve as a reference.
- Minimum supported versions of Node LTS, Electron and Safari.

## Sources

- [LeoDJ/P2Pro-Viewer](https://github.com/LeoDJ/P2Pro-Viewer): P2 Pro viewer and API in Python, reconstructed command protocol (MIT).
- [alufers/thermal-cat](https://github.com/alufers/thermal-cat): GUI for the P2 Pro (Windows, Linux).
- [atomic14/InfiRayCapture](https://github.com/atomic14/InfiRayCapture): native macOS app.
- [leswright1977/PyThermalCamera](https://github.com/leswright1977/PyThermalCamera): viewer for the TOPDON TC001.
- EEVblog forum: "InfiRay and their P2 Pro" discussion.

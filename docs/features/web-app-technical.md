# Web app: technical

How `apps/web` and its publishing on GitHub Pages work, for whoever changes them. Why there is one build for the web and the desktop app: [decision](../decisions/architecture.md#one-ui-build-serves-the-web-and-the-desktop-app). Why Pages publishes from releases: [decision](../decisions/architecture.md#the-web-version-is-published-on-github-pages-from-published-releases).

## Data flow

1. `apps/web/index.html` loads `/src/main.tsx` as a module.
2. `main.tsx` finds `#root` and renders `<App />` in React's `StrictMode` with `createRoot`.
3. `App` (`src/App.tsx`) reads `cameraProfiles` from `@irvis/core` and renders the page. Vite resolves `@irvis/core` through the npm workspace link to `packages/core/src/index.ts` and bundles core's TypeScript source.

## Browser diagnostics

`App` also renders `Diagnostics` from `src/Diagnostics.tsx`. It selects a core thermal profile mode and a media device, starts/stops `@irvis/backend-browser`, displays metadata and raw statistics, and downloads the latest report and planar frame. Unmount stops capture. The app project references the backend TypeScript project as well as core. See [backend data flow](backend-browser-technical.md#data-flow) and [export schema](../browser-diagnostics-format.md).

## Interfaces

| Export | Signature | Notes |
| --- | --- | --- |
| `App` (`src/App.tsx`) | `({ profiles = cameraProfiles }: AppProps) => JSX.Element` | `profiles` lets a test pass other profiles than the registry |

Scripts in `apps/web/package.json`: `dev` (`vite`), `build` (`vite build`), `preview` (`vite preview`).

## Configuration

### Build

`apps/web/vite.config.ts`:

| Setting | Value | Why |
| --- | --- | --- |
| `base` | `'./'` | Pages serves the files under `/irvis/` and Electron from the root of `app://irvis/`. With a relative base, `index.html` loads `./assets/…`, and the bundle finds its Workers, the AudioWorklet and the other assets with `new URL(<file>, import.meta.url)`, so the same files work under any path, a custom domain's root included. The app has no client-side routes, so no page other than `index.html` would need another base |
| `plugins` | `@vitejs/plugin-react` | JSX and React Fast Refresh in `dev` |
| `build.outDir` | `dist` (emptied first) | What the desktop app copies to `web/` and what the Pages workflow uploads |
| `build.license` | `{ fileName: 'THIRD-PARTY-LICENSES.md' }` | The minified bundle drops the licence comments of the npm packages it contains (React, React DOM, scheduler, fflate and the MPL-2.0 Mediabunny). Vite writes `dist/THIRD-PARTY-LICENSES.md` with the name, version, SPDX identifier and licence text of each, so the file is served next to `index.html` and copied into the desktop packages |
| `test` | project `web`, environment `jsdom`, files `src/**/*.test.{ts,tsx}` | Read by Vitest ([testing guide](../guides/testing.md#react-component-tests)) |

TypeScript: `apps/web/tsconfig.json` is a solution file for `tsconfig.app.json` (`src/`, `lib` ES2022 + DOM + DOM.Iterable, `types: ["vite/client"]`, `jsx: "react-jsx"`, `noEmit`, references core's library project, so `src/` type-checks against core's declarations) and `tsconfig.node.json` (`vite.config.ts`, `types: ["node"]`). Both extend the root `tsconfig.base.json`.

### Pages

The web version is the build of `apps/web/dist` from the tag of the latest published release, served by GitHub Pages at `https://no-plan.dev/irvis/` (`https://mateuszsikora.github.io/irvis/` redirects there, because the account's user site has the custom domain `no-plan.dev`). The workflow that builds and publishes it, and the repository settings it needs, are in [the development guide](../guides/development.md#pages).

Pages serves static files over HTTPS and sets no headers of the repository's choosing: no `Content-Security-Policy`, no `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy`, and `Cache-Control: max-age=600` on every file. The app needs none of the three security headers: nothing in it uses `SharedArrayBuffer`, so it does not need to be cross-origin isolated, and `netlify.toml` set no headers either. What it needs from the origin is a secure context, for camera access, module Workers (the diagnostics worker of `@irvis/backend-browser` and the storage worker of `@irvis/media`), the AudioWorklet of the microphone and OPFS. HTTPS gives all of them; the [Pages smoke check](#pages-smoke-check) tries the camera, both Workers and OPFS on every publish, not the AudioWorklet. The CSP that the desktop app sets on `app://irvis/` applies only there.

The site shares its origin, `https://no-plan.dev`, with the user site and the account's other project sites (such as `/slate/`). The browser keeps storage and permissions per origin, so their pages can read and delete the recordings in OPFS (`irvis-recordings`), the photos in IndexedDB (`irvis-photos`) and the saved camera in localStorage, and they use the camera permission given to irvis. A domain or subdomain of irvis's own would give it a separate origin ([decision](../decisions/architecture.md#the-web-version-is-published-on-github-pages-from-published-releases)).

### Pages smoke check

`apps/web/test/pages-smoke.mjs` opens the web build in headless Chromium (Playwright) and checks what the app needs from a static HTTPS host:

```sh
npm run build --workspace @irvis/web
node apps/web/test/pages-smoke.mjs                              # the build, served under /irvis/
node apps/web/test/pages-smoke.mjs https://no-plan.dev/irvis/   # the published site
```

Without a URL it serves `apps/web/dist` under `/irvis/` on a free port of `localhost` with no header but `Content-Type`, the way Pages serves a project site; `localhost` is a secure context as HTTPS is. Chromium's fake camera plays grey frames of the first video mode of the first camera profile (256 × 384 at 25 fps for the InfiRay P2 Pro), written to a temporary `.y4m` file, because browser diagnostics ask for that exact size. In that order, it checks:

1. the heading `irvis` and `window.isSecureContext`;
2. Demo → Start, "Check recording storage" answering with the OPFS message (`Estimated uncompressed capacity: <n> seconds`, not the memory fallback), Record .irvis for a second and Stop recording; the recording is listed, and a non-empty `.irvis` file is in the OPFS directory `irvis-recordings`, written through the storage module Worker. It then deletes the recording and stops the demo;
3. Capture diagnostics → Start diagnostics with the fake camera, until the panel counts a frame read in the diagnostics module Worker;
4. that no request failed, no response had a status of 400 or more, and the page threw no error. A wrong `base` shows up here as missing files under the site's path.

It prints `pages smoke (<url>): files, secure context, OPFS recording, module Workers and camera passed` and exits 0; on a failure it prints the failed requests and responses it saw before Playwright's error. It needs `npx playwright install chromium` (with `--with-deps` on Linux). The recording it makes on the published site is deleted again, and the rest stays in the temporary browser profile of that run.


## Failure modes

| Symptom | Cause |
| --- | --- |
| The page stays empty and the console shows `Uncaught Error: irvis: no #root element in index.html` | `index.html` lost its `<div id="root">` |
| The published page stays empty and the console lists 404s for `/assets/…` at the root of the domain | `base` is absolute (`'/'`) again; the Pages smoke check fails on the build before it is published |
| "Publish on Pages" fails with `Tag "v<version>" is not allowed to deploy to github-pages due to environment protection rules.` | The environment `github-pages` lacks the tag rule `v*` ([development guide](../guides/development.md#pages)) |

## Tests

`apps/web/src/App.test.tsx` renders `App` with Testing Library in jsdom: the heading `irvis`, the empty-registry line, and the list of names for passed profiles.

Backend tests live in `packages/backend-browser/test/`; see [backend tests](backend-browser-technical.md#tests). `Diagnostics.test.tsx` covers empty profiles, session reset, fps, device storage and downloads.

Not covered: `main.tsx`; how the desktop app loads this build from `app://irvis/`, which CI does not check (`npm run test:desktop` runs only by hand; the [Pages smoke check](#pages-smoke-check) runs on the web build in CI and in the Pages workflow); Safari, the other supported browser, and real cameras on the Pages origin.

## See also

- [Web app](web-app-user.md)
- [Development guide: Pages](../guides/development.md#pages)

## Desktop comparison panel

`Diagnostics.tsx` passes its selected profile mode and latest running browser analysis to `Comparison.tsx`. The optional preload bridge reveals the desktop-only comparison panel. Mode changes unmount the old panel and stop reference capture; starting/stopping browser diagnostics remains independent. Simulation and live comparison, bounded reports and frame-pair downloads are described in [Electron backend](backend-electron-technical.md). The common build still runs without the preload in ordinary browsers.

## Viewer integration

`App.tsx` mounts a keyed `SourceViewer` wrapping `@irvis/ui` above a collapsible Capture diagnostics panel. The header's Source select has the value `demo` (the default, `@irvis/backend-replay` with its device `demo`) or `camera:<id>` for each device that `listLiveCameras()` in `viewer-backend.ts` returns, and `missing` for a chosen camera that is no longer listed; the option text is the device label, or its id when the label is empty. A device may carry `vendorId` and `productId`; `listLiveCameras()` reads them in the browser from a label that ends with ` (<vendor>:<product>)` in hexadecimal, as Chrome writes it for USB cameras (for example `USB Camera (0bda:5830)`), and the desktop app reports them itself. `App` lists the cameras on mount and on the icon button labelled `Refresh cameras` (`aria-label` and `title`, the `refresh` icon of `@irvis/ui`), which is disabled and has `aria-busy` while a list is pending, when `viewer.css` spins its icon unless reduced motion is preferred; a list that resolves after unmount is ignored, and a failure shows `Cameras unavailable: <message>` (the error's `message`) with `role="status"` above the viewer, whatever the source. Refresh stays enabled during capture and does not stop it. `App` keeps the chosen device (id and label, `null` for Demo) and finds it in each new list with `findCamera()`: the same id with the same label, otherwise the only device with that label (never for an empty label). After each list it stores the device it found, so a camera followed to a new id is matched from that id next time. AVFoundation indexes and V4L2 `/dev/videoN` paths are list positions that shift when a device comes or goes, so an id alone would hand the choice to whichever device moved into the position; the label prevents that only when the two devices have different names (on Linux the desktop app labels nodes with the kernel's device name, see [desktop technical](desktop-technical.md); a node without a readable sysfs name is labelled `videoN`, which is positional too). Two devices with the same label at the same position are indistinguishable. A chosen camera that `findCamera()` does not find stays selected as the option `<label> (disconnected)` (value `missing`), and the viewer gets an empty `device`, which disables Start. A camera found under a new id passes that id to the viewer without remounting it, so a running capture continues and the next Start opens the new id. The Camera profile select is built in `App` and passed through `SourceViewer` to the viewer's `profilePicker`, so it appears next to Start. Choosing a camera in Source calls `matchProfiles()` from `@irvis/core` with the device and sets Camera profile to the result when there is exactly one; with none or several the profile stays. For the chosen camera found in the list, `App` calls `listCameraModes(id)` in `viewer-backend.ts` on each Source choice and each time the camera's id or label changes; it returns the bridge's `listModes(id)` result, or `null` when the modes are unknown: in the browser, with a bridge without `listModes`, when the list is empty, or when the call rejects. A result that resolves after another choice, id or label, or after unmount, is ignored. `App` keeps the result with the choice, id and label it was read for and uses it only for a camera with the same label and either the same id or, within the same choice, another id, so a refresh that follows the camera to a new id keeps its modes while they are read again, and also when that read returns `null`, and modes read for another device at the same id never show. Video mode options come from `videoModeOptions(profile, modes, imageOnly)` in `src/video-modes.ts`, where `imageOnly` is true for a live camera when `showsImageOnly()` in `viewer-backend.ts` is: in the desktop app, whose bridge delivers the camera's YUYV bytes, not in the browser or for Demo. An option has a `mode` when it can be chosen, and its value is the mode's id. With unknown modes (also while they are read, and for Demo) the options are the profile's modes: a mode with a thermal layout is `<width> × <height> · <fps> fps`; a mode without one is `<width> × <height> · <fps> fps · image only`, which can be chosen only where `imageOnly` is true and is disabled elsewhere. With known modes they are the device's modes in the order it reports them, each the profile's thermal mode of the same size whose frame rate lies in the device's range widened by 0.01 fps at both ends, as cameras report rates such as `30.000030` (any rate when the device reports none), else the profile's mode without a thermal layout that fits the same way, labelled as above, else the device's own image-only mode `imageOnlyMode(width, height, maxFps)` from `@irvis/core` ([core technical](core-technical.md#image-only-video-modes)): value `image-<width>x<height>@<fps>`, label `<width> × <height> · <fps> fps · image only`, opened at the highest rate of the device's range (DirectShow reports ranges; the desktop app reports one rate per AVFoundation mode), and chosen only where `imageOnly` is true. A device mode without a frame rate (V4L2) or one `imageOnlyMode` refuses (an odd width) is a disabled `<width> × <height> · <rate> · image only` with value `device-<width>x<height>-<minFps>-<maxFps>`, where the rate is `<fps> fps` or `<min>–<max> fps`, each rounded to two decimals, or absent. Repeated options are dropped. The default is the first mode with a thermal layout in the profile's order that can be chosen, not the first option, so that modes arriving after a choice do not change a mode the camera offers and remount a running viewer (a mode it does not offer changes, and its capture would fail anyway); only when there is none, the first image-only mode that can be chosen, in option order. When no option can be chosen the select has the value `""` of a hidden, disabled option `No video mode to choose`, and the viewer gets an empty mode id, which disables Start. When the device's modes are known and none of them is a mode with temperature data, `App` shows `<label> has no video mode with temperature data in the <profile name> profile, so it shows the image only. It is probably not the thermal camera: for temperatures, choose another camera in Source.` with `role="status"` above the viewer, or, when no mode can be chosen at all, `<label> has no video mode with temperature data in the <profile name> profile. It is probably not the thermal camera: choose another camera in Source.` `SourceViewer` is keyed by a counter of Source choices, the profile id and the mode id, so choosing a source, profile or mode remounts the viewer and releases its session. `viewer-backend.ts` selects Electron at runtime when `desktopBridge()` exists; otherwise browser capture uses `startDiagnostics` and forwards its planar frames. `liveBackend`'s `open` resolves the mode id with `findVideoMode()` from `@irvis/core` and rejects with `This mode has no thermal data.` for an unknown id and, in the browser, for a mode without a thermal layout; the desktop bridge also opens an image-only mode. The existing bridge supplies exact YUYV frames. Electron advertises device control when the bridge exposes `command`, exact raw frames and concurrency with the browser on macOS. Session commands reject after ownership changes. `listLiveCameras()` serves both runtimes and is also the live backend's `listDevices`: Electron enumerates native inputs through IPC (`Camera 0` when the bridge has no `listDevices`); the browser lists Default camera plus media devices with a device id, which browsers expose only after camera access was granted, so names appear after the first Start and a refresh. Without `navigator.mediaDevices` it rejects with `Camera access requires HTTPS or localhost.` Capture failures are shown in the app alert. One Vite build serves both environments. Stop the viewer before starting diagnostics on the same device.

Shared controls and limitations: [viewer user guide](ui-user.md) and [technical details](ui-technical.md). Viewer styles live in `src/viewer.css`, which makes `[hidden]` `display: none !important` so that the attribute also hides an element whose class sets `display`, such as the viewer's `.scale-strip` in an image-only view or the recording list.

`src/viewer-backend.test.ts` verifies runtime backend selection, frame forwarding, idempotent bridge cleanup, the USB IDs read from a Chrome label, `listCameraModes()` without a bridge, with modes, with an empty list and with a rejection, and an image-only mode opened through the bridge but refused in the browser and for another spelling of its id. `src/video-modes.test.ts` covers the profile's modes with image-only ones chosen only where they can be shown, matching a device mode by size and frame-rate range, a device's own image-only mode at the highest rate of its range, the 0.01 fps tolerance with the rounded label, and the disabled option of a mode without a rate or with an odd width. The desktop smoke test also starts and stops the synthetic viewer before checking diagnostics.

## Session ownership and errors

`viewer-backend.ts` tracks a capture owner token in a WeakMap keyed by the preload bridge, shared across adapter instances. Only the current owner may forward frames/errors or issue global `bridge.stop()`. Closing an obsolete pending open removes its listener without stopping newer capture. Browser callbacks also check whether their session has closed. Each new open clears the capture error before starting. `SourceViewer` in `App.tsx` owns the backend and capture error state and passes that error into the viewer for an inline alert and Capture error status. It is keyed by the Source choice, profile and mode, so changing any of them creates independent error state. Its unmount cleanup invalidates the error callback even while `bridge.start()` is unresolved. Late open results are still closed by the viewer generation check; the adapter ownership check still prevents that close from stopping newer capture.

`src/App.test.tsx` covers the profile names in Camera profile next to Start, the Source options (Demo and each listed camera), the profile's Video mode options with the image-only mode disabled for Demo, the modes the chosen camera reports with the default with temperature data and Start of the T7's image-only mode, the notice and Start of an image-only mode for a camera without a temperature mode, the other notice and disabled Start for a camera with no mode to choose, the fallback to profile modes when reading the modes fails, the profile chosen by USB IDs or by name pattern and kept when none or several profiles match, the default mode kept in profile order when the modes arrive after Start, modes ignored when they arrive for a camera no longer chosen or were read for another device at the same id, modes kept while a refresh follows the camera to a new id and when reading them there fails, Start with the camera and mode chosen in the header, a selected camera that disappears on refresh and comes back, another camera moving into a disconnected camera's position, a camera followed to its new position and started there, a followed camera that keeps its new id when a namesake takes its old one, and the listing error. `src/viewer-session.test.tsx` covers Start → Stop → Start with a delayed first Electron open and error recovery for browser capture. It also covers pending errors after switching to Demo and back without a new open, profile changes during open, eventual old-session cleanup, and delivery of current-profile errors. `src/viewer-backend.test.ts` additionally tests ownership across separate adapter instances and ignored obsolete errors.

## Brand assets

`src/brand/mark.svg` contains the compact `ir` mark; `src/brand/wordmark.svg` contains the full `irvis` wordmark. Both use outlined vector letters and an asymmetric rounded silhouette. The compact `ir` is dark ink `#291a0f` on amber `#ffb066`; the full wordmark retains that mark and adds ivory `vis` (`#f3eee8`) directly on a transparent background, for dark surfaces. `src/brand/wordmark-badge.svg` preserves the enclosed charcoal `#202126` variant for light, photographic or otherwise variable backgrounds; it is a reusable source asset, not the header default. No installed font or raster image is required. `App.tsx` uses a picture in the level-one heading: the wordmark is 115.5 × 44 CSS pixels normally and the compact mark is 40 × 40 pixels at viewport widths up to 480 px. A visually hidden `irvis` label keeps the heading accessible; the picture is decorative. `index.html` references the compact SVG as its favicon, and Vite emits the asset in the build.

The shared viewer's measurement controls use a grid with labelled coordinate and temperature inputs in `src/viewer.css`. Active tracking shortcuts use the accent border and text colour. The shared UI owns thermal photo loading and analysis; the web app does not introduce a separate photo decoder.


## Photo library injection

`App.tsx` creates `createPhotoLibrary` from `src/photo-library.ts` once and injects it through `SourceViewer` to the shared viewer. IndexedDB database `irvis-photos` version 1 contains a `photos` object store keyed by `id`; records hold name, creation timestamp and temperature-bearing PNG bytes. The same host adapter runs under the browser origin and Electron's app origin, with separate data. Without IndexedDB, photo capture/gallery are disabled. This photo adapter does not implement #19 recording ByteSink storage or choose a recording backend.

Each operation opens a connection and closes it after its transaction. Saves resolve on transaction completion, not request success; duplicate keys, quota and transaction failures propagate to the UI. Version changes close open connections. Blocked opens report `Photo storage is blocked by another window.` and close a later successful connection. Delete removes only the selected record. Browser/site data clearing and storage eviction remain possible, so the gallery recommends downloading backups.

`src/photo-library.test.ts` uses `fake-indexeddb` to exercise persistence across adapter instances, duplicate-save failure and selected deletion. No live browser persistence or quota test is claimed.

## Recording storage injection

`App.tsx` constructs one `RecordingStorage`: the preload's recording API selects `createDesktopRecordingStorage`; otherwise `createBrowserRecordingStorage` supplies OPFS or an explicitly warned memory fallback. The same instance survives source/profile remounts. External recording files use `fileByteSource`.

The desktop live backend forwards optional numeric command values through `bridge.command(id, value)` while retaining its session-ownership check. Browser capture exposes no command dispatcher. Numeric camera controls are part of the shared viewer.

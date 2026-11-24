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

`App.tsx` mounts a keyed `SourceViewer` wrapping `@irvis/ui` above a collapsible Capture diagnostics panel. The header's Source select has the value `demo` (the default, `@irvis/backend-replay` with its device `demo`) or `camera:<id>` for each device that `listLiveCameras()` in `viewer-backend.ts` returns; the option text is the device label, or its id when the label is empty. `App` lists the cameras on mount and on the icon button labelled `Refresh cameras` (`aria-label` and `title`, the `refresh` icon of `@irvis/ui`), which is disabled and has `aria-busy` while a list is pending, when `viewer.css` spins its icon unless reduced motion is preferred; a list that resolves after unmount is ignored, and a failure shows `Cameras unavailable: <error>` with `role="status"` above the viewer. A selected camera missing from the latest list stays selected as the option `Disconnected camera`, and the viewer gets an empty `device`, which disables Start. The Camera profile select is built in `App` and passed through `SourceViewer` to the viewer's `profilePicker`, so it appears next to Start. Video mode lists the selected profile's modes with a thermal layout, labelled `<width> × <height> · <fps> fps`, and defaults to the first. `SourceViewer` is keyed by source, profile id and mode id, so changing any of them remounts the viewer and releases its session. `viewer-backend.ts` selects Electron at runtime when `desktopBridge()` exists; otherwise browser capture uses `startDiagnostics` and forwards its planar frames. The existing bridge supplies exact YUYV frames. Electron advertises device control when the bridge exposes `command`, exact raw frames and concurrency with the browser on macOS. Session commands reject after ownership changes. `listLiveCameras()` serves both runtimes and is also the live backend's `listDevices`: Electron enumerates native inputs through IPC (`Camera 0` when the bridge has no `listDevices`); the browser lists Default camera plus media devices with a device id, which browsers expose only after camera access was granted, so names appear after the first Start and a refresh. Without `navigator.mediaDevices` it rejects with `Camera access requires HTTPS or localhost.` Capture failures are shown in the app alert. One Vite build serves both environments. Stop the viewer before starting diagnostics on the same device.

Shared controls and limitations: [viewer user guide](ui-user.md) and [technical details](ui-technical.md). Viewer styles live in `src/viewer.css`.

`src/viewer-backend.test.ts` verifies runtime backend selection, frame forwarding and idempotent bridge cleanup. The desktop smoke test also starts and stops the synthetic viewer before checking diagnostics.

## Session ownership and errors

`viewer-backend.ts` tracks a capture owner token in a WeakMap keyed by the preload bridge, shared across adapter instances. Only the current owner may forward frames/errors or issue global `bridge.stop()`. Closing an obsolete pending open removes its listener without stopping newer capture. Browser callbacks also check whether their session has closed. Each new open clears the capture error before starting. `SourceViewer` in `App.tsx` owns the backend and capture error state and passes that error into the viewer for an inline alert and Capture error status. It is keyed by source, profile and mode, so changing any of them creates independent error state. Its unmount cleanup invalidates the error callback even while `bridge.start()` is unresolved. Late open results are still closed by the viewer generation check; the adapter ownership check still prevents that close from stopping newer capture.

`src/App.test.tsx` covers the profile names in Camera profile next to Start, the Source options (Demo and each listed camera), thermal-only Video mode options, Start with the camera and mode chosen in the header, a selected camera that disappears on refresh and comes back, and the listing error. `src/viewer-session.test.tsx` covers Start → Stop → Start with a delayed first Electron open and error recovery for browser capture. It also covers pending errors after switching to Demo and back without a new open, profile changes during open, eventual old-session cleanup, and delivery of current-profile errors. `src/viewer-backend.test.ts` additionally tests ownership across separate adapter instances and ignored obsolete errors.

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

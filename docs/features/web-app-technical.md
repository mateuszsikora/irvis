# Web app: technical

How `apps/web` and its Netlify configuration work, for whoever changes them. Why there is one build for the web and the desktop app: [decision](../decisions/architecture.md#one-ui-build-serves-the-web-and-the-desktop-app). Why production publishes from `release`: [decision](../decisions/architecture.md#the-web-version-is-hosted-on-netlify-and-goes-to-production-from-release).

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
| `base` | `'/'` | Electron serves the files from `app://irvis/`, and a site built from `netlify.toml` would serve them from its root |
| `plugins` | `@vitejs/plugin-react` | JSX and React Fast Refresh in `dev` |
| `build.outDir` | `dist` (emptied first) | What the desktop app copies to `web/` and what `netlify.toml` names as `build.publish` |
| `test` | project `web`, environment `jsdom`, files `src/**/*.test.{ts,tsx}` | Read by Vitest ([testing guide](../guides/testing.md#react-component-tests)) |

TypeScript: `apps/web/tsconfig.json` is a solution file for `tsconfig.app.json` (`src/`, `lib` ES2022 + DOM + DOM.Iterable, `types: ["vite/client"]`, `jsx: "react-jsx"`, `noEmit`, references core's library project, so `src/` type-checks against core's declarations) and `tsconfig.node.json` (`vite.config.ts`, `types: ["node"]`). Both extend the root `tsconfig.base.json`.

### Netlify

No Netlify site is connected to the repository, and none will be: this configuration publishes nothing, and publishing on GitHub Pages ([#54](https://github.com/mateuszsikora/irvis/issues/54)) replaces it.

`netlify.toml` at the repository root:

| Setting | Value |
| --- | --- |
| `build.command` | `npm run build --workspace @irvis/web` |
| `build.publish` | `apps/web/dist` |
| `context.production.ignore` | `test "$BRANCH" != "release"` |

Netlify installs the dependencies itself (it finds `package-lock.json`) with the Node version from `.nvmrc`. The production branch is chosen in the Netlify UI, not in the file; the `ignore` command is a second guard: a production build of any branch other than `release` is cancelled, because an `ignore` command that exits 0 cancels the build. That command replaces Netlify's default check, so a production build of `release` runs even when nothing changed since the last deploy. Deploy previews and branch deploys use the default.

Settings a connected site would need in the Netlify UI:

- Production branch: `release`.
- Deploy previews: on, for pull requests against `main`.
- Branch deploys: none (each deploy costs credits).

## Failure modes

| Symptom | Cause |
| --- | --- |
| The page stays empty and the console shows `Uncaught Error: irvis: no #root element in index.html` | `index.html` lost its `<div id="root">` |
| Netlify shows a production deploy as "Canceled" | A production build ran for a branch other than `release` (the `ignore` guard) |
| `npm ci` fails on Netlify with `EBADENGINE` | The Node version Netlify uses is older than `engines.node` in the root `package.json`; `.npmrc` sets `engine-strict=true` |

## Tests

`apps/web/src/App.test.tsx` renders `App` with Testing Library in jsdom: the heading `irvis`, the empty-registry line, and the list of names for passed profiles.

Backend tests live in `packages/backend-browser/test/`; see [backend tests](backend-browser-technical.md#tests). `Diagnostics.test.tsx` covers empty profiles, session reset, fps, device storage and downloads.

Not covered: `main.tsx`, the production build (CI runs `npm run build` but checks only that it succeeds), and anything Netlify does.

## See also

- [Web app](web-app-user.md)
- [Development guide: Promote to release](../guides/development.md#promote-to-release)

## Desktop comparison panel

`Diagnostics.tsx` passes its selected profile mode and latest running browser analysis to `Comparison.tsx`. The optional preload bridge reveals the desktop-only comparison panel. Mode changes unmount the old panel and stop reference capture; starting/stopping browser diagnostics remains independent. Simulation and live comparison, bounded reports and frame-pair downloads are described in [Electron backend](backend-electron-technical.md). The common build still runs without the preload in ordinary browsers.

## Viewer integration

`App.tsx` mounts a keyed `SourceViewer` wrapping `@irvis/ui` above a collapsible Capture diagnostics panel. Demo is the default and uses `@irvis/backend-replay`. Source and profile changes remount the viewer to release its session. `viewer-backend.ts` selects Electron at runtime when `desktopBridge()` exists; otherwise browser capture uses `startDiagnostics` and forwards its planar frames. The existing bridge supplies exact YUYV frames. Electron advertises device control when the bridge exposes `command`, exact raw frames and concurrency with the browser on macOS. Session commands reject after ownership changes. Both backends use the Camera selector: Electron enumerates native inputs through IPC; browser lists media devices plus Default camera, which can prompt permission on Start. Capture failures are shown in the app alert. One Vite build serves both environments. Stop the viewer before starting diagnostics on the same device.

Shared controls and limitations: [viewer user guide](ui-user.md) and [technical details](ui-technical.md). Viewer styles live in `src/viewer.css`.

`src/viewer-backend.test.ts` verifies runtime backend selection, frame forwarding and idempotent bridge cleanup. The desktop smoke test also starts and stops the synthetic viewer before checking diagnostics.

## Session ownership and errors

`viewer-backend.ts` tracks a capture owner token in a WeakMap keyed by the preload bridge, shared across adapter instances. Only the current owner may forward frames/errors or issue global `bridge.stop()`. Closing an obsolete pending open removes its listener without stopping newer capture. Browser callbacks also check whether their session has closed. Each new open clears the capture error before starting. `SourceViewer` in `App.tsx` owns the backend and capture error state and passes that error into the viewer for an inline alert and Capture error status. It is keyed by source and profile, so changing either creates independent error state. Its unmount cleanup invalidates the error callback even while `bridge.start()` is unresolved. Late open results are still closed by the viewer generation check; the adapter ownership check still prevents that close from stopping newer capture.

`src/viewer-session.test.tsx` covers Start → Stop → Start with a delayed first Electron open and error recovery for browser capture. It also covers pending errors after switching to Demo and back without a new open, profile changes during open, eventual old-session cleanup, and delivery of current-profile errors. `src/viewer-backend.test.ts` additionally tests ownership across separate adapter instances and ignored obsolete errors.

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

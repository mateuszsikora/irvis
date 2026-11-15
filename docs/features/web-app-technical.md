# Web app: technical

How `apps/web` and its Netlify deployment work, for whoever changes them. Why there is one build for the web and the desktop app: [decision](../decisions/architecture.md#one-ui-build-serves-the-web-and-the-desktop-app). Why production publishes from `release`: [decision](../decisions/architecture.md#the-web-version-is-hosted-on-netlify-and-goes-to-production-from-release).

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
| `base` | `'/'` | Netlify serves the site from the root, and Electron will serve the same files from `app://irvis/` |
| `plugins` | `@vitejs/plugin-react` | JSX and React Fast Refresh in `dev` |
| `build.outDir` | `dist` (emptied first) | What Netlify publishes |
| `test` | project `web`, environment `jsdom`, files `src/**/*.test.{ts,tsx}` | Read by Vitest ([testing guide](../guides/testing.md#react-component-tests)) |

TypeScript: `apps/web/tsconfig.json` is a solution file for `tsconfig.app.json` (`src/`, `lib` ES2022 + DOM + DOM.Iterable, `types: ["vite/client"]`, `jsx: "react-jsx"`, `noEmit`, references core's library project, so `src/` type-checks against core's declarations) and `tsconfig.node.json` (`vite.config.ts`, `types: ["node"]`). Both extend the root `tsconfig.base.json`.

### Netlify

`netlify.toml` at the repository root:

| Setting | Value |
| --- | --- |
| `build.command` | `npm run build --workspace @irvis/web` |
| `build.publish` | `apps/web/dist` |
| `context.production.ignore` | `test "$BRANCH" != "release"` |

Netlify installs the dependencies itself (it finds `package-lock.json`) with the Node version from `.nvmrc`. The production branch is chosen in the Netlify UI, not in the file; the `ignore` command is a second guard: a production build of any branch other than `release` is cancelled, because an `ignore` command that exits 0 cancels the build. That command replaces Netlify's default check, so a production build of `release` runs even when nothing changed since the last deploy. Deploy previews and branch deploys use the default.

Settings that live in the Netlify UI, for the owner:

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

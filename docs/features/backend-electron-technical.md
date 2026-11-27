# Electron comparison backend

## Data flow

`packages/backend-electron/src/index.ts` reads the optional preload bridge from `window.irvisDesktop`; it imports no Electron or Node module. ESLint forbids these imports and dynamic imports. It is bundled into the same web build that the desktop app loads and that the web version is to publish ([#54](https://github.com/mateuszsikora/irvis/issues/54)).

`compare(reference, mode, kelvinsPerRaw, live?)` validates packed reference dimensions, extracts little-endian thermal values using the mode's thermal rows, and calls core's `simulateYUYVtoI420` when no live frame is supplied. It reconstructs the planar frame without brightness hints and uses `compareFrames` for error metrics.

## Schema

The result contains `variant`, `metrics`, exact `reference` raw values, `reconstructed` raw values and the `planar` frame. Metrics include low-byte match, chroma-model match, mean/p99/max absolute errors in kelvins, indices of errors at least 3 K, and reconstruction duration. Bit-exact and flat-region matches are emitted only for simulation.

The web panel stores the first 100 measurement records per start, then stops appending to the report while continuing to update the latest comparison. Frame-pair export saves that latest comparison, so its frame may be newer than the last sample in the bounded report. Live pairing chooses the latest browser result with an arrival gap no greater than 500 ms. Reports record both source timestamps and receipt times, browser statistics, profile/mode, user agent, user-confirmed scale and a pending hardware verdict. Frame dumps serialize typed arrays as numeric arrays and preserve planar layout/strides. Live differences include unsynchronized exposure and sensor noise, not only conversion error.

## Interfaces

`desktopBridge()` returns the optional narrow preload API. Its `subscribe(frame, error)` returns an unsubscribe function. Start and stop return promises. No hardware backend is instantiated in an ordinary browser.

## Failure modes

`Reference does not match the profile mode.` rejects truncated or incorrectly sized references and modes without thermal rows. `Planar dimensions differ.` rejects a mismatched browser stream. Core validates planar bounds and positive finite comparison scale.

## Tests

`apps/web/src/Comparison.test.tsx` checks extraction of thermal rows, simulation metrics, omission of bit-exact claims for live pairs, and malformed frames. The desktop smoke test checks the bridge in the actual sandbox. Camera accuracy is not inferred from synthetic tests.

## See also

[Desktop technical details](desktop-technical.md), [M3 findings](../findings/m3.md).

## Recording byte storage

`createDesktopRecordingStorage` adapts the optional preload `recordingStorage` function to recording storage and core ByteSink/ByteSource. Its `prepare` answers `Recordings are kept by the app. Download a copy to keep it elsewhere.` Each source it lists is registered in `libraryFiles`, so that `desktopSaveAs` has the main process copy that file. Append and flush allow one outstanding operation; calls resolve only after the main-process operation finishes. Reads are split into at most 4 MiB IPC requests. The main process owns paths and files. Close is idempotent after a successful close.

Large appends (including a final index) are split into sequential 4 MiB IPC chunks while the sink remains busy. `apps/web/src/recording-storage.test.ts` checks chunking, overlapping-call rejection and idempotent close.

## Photos and copies

`createDesktopPhotoLibrary(bridge)` is the desktop `PhotoLibrary`, through the preload's `photoStorage`: `list` maps each file to a photo whose `id` and `name` are the file name and whose `createdAt` is its time, `save` sends the name, bytes and `createdAt`, and `remove(id)` deletes the file. Its record type `DesktopPhoto` has the shape of `SavedPhoto` from `@irvis/ui`, which this package does not depend on.

`desktopSaveAs(bridge)` is the desktop `HostFiles.saveAs`: it calls the preload's `saveAs(name, what)` with `{ kind: 'recordings', name }` for a source of the recording storage (`libraryFiles`), so the main process copies the file, and with the bytes it reads otherwise (a photo, an MP4, a flattened PNG). A cancelled dialog resolves without saving. A preload without `saveAs` rejects with `Saving a copy is unavailable in this desktop app.` `apps/web/src/host-files.test.ts` covers both.

## Live backend integration

The preload interface also exposes optional `listDevices()`, `listModes(device)` (the `DeviceVideoMode`s a device reports, by its id) and `command(id, value?)` promises. The web adapter exposes commands on the current CameraSession and reports `exactRaw: true`, `deviceControl: true` when command dispatch exists, and `concurrentWith: [browser]` on macOS (empty elsewhere). Concurrent camera access still depends on OS drivers. Frame snapshots carry raw USB observations; see [desktop control](desktop-technical.md#camera-control).

`DesktopBridge.command(id, value?)` forwards an optional numeric setting. The preload sends only the command ID and value; main selects the profile transport and validates/encodes the value. No raw USB interface is exposed.

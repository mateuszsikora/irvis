# Browser backend: technical

## Data flow

`packages/backend-browser/src/index.ts` exposes `startDiagnostics`. It probes a dedicated module Worker before requesting media. With a main-thread `MediaStreamTrackProcessor` (Chrome/Edge), it reads one frame, calls `copyFrame`, transfers the copied ArrayBuffer to `worker.ts` (which installs `worker-runtime.ts`), and waits for the result before reading again. With only a worker processor (Safari), it transfers the MediaStreamTrack and reads/copies/reconstructs there. Both processor queues request `maxBufferSize: 1`. Browser capability detection, rather than user-agent matching, selects the path.

`frame.ts` requests exact width and height, the profile fps, `resizeMode: { exact: 'none' }` and an exact device ID when supplied. The exact resize constraint requires no cropping or scaling in browsers that support `resizeMode`; an unsatisfiable combination must fail capture rather than fall back to resizing. Unsupported constraint names can be ignored by browsers, so this request alone is not proof of sample preservation. The separate coded-dimension check detects size mismatches, but cannot detect resizing that already produced the requested dimensions. It records metadata even for rejected frames. It rejects mismatched coded dimensions and formats other than I420/NV12 before copying. `allocationSize` and `copyTo` receive a full coded rectangle, with no format or colour-space option; the returned plane offsets and strides are preserved. VideoFrame timestamps are converted from microseconds to core milliseconds. Every consumed VideoFrame is closed in a finally block.

`analysis.ts` calls core's `reconstructPlanar` in the Worker, with thermal rows from the selected mode. Brightness hints are disabled until the camera's upper image has been validated. The Worker returns the original buffer, statistics and `frame.reconstructed` (raw values and uncertainty mask), which the live renderer consumes without repeating reconstruction. Only the latest result is retained by `apps/web/src/Diagnostics.tsx`. Main-thread processing has one request in flight; the Safari worker processes sequentially. Stop cancels the reader and stops stream tracks. After a track transfer it sends `stop` to the Worker, which stops its own track, cancels its reader and acknowledges `stopped` after cleanup. The main thread terminates on acknowledgement or after a one-second fallback timeout; other paths terminate immediately. Cancelling startup clears the handshake timeout. Late permission results are stopped immediately. Worker failures and stream end stop capture.

## Schema

The versioned download format is specified in [browser diagnostics format](../browser-diagnostics-format.md). These exports contain unverified raw statistics, not an exact reference or accuracy verdict.

## Interfaces

- `startDiagnostics(mode, deviceId, callbacks)` returns a stop function immediately, including while permission is pending. Callbacks are `metadata`, `result` and `error`.
- `constraints`, `metadata`, `rejection` and `copyFrame` are the capture helpers. `Analysis` and `FrameMetadata` describe callback data.
- `deviceKey` is `irvis.browser.deviceId`. Storage failures do not block capture.

The web app adapts this capture API to core CameraBackend, lists media devices and passes the selected device ID to capture. Browser capabilities are `exactRaw: false`, `deviceControl: false`, `concurrentWith: []`. Hardware commands are unavailable.

## Configuration

The app chooses a thermal profile mode; dimensions, rate and thermal rows come from core. The TypeScript project references core and uses DOM types; the small processor declaration covers the API that TypeScript's DOM library does not expose. The Worker uses only APIs shared with its dedicated worker scope.

## Failure modes

Rejection messages appear in the [user document](backend-browser-user.md#outcomes). Additional messages are `This mode has no thermal data.`, `Camera access requires HTTPS or localhost.`, `Diagnostics worker did not start.` (five-second startup timeout), `No video track returned.` and `Camera stream ended.`. `Unknown error.` handles non-error objects without a message. `Diagnostics worker failed.` is the fallback for an empty worker error. `errorMessage` removes the generic `Error:` prefix, preserves browser exception names and includes the failed constraint in `OverconstrainedError (constraint: width)` (example with an empty browser message). No canvas or RGB fallback is used.

## Tests

`packages/backend-browser/test/frame.test.ts` checks capture constraints, rejection before copying, full coded rectangle copying without conversion and timestamp/layout preservation. `packages/backend-browser/test/session.test.ts` checks both processor routes, backpressure, cancellation during permission/copy, frame closing and stream-end handling. `worker.test.ts` checks worker cleanup, buffer return and errors; `analysis.test.ts` checks raw statistics on a synthetic scene; `errors.test.ts` checks browser error names and constraint details. The package has its own Vitest project and separate library/test TypeScript projects. Hardware, real browser worker exposure and track transfer require the [M3 owner run](../findings/m3.md).

## See also

- [Media Capture constraint selection](https://www.w3.org/TR/mediacapture-streams/#dfn-selectsettings)
- [WebCodecs copy options](https://www.w3.org/TR/webcodecs/#dictdef-videoframecopytooptions)
- [MediaStreamTrack processing](https://www.w3.org/TR/mediacapture-transform/)

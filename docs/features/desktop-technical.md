# Desktop app

## Data flow

`apps/desktop/src/main.js` registers `app://irvis/` before readiness and serves only `apps/web/dist` through `protocol.handle` and `net.fetch(file:)`. The scheme enables standard URLs, secure context, fetch, streaming; CORS is disabled by default. Paths are decoded and restricted to the build directory; other hosts and non-GET/HEAD requests are denied.

The sandboxed window has context isolation enabled and Node integration disabled. Its CSP allows app scripts, Workers, fetch and media, without disabling CSP. Navigation and new windows are denied. Media permission is granted only to the app window and app origin.

`preload.cjs` exposes only start, stop and subscription callbacks, never IPC events or arbitrary channel access. The main process validates sender, main frame, profile mode and numeric device index. It uses capture-cli's ffmpeg argument builder and executable discovery. No renderer argument becomes an executable path or arbitrary ffmpeg option.

Capture packs native bytes without pixel conversion. stderr must confirm native `yuyv422`; any other detected format stops capture. Format detection parses only newline-terminated log lines, retaining an incomplete suffix for the next stderr chunk, so a split format token is never treated as a different format. stdout is accumulated into fixed `width * height * 2` frames. Only one reference IPC message may be outstanding; preload acknowledges after callback processing, so surplus frames are dropped. Stop, main-frame navigation to a new document (including reload), renderer failure, window close and app quit terminate ffmpeg; a two-second timeout escalates to SIGKILL.

## Schema

The reference has `kind: yuyv`, profile dimensions, Uint8Array bytes, main-process monotonic `timestamp` and wall-clock `receivedAt`. Timestamps represent receipt, not camera exposure. The bridge start request contains only `profileId`, `modeId` and nonnegative integer `device`.

## Configuration

`IRVIS_FFMPEG` selects an executable; otherwise capture-cli searches PATH. Input is AVFoundation, limited to one hour per start. `IRVIS_TEST_CORS=1` enables the scheme's CORS privilege for the smoke experiment; production defaults to disabled. esbuild bundles the main process and CommonJS preload into `apps/desktop/dist`.

## Failure modes

Invalid IPC sources throw `Untrusted IPC sender`. Invalid mode/device throws `Invalid capture selection`. Other platforms throw `M3 capture currently requires macOS.` A different native format reports `Exact reference requires native yuyv422; received <format>`. Child errors and exit diagnostics are shown in the comparison status.

## Tests

`npm run test:desktop` builds both applications and runs Playwright's Electron smoke test. It checks bridge isolation, window preferences, module Worker, fetch, localStorage, a generated WebM video and CSP. ffmpeg must be installed to generate the temporary video. It also checks invalid capture selection and, on macOS, a fake ffmpeg process emitting a packed frame and a pixel-format log token split across writes, simulation metrics and the frame-pair download. The test holds back the format suffix to check that capture survives the partial token. It also verifies that reload terminates the old process and that a new capture can start and stop afterwards. A complete unsupported format still stops capture with an error. Hardware capture, simultaneous access and macOS privacy permissions require the owner procedure in [M3 findings](../findings/m3.md).

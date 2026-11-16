# Desktop app

## Data flow

`apps/desktop/src/main.js` registers `app://irvis/` before readiness and serves only `apps/web/dist` through `protocol.handle` and `net.fetch(file:)`. The scheme enables standard URLs, secure context, fetch, streaming; CORS is disabled by default. Paths are decoded and restricted to the build directory; other hosts and non-GET/HEAD requests are denied.

The sandboxed window has context isolation enabled and Node integration disabled. Its CSP allows app scripts, Workers, fetch and media, without disabling CSP. Navigation and new windows are denied. Media permission is granted only to the app window and app origin.

`preload.cjs` exposes device enumeration, profile commands, recording storage, start, stop and subscription callbacks, never IPC events or arbitrary channel access. The main process validates sender, main frame, profile mode and platform-specific device selector. `capture.js` builds ffmpeg arguments from the profile mode; capture-cli supplies executable discovery. No renderer argument becomes an executable path or arbitrary ffmpeg option.

Capture packs native bytes without pixel conversion. stderr must confirm native `yuyv422`; any other detected format stops capture. Format detection parses only newline-terminated log lines, retaining an incomplete suffix for the next stderr chunk, so a split format token is never treated as a different format. stdout is accumulated into fixed `width * height * 2` frames. Only one reference IPC message may be outstanding; preload acknowledges after callback processing, so surplus frames are dropped. Stop, main-frame navigation to a new document (including reload), renderer failure, window close and app quit terminate ffmpeg; a two-second timeout escalates to SIGKILL.

## Schema

The reference has `kind: yuyv`, profile dimensions, Uint8Array bytes, main-process monotonic `timestamp` and wall-clock `receivedAt`, plus the latest optional `cameraState` snapshot. Timestamps represent receipt, not camera exposure. The bridge start request contains only `profileId`, `modeId` and `device` (AVFoundation index, `/dev/videoN` path or DirectShow video name).

## Configuration

`IRVIS_FFMPEG` selects an executable; otherwise capture-cli searches PATH. Input is AVFoundation on macOS, V4L2 on Linux and DirectShow on Windows. Capture has no fixed duration limit. `IRVIS_TEST_CORS=1` enables the scheme's CORS privilege for the smoke experiment; production defaults to disabled. esbuild bundles the main process and CommonJS preload into `apps/desktop/dist`.

## Failure modes

Invalid IPC sources throw `Untrusted IPC sender`. Invalid mode/device throws `Invalid capture selection`. Invalid platform/device combinations throw `Invalid capture selection`. A different native format reports `Exact reference requires native yuyv422; received <format>`. Child errors and exit diagnostics are shown in the comparison status.

## Tests

`npm run test:desktop` builds both applications and runs Playwright's Electron smoke test. It checks bridge isolation, window preferences, module Worker, fetch, localStorage, a generated WebM video and CSP. ffmpeg must be installed to generate the temporary video. It also checks invalid capture selection and, on macOS, a fake ffmpeg process emitting a packed frame and a pixel-format log token split across writes, simulation metrics and the frame-pair download. The test holds back the format suffix to check that capture survives the partial token. Its fake ffmpeg continues emitting frames after the first fragmented frame, respecting stdout backpressure, because real capture may drop startup frames. It also verifies that reload terminates the old process and that a new capture can start and stop afterwards. A complete unsupported format still stops capture with an error. Hardware capture, simultaneous access and macOS privacy permissions require the owner procedure in [M3 findings](../findings/m3.md).

## Local recordings

`src/recordings.js` installs `recording:storage` handlers using the same main-frame sender authorization as capture. Files live in the `recordings` directory under Electron `userData`; renderer-supplied names must be alphanumeric/dot/underscore/hyphen and end in `.irvis`, `.pcm` or legacy `.webm`. Exclusive creation prevents overwrites. Writes handle short writes and reject concurrent requests; each append is limited to 4 MiB. Flush calls `FileHandle.sync`, and close syncs before releasing the file. The renderer recorder flushes every accepted thermal frame and audio packet, and stops accepting thermal frames if an append/flush takes more than one second. Listing includes unfinished files for scanner recovery. Remove rejects open sinks. Renderer termination closes idle handles and marks busy handles for sync/close when their current operation settles.

The desktop smoke test checks the packaged AudioWorklet under the app CSP, PCM sidecar listing/deletion, recording append/flush/close, byte-range reads, deletion and rejection of a traversal filename through the real preload IPC bridge, in addition to its existing capture and isolation checks.

Replacing the main-frame document (including reload) also stops capture and closes recording sinks. Storage cleanup increments a session generation, marks all old sinks before yielding and waits for in-flight opens/writes to sync and close. New IPC requests await this cleanup; requests that crossed the session boundary before opening a file reject with `Recording session closed.` Same-document navigation does not retire the session. Cleanup snapshots the old entries so later recordings cannot be closed by an earlier cleanup loop. The desktop smoke test leaves a valid recording unfinished and its handle open, reloads, recovers the thermal frame, deletes the file and reuses its name in the new session.

## Camera control

`control.js` opens the one USB device matching the selected profile; ambiguous USB matches disable control. The current driver supports `infiray-p2pro`. It serializes transactions using the existing `CameraUsb` protocol, reads state before capture and after commands, and polls `cur_vtemp` approximately every second without overlapping polls. Frames are dropped during transactions. Commands accept only profile command IDs; renderer bytes and arbitrary transfers are never accepted. On macOS the build compiles the existing IOKit helper into `dist/iokit-request`; other platforms use node-usb without claiming or detaching UVC. USB failures leave video available with assumed state, unless the mode requires an enable command. Command attempts without control reject with `Camera control is unavailable`.

Snapshots contain `gain` (`high`/`low`, or `unknown` when the read fails or returns a value other than 0/1), raw TPD values under `usb-` keys, and hexadecimal `usb-pseudo_color` and `usb-cur_vtemp`. Failed reads omit other fields; these raw fields are not interpreted as software correction values. A failed periodic read removes stale sensor bytes. Unknown gain blocks temperature conversion until a successful full state read (on reconnect or after another command); sensor-only polling cannot restore it. Closing capture cancels polling and closes USB after in-flight work settles. A generation check prevents an obsolete asynchronous open from launching ffmpeg.

`src/permissions.js` runs during build on macOS. It requires the Xcode command-line C compiler, builds the helper and sets `NSCameraUsageDescription` in the development Electron.app Info.plist to `irvis uses the camera to display and record thermal images.` Release packaging must preserve this key in its own application bundle.

The `desktop` Vitest project tests per-platform input arguments, exact output, rejected selectors, USB ambiguity, command allow-listing, state reads, polling and cleanup with a fake USB device. Real camera capture and USB permissions on Linux/Windows remain hardware verification work.

The smoke test runs the packaged microphone AudioWorklet in an OfflineAudioContext for exactly 2048 frames and checks that its message contains nonzero oscillator samples. This verifies loading and execution under the app CSP without relying on a real-time audio output device. It does not verify microphone permissions or hardware audio timing. Frame-pair export waits for Electron's DownloadItem `done` event with state `completed` before parsing JSON; file existence alone does not establish download completion.

# Media

## Data flow

`packages/media` is a DOM-capable browser package. `fileByteSource` reads slices from picked Blob/File inputs. `createBrowserRecordingStorage` provides host-injected recording storage; UI code does not choose browser versus Electron persistence.

`createRecorder` uses core `IrvisWriter`. It flushes the header, then clones one accepted thermal frame and its view metadata. Every accepted frame is flushed before accepting another; submissions during append/flush return false and allocate no queue. The writer preserves supplied timestamps; the live UI supplies host receipt timestamps on the shared audio clock. Stop awaits pending work, writes the index and closes the sink. A one-second deadline on each append/flush stops submissions and reports `Recording storage is too slow; recording stopped.` Storage failures likewise report through the callback and make stop reject.

Consequently there is at most one accepted thermal frame outside the durable prefix, rather than up to one second of queued frames. Idle writers have no dirty frames. Normal camera cadence plus the one-second deadline bounds the uncommitted tail to about one second; a stalled disk fails the recording instead of allowing that tail to grow. This relies on the filesystem honoring flush/fsync, as any crash-safe application must. The browser test kills the renderer without Stop and checks that the recovered final frame is less than one second before the crash. Unit tests model loss of all unflushed bytes and a permanently stalled operation.

The browser adapter requests persistence and estimates uncompressed capacity before recording. The UI refreshes this estimate on every start (including a conservative PCM allowance when audio is enabled) and removes files from failed or cancelled setup. OPFS files live under `irvis-recordings`. A module Worker opens `createSyncAccessHandle`, handles partial writes, flushes and closes. Only one request may be outstanding; concurrent requests reject. Opening an existing name rejects rather than overwriting it. Listing includes unfinished files; core's scanner recovers complete records. Without OPFS (`navigator.storage.getDirectory`), `createBrowserRecordingStorage()` returns undefined: the host passes no recording storage and recording is unavailable, rather than kept in memory and lost with the page. A browser exposing OPFS but lacking synchronous Worker handles reports an error.

`exportMp4` reads `.irvis` frames sequentially, accumulates view-state changes, calls a supplied renderer and awaits each Mediabunny `CanvasSource.add`. H.264 uses WebCodecs, with a 4 Mbps target. Silent exports contain only video. Optional audio comes from version 2 mono PCM packets recorded by an AudioWorklet. Each packet carries its host-clock timestamp and CRC, and is flushed before acknowledgment; at most two packets are outstanding. Export crops/pads audio to the thermal timeline, resamples to 44.1 kHz and encodes AAC at 128 kbps. Microphone tracks stop immediately on Stop, errors or unmount. See [audio sidecar format](../audio-sidecar-format.md) for timing, recovery, queue limits and version 1 compatibility. Export buffers its result in memory. `saveRecordingFile(name, source)`, the browser's `HostFiles.saveAs`, streams a ByteSource to a save picker in 1 MiB chunks during a click (`navigator.userActivation.isActive`), or creates a download Blob when the picker is unavailable. A cancelled picker (`AbortError`) resolves without saving; any other picker failure rejects. `test/files.test.ts` covers the missing OPFS and the cancelled picker.

## Configuration

Mediabunny is distributed under MPL-2.0 (the installed package's LICENSE); no library source is modified. Its transitive WebCodecs declarations conflict with TypeScript 6's DOM declarations, so only the media package disables declaration-library checking and adds `ESNext.Disposable`. Application source remains strictly checked.

## Failure modes

Invalid offsets and lengths throw `Invalid byte range.` A Worker sink rejects overlapping or closed calls with `Storage is closed or busy.` Storage quota and permission errors propagate to the viewer. Export without WebCodecs throws `MP4 export requires WebCodecs VideoEncoder.` Empty recordings throw `Recording contains no complete frames.`

## Tests

`test/recorder.test.ts` covers bounded submissions, independent frame copies, lossless values, supplied timestamps, durable-prefix crash recovery, the one-second stall deadline, and Blob slicing. `test/audio-sidecar.test.ts` checks packet alignment and recovery at every truncated tail offset. `test/browser.mjs` uses Playwright Chromium and ffprobe to exercise OPFS recording, playback, silent/audio MP4, track cleanup, annotations and deletion.

## See also

- [Recording user guide](media-user.md)
- [File format](../irvis-format.md)

The Playwright flow also reloads during recording and verifies scanner recovery, and injects a denied microphone permission to verify that recording does not start. Deletion removes `.irvis` first and then its audio sidecar; a sidecar deletion failure is reported and can leave an orphan audio file. There is no cross-file filesystem transaction.

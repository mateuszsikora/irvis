# Media

## Data flow

`packages/media` is a DOM-capable browser package. `fileByteSource` reads slices from picked Blob/File inputs. `createBrowserRecordingStorage` provides host-injected recording storage; UI code does not choose browser versus Electron persistence.

`createRecorder` uses core `IrvisWriter`. It clones one accepted thermal frame and its view metadata, rejects new submissions while an operation is pending, and returns false for dropped frames. The writer retains original timestamps. A wall-clock timer flushes idle writers every second, supplementing core's timestamp-based flush. Stop awaits pending work, writes the index and closes the sink; failures are reported through the supplied callback and stop rejects. Disk stalls can delay durability beyond one second; no strict bound is claimed during a stalled write.

The browser adapter requests persistence and estimates uncompressed capacity before recording. OPFS files live under `irvis-recordings`. A module Worker opens `createSyncAccessHandle`, handles partial writes, flushes and closes. Only one request may be outstanding; concurrent requests reject. Opening an existing name rejects rather than overwriting it. Listing includes unfinished files; core's scanner recovers complete records. Without OPFS, an in-memory map holds copied chunks, and the preparation notice warns before recording. A browser exposing OPFS but lacking synchronous Worker handles reports an error; it does not silently switch to memory.

`exportMp4` reads `.irvis` frames sequentially, accumulates view-state changes, calls a supplied renderer and awaits each Mediabunny `CanvasSource.add`. H.264 uses WebCodecs, with a 4 Mbps target. Silent exports contain only video. Optional audio comes from a WebM/Opus sidecar recorded with `startMicrophone`; export decodes it through AudioContext at 44.1 kHz and encodes AAC at 128 kbps. Microphone tracks stop immediately on Stop, errors or unmount. Pending audio is bounded to two chunks (including the final Stop chunk); slow storage stops recording with an error. Sidecar naming and approximate synchronization are specified in the architecture decisions. Export buffers its result in memory. `saveRecordingFile` streams a ByteSource to a save picker in 1 MiB chunks, or creates a download Blob when the picker is unavailable.

## Configuration

Mediabunny is distributed under MPL-2.0 (the installed package's LICENSE); no library source is modified. Its transitive WebCodecs declarations conflict with TypeScript 6's DOM declarations, so only the media package disables declaration-library checking and adds `ESNext.Disposable`. Application source remains strictly checked.

## Failure modes

Invalid offsets and lengths throw `Invalid byte range.` A Worker sink rejects overlapping or closed calls with `Storage is closed or busy.` Storage quota and permission errors propagate to the viewer. Export without WebCodecs throws `MP4 export requires WebCodecs VideoEncoder.` Empty recordings throw `Recording contains no complete frames.`

## Tests

`test/recorder.test.ts` covers bounded submissions, independent frame copies, lossless values and original timestamps, and Blob slicing. `test/browser.mjs` uses Playwright Chromium and ffprobe to exercise OPFS recording, playback, silent/audio MP4, track cleanup, annotations and deletion.

## See also

- [Recording user guide](media-user.md)
- [File format](../irvis-format.md)

The Playwright flow also reloads during recording and verifies scanner recovery, and injects a denied microphone permission to verify that recording does not start. Recovery is tested at one flush boundary; this is not a measured worst-case durability guarantee. Deletion removes `.irvis` first and then its audio sidecar; a sidecar deletion failure is reported and can leave an orphan audio file. There is no cross-file filesystem transaction.

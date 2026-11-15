# Browser diagnostics

The browser diagnostics inspect what a browser receives from a thermal camera and attempt reconstruction. They do not establish temperature accuracy.

## Inspect a camera

Run `npm run spike:m3:web` from the repository root and open the printed localhost address in Chrome, Edge or Safari. Choose the profile mode, click **Refresh cameras**, choose your camera, and click **Start diagnostics**. Grant camera permission. Before permission, camera labels may be blank; after starting, stop and refresh if you need to choose a different camera. The selected device is remembered when browser storage is available. If a saved device disappeared, select another one or the default camera.

Capture requests the profile dimensions with resizing forbidden. A browser supporting that restriction rejects cameras that cannot supply the requested size without cropping or scaling. Browsers may ignore unsupported restrictions; matching frame dimensions alone do not establish that bytes were preserved.

The panel shows format, coded dimensions, visible rectangle, colour space, processed fps and reconstruction statistics in raw units. FPS measures processed frames using source timestamps, not the camera's complete delivery rate; slow reconstruction drops frames. Uncertain pixels remain included in these diagnostic statistics. **Stop** releases capture. Downloads remain available until the next start.

## Save evidence

**Download report** saves `m3-report.json`, including browser identity, mode, frame count, timing, last frame metadata and statistics. **Download planar frame** saves `m3-planar.json`, containing the most recently processed frame's original copied bytes and plane layout for offline analysis. Each click saves one frame, not a recording. See the [owner procedure](../findings/m3.md) for simultaneous capture-cli measurements.

## Outcomes

- `Reconstruction is experimental; accuracy is not verified.` means supported planar bytes were processed. It does not prove that the browser preserved the camera's range or chroma.
- `Frame size mismatch: got 256×192, expected 256×384; reconstruction cannot start.` is an example of a rejected size; the message includes actual and expected dimensions.
- `Unsupported frame format: got RGBA; only I420 and NV12 can be reconstructed. RGB data cannot be recovered.` is an example of a rejected format. The reported format can also be `null` for opaque frames.
- `use Chrome, Edge or Safari` means no supported track processor was found, including Firefox without that API.
- `No thermal profile mode is available.` disables Start when no thermal mode is registered.
- `OverconstrainedError (constraint: width)` identifies a failed exact constraint (the name varies, for example `height`, `resizeMode` or `deviceId`); a browser explanation follows when available.
- Permission and device errors appear in the status area. Camera access requires localhost or HTTPS.

## See also

- [Technical details](backend-browser-technical.md)
- [Web app](web-app-user.md)

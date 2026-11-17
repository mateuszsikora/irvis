# Web app

`apps/web` is the one UI build of irvis: the desktop app loads it, and it is to be published as the web version ([#54](https://github.com/mateuszsikora/irvis/issues/54)). It provides a thermal viewer with synthetic demo and live capture, supported camera profiles, and experimental browser diagnostics.

## Open the web version

The web version is not published. `netlify.toml` and "Promote to release" ([development guide](../guides/development.md#promote-to-release)) were written for a Netlify site, but the repository is not connected to Netlify and will not be, so pull requests get no deploy preview either. Publishing on GitHub Pages is [#54](https://github.com/mateuszsikora/irvis/issues/54). Until then, [run it locally](#run-it-locally).

## Supported browsers

The web version needs a desktop browser that hands camera frames to the page as `VideoFrame`s (`MediaStreamTrackProcessor`). The minimum versions come from browser compatibility data, not from tests in those versions.

| Browser | Systems | Minimum | Tested |
| --- | --- | --- | --- |
| Chrome | macOS, Windows, Linux | 111 | 157 on macOS, with the TOOLTOP T7 ([M3](../findings/m3.md)) |
| Edge | macOS, Windows, Linux | 111 | not tested |
| Safari | macOS | 18 | 27.0.1 on macOS, with the TOOLTOP T7 ([M3](../findings/m3.md)) |
| Firefox | none | not supported | n/a |
| Any browser on iPhone, iPad or Android | none | not supported | n/a |

- **Chrome and Edge 111** is the build target: `apps/web/vite.config.ts` does not set `build.target`, so Vite 8 uses its default, `'baseline-widely-available'` (`chrome111`, `edge111`, `firefox114`, `safari16.4`), and an older browser may fail to run the page. A Vite upgrade can raise these versions. Live capture itself needs `MediaStreamTrackProcessor` (Chrome and Edge 94).
- **Safari 18** is the first Safari with `MediaStreamTrackProcessor`. Safari offers it only inside a Worker, so the page moves the camera track into a Worker and reads frames there.
- **Firefox** has no `MediaStreamTrackProcessor`, so Live camera cannot read the camera and shows `use Chrome, Edge or Safari`.
- **Mobile browsers** are out of scope and not tested.

Some features need more than the minimum:

- MP4 export of a recording with microphone audio needs WebCodecs `AudioEncoder` with AAC. Safari has `AudioEncoder` from version 26. Chrome 157 on macOS reports AAC as supported (`AudioEncoder.isConfigSupported` with `mp4a.40.2`, 44.1 kHz, mono, 128 kbit/s, checked in headless Chrome on 2026-11-17); a full export with audio was not run in it. Chrome and Edge elsewhere have not been checked. Where AAC encoding is missing, the export fails; it does not fall back to an MP4 without audio. MP4 export without audio needs `VideoEncoder` with H.264 (Chrome and Edge 94, Safari 16.4).
- Choosing where a recording is saved needs `showSaveFilePicker`, which only Chrome and Edge have; other browsers download the file instead.
- Camera access needs HTTPS or localhost.

Even in a supported browser, the web version shows less than the desktop app: temperatures are rebuilt from the 4:2:0 video frames the browser delivers instead of read exactly ([browser diagnostics](backend-browser-user.md)), readings assume high gain until you declare the camera mode ([viewer](ui-user.md#declare-the-browser-camera-mode)), and camera commands are available only in the desktop app.

## Run it locally

```sh
npm ci
npm run dev --workspace @irvis/web
```

Vite prints the local address (by default `http://localhost:5173/`) and reloads the page on every change. `npm run build --workspace @irvis/web` writes the production build to `apps/web/dist/`, and `npm run preview --workspace @irvis/web` serves that build.

## What the page shows

- The heading `irvis`, Thermal studio, and source/profile controls.
- While no camera profile is registered: `No camera is supported yet.`
- Registered cameras appear in Camera profile.

## Inspect browser capture

The panel is included in the regular web build, not limited to the local spike command.

The **Browser diagnostics — M3** panel inspects camera frames and exports evidence. See [Browser diagnostics](backend-browser-user.md) for camera selection, controls and limitations.

## See also

- [Web app: technical](web-app-technical.md)
- [Cameras](cameras-user.md)

## View thermal images

The home page now offers Demo or Live camera, camera profile selection and the shared [thermal viewer](ui-user.md). Demo needs no camera. Changing Source or Camera profile clears the previous capture error; late errors from the old selection do not appear in the new view. Expand Capture diagnostics to use the existing diagnostic tools after stopping the viewer.

## Recognize the app

The full header logo pairs dark `ir` on amber with light `vis` directly on the app background; narrow screens use the compact amber `ir` mark. The browser tab also uses the compact `ir` mark. Both identify the same app.

# Viewer UI

## Data flow

`packages/ui/src/Viewer.tsx` receives a `CameraBackend`, `CameraProfile` and optional command dispatcher. It owns connection/configuration state and a first-frame flag; frames never enter React state. The session subscription retains the latest frame and a requestAnimationFrame loop invokes `FrameRenderer.draw` in `src/render.ts`. The drawing loop also detects settings changes and redraws the retained frame after Stop, without a new capture session. Cleanup unsubscribes, cancels drawing and closes capture; a generation counter closes late open results after stop or unmount.

`FrameRenderer` decodes YUYV or reconstructs planar frames using the selected mode's thermal rows, converts raw values using the declared gain, then uses core `autoRange` and `renderPalette`. Thermal replay frames carry their own conversion. Uncertain pixels do not affect automatic bounds. A private canvas supplies pixels to a transformed visible canvas; CSS controls enlargement and interpolation. The scale uses the same palette and applied bounds. Bounds and consistency messages update directly through DOM refs. All-uncertain scenes keep previous bounds and show `No certain temperature readings.`

## Interfaces

`ViewerProps.backend` and `.profile` are required. `captureError` optionally supplies the current adapter error to the same alert/status presentation as local errors. `command` is optional and used only if `capabilities.deviceControl` is true and a session is open. The app remounts the viewer on source/profile changes. Initial display: iron palette, automatic 20–40 °C fallback range, unlocked scale/orientation, 0° rotation, no mirroring or uncertain overlay, Clear rendering, Fit size, assumed high gain. Manual invalid edits never reach the renderer.

## Failure modes

Connection and drawing errors appear in an alert. Unsupported gain clears the image and replaces bounds with `Readings unavailable`; it never silently uses high gain. Plausibility checks compare certain scene extrema with profile measurement ranges, so they are advisory only. Camera control requires an explicit dispatcher: no fabricated USB commands are sent. Browser capture errors from the app adapter appear below the preview; Stop then Start retries capture.

## Tests

`test/viewer.test.tsx` covers ordered bounds, six palettes, declaration without commands, disabled hardware controls, orientation lock and late-open cleanup. `test/render.test.ts` checks locked bounds across scenes, excluded uncertain extrema, overlay and transforms. Actual camera access and visual interpolation need manual verification with hardware.

## See also

- [User guide](ui-user.md)
- [Web integration](web-app-technical.md)

## Workspace presentation

The viewer uses a preview column and a 300 px settings panel, stacking below 760 px. The canvas fits a bounded viewport with preserved aspect ratio at every rotation. Zoom changes both CSS dimensions and permits scrolling. Palettes use the core palette stops as CSS gradient previews; buttons expose `aria-pressed`. Binary display choices and orientation also use native buttons, and switches retain native checkbox semantics. Camera configuration remains in native selects with explicit accessible names. `apps/web/src/viewer.css` reserves space for select arrows, provides focus rings and reduced-motion support. The first-frame flag updates once per session; live pixels and range labels stay outside React state. `Icon.tsx` supplies decorative inline SVG controls.

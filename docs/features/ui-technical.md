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

## Measurement analysis

`measurements.ts` stores objects in unrotated image percentages and converts them to bounded integer pixels with `geometry`. `analyze` uses core point/line/area/frame statistics; centre and point markers require `centreCounted`. Object IDs are monotonic within the controls, and clear/delete do not modify tracking. `AnalysisControls.tsx` owns draft correction and threshold inputs; only valid committed edits reach `ViewSettings.analysis`. All objects coexist without a count cap. Coordinates provide accessible movement and rectangle resizing without requiring pointer gestures.

`FrameRenderer` corrects thermal frames relative to their recorded camera state using `correctFrame`; untouched correction uses `settingsFromCamera`. Raw capture without camera metadata assumes no camera-side correction. Corrected values feed palette bounds, measurements, isotherms and the core alarm evaluator (high threshold, 0.5 K hysteresis). Region highlighting greyscales the surrounding pixels after isotherms; the optional uncertain overlay is painted last. Measurement shapes and certain markers are drawn on the source canvas before orientation transforms. Readouts update through a DOM ref, without storing frame arrays in React. Alarm trigger changes update React state; an effect owns the oscillator and disconnects it on disable, Stop, error or unmount. Unsupported conversions clear readouts and turn off the alarm.

`Open thermal photo` reads PNG/snapshot bytes through `IrvisReader`, requires exactly one frame, closes live capture, clears objects and resets host correction to the stored camera state. Generation checks ignore obsolete loads. No captured overlays become objects. It is the initial analysis entry point for #19, whose gallery and capture workflow are not yet implemented. The current palette is used rather than restoring saved presentation metadata.

Tests in `test/viewer.test.tsx` cover object counts, deletion/reset, coordinate edits, unit changes, parameter validation, photo loading and audio cleanup. `test/measurements.test.ts` covers local extrema, uncertain markers and geometry. Actual speaker output and camera accuracy require manual verification.


Alarm lifetime follows the source generation attached to each retained frame. The viewer rejects alarm results and late subscription emissions belonging to an obsolete generation, resets the React trigger on Stop/Start, and passes `ViewSettings.alarmGeneration` to the renderer. `FrameRenderer` resets core hysteresis when that generation changes. Display-only redraws of a retained frame after Stop remain possible but cannot trigger a live alarm in a new session before its first frame. Stopping photo analysis disables the alarm without discarding the photo or objects; re-enabling the switch resumes analysis of the retained photo.

Photo import errors use separate `photoError` state and the `Photo import failed:` alert prefix. They do not set the source failure status or mute its oscillator. `test/alarm-lifecycle.test.tsx` covers rejected imports, Stop/Start before new frames, obsolete frame emissions, and photo Stop/re-enable. `test/render.test.ts` verifies that hysteresis persists within a source but resets across source generations.


The viewer derives one current-source `failure` for both status and audio. Adapter `captureError` applies only when no photo is loaded; successful photo loading clears local errors, and subsequent photo rendering errors remain active. Returning to capture restores adapter error handling. `test/alarm-lifecycle.test.tsx` covers a pre-existing capture error, late capture errors during photo analysis, return to camera error handling and photo rendering failures.

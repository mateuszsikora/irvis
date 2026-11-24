# Thermal viewer

The viewer shows live thermal images or a synthetic demo with simple English controls.

## Start a view

In the header, pick the Source: Demo (the default) or one of the cameras connected to the computer, listed by name. Then check Video mode next to it and Camera profile next to Start, and press Start. Stop releases the capture. Changing the Source, Camera profile or Video mode closes the previous session. A camera uses Electron when its preload API is present; otherwise it uses the browser. Source lists the native video devices (ffmpeg's list) in the desktop app, and Default camera plus the browser's media devices on the web. A browser shows camera names only after it has been given camera access, so on the web press the refresh button next to Source after the first Start. Open Capture diagnostics for the existing capture diagnostics (stop the viewer first).

## Navigate the workspace

The header holds Source, a refresh button with circular arrows (tooltip and accessible name `Refresh cameras`; the arrows spin while the list loads) and Video mode. Camera profile sits in the row below, left of Start and Stop; with Demo, `Synthetic scene · no camera needed` stands before it. Video mode lists only the modes that carry temperature data, as width × height · fps, for example `256 × 384 · 25 fps`. Start and Stop sit above the image with Ready, Connecting, Waiting for frames, Live, Demo running, Paused or Capture error status. Until the first frame arrives, an empty view explains how to begin. After Stop, the last frame stays visible as a paused image; palette, range and orientation controls continue to update it.

The image, temperature scale and display toolbar occupy the main area. The right panel holds palettes, range and orientation; on narrow screens it moves below the image. Clear/Smooth, Automatic/Manual and rotation angles use directly visible buttons with a selected state. Camera commands is an expandable section. `Capture photo` and `Gallery` appear below the image; Video remains labelled Soon. Measurement controls are in the settings panel.

## Adjust the image

Choose a palette swatch in the View settings panel: Iron (default), White Hot, Black Hot, Rainbow, Red Hot or Cold Blue. All six previews are visible without opening a menu. Automatic range follows certain scene extrema. Lock scale holds the current bounds while the scene changes. Manual mode offers lower and upper bounds in °C; Apply bounds accepts only finite, ordered bounds. Invalid input leaves the last applied range intact. The colour bar and its labels show the applied range.

Clear (default) uses nearest-neighbour scaling; Smooth uses browser interpolation. These are independent rendering choices, not a reproduction of the vendor's unknown TisoView algorithm. Scale offers 50%, Fit (default) and 200%, with scrolling for large images. Rotation offers 0°, 90°, 180° and 270°. Both mirror axes are independent. Lock orientation disables rotation changes: desktop/browser windows have no Android device-orientation tracking, so this locks the selected image angle instead. Uncertain pixels marks them in magenta; off by default.

## Declare the browser camera mode

The browser displays `camera mode unknown, readings assume high gain`. It assumes factory settings. Confirm camera mode and factory settings, or choose Declared gain. This is a software declaration, not a USB command. Declaring a gain that has no conversion in the profile replaces the image and readings with `No verified conversion for this mode. Readings unavailable.`; the P2 Pro profile has conversions for both gains ([limits](cameras-user.md#supported-cameras)). Out-of-range readings show `Data look inconsistent with the declared camera mode. Check gain and factory settings.` This heuristic cannot prove camera state or detect every mismatch.

## Find camera and capture tools

Expand Camera commands in View settings. Commands come from the profile and require backend support and an active session. The browser shows them disabled with `available in the desktop app` and Download desktop app. In the desktop app they send USB commands to the camera ([camera correction](#change-camera-correction)). `Capture photo` saves the rendered thermal image, and `Gallery` opens saved photos. Recording is described in [Record, play and export video](#record-play-and-export-video).

## See also

- [Technical details](ui-technical.md)
- [Replay demo](backend-replay-user.md)

## Measure temperatures

Use `Add point`, `Add line` and `Add area` to add independent objects. There is no fixed count limit; three of each can coexist. Select an object in `Selected object` and edit its coordinates in percent of the unrotated image. Points use x/y; lines and rectangles use two ends. Change the ends to move or resize an object. `Delete selected` removes one object. `Clear measurements` removes all added objects and preserves the independent `Track min`, `Track max` and `Track centre` preview shortcuts. This reset does not calibrate the shutter (NUC).

Readings appear below the preview. Points and the centre use a 3×3 neighbourhood mean; a point whose own pixel is uncertain shows `–` and has no marker. Lines and areas show their local minimum and maximum. Extrema skip uncertain or unavailable readings. `Highlight selected area` keeps the selected rectangle in colour and makes its surroundings greyscale. Orientation transforms apply to the image and overlays together.

`Temperature unit` selects °C, °F or K for readouts, colour bounds and alarm thresholds. Manual palette bounds and correction inputs retain their explicitly labelled °C units. Alarm thresholds accept negative values and one decimal place. Commit a threshold with `Apply threshold`; `Enable alarm` is separate from triggering. The status distinguishes `Alarm disabled`, `Alarm enabled — below threshold` and `Alarm triggered`. Certain pixels at or above the threshold trigger it, with 0.5 °C hysteresis. Sound plays only while triggered during capture or photo analysis, and stops on disable, Stop or leaving the viewer. After Stop → Start, the alarm waits for a frame from the new session; a retained image cannot trigger it. In photo analysis, `Stop` disables `Enable alarm` and silences sound while keeping the photo and measurement objects editable. Re-enable the alarm explicitly to resume photo warnings. Browser audio permission may be needed. `Isotherm above threshold` paints matching certain pixels red independently of the alarm switch.

## Apply host correction

Initially the viewer preserves the camera correction stored with thermal frames. Desktop exact capture uses the correction read from the camera. Browser capture still requires declared factory settings. Edit emissivity (0.01–1.00), offset (-20–20 °C) and reflected temperature (-20–120 °C), then press `Apply correction`. Invalid or blank inputs cannot be applied. These inputs use the core fourth-power host model relative to the stored camera state, so an existing camera correction is not applied twice. If the desktop app cannot read the camera's emissivity or reflected temperature, the viewer shows "Camera correction could not be read. Readings are shown as the camera reported them; Host correction is not applied." Readings, photos and recording continue with the camera's own correction, and Host correction resumes once a later read succeeds: the app retries after 1 second, then less often, up to every 30 seconds.

`Reset parameters` explicitly applies emissivity 1, offset 0 and reflected temperature 25 °C, matching the reference reset. Core's general default reflected temperature remains 20 °C; the viewer's reset deliberately uses 25 °C. Ambient temperature is displayed as 25 °C but disabled with `Ambient correction unsupported. No camera commands are sent.` It has no effect. This is the host panel; desktop camera ambient temperature is separately available under `Camera commands`.

## Analyze a saved photo

Choose `Open thermal photo` and select an irvis PNG containing temperature data or a one-frame `.irvis` snapshot. Loading stops live capture and starts a fresh set of editable objects on the stored temperatures. A previous camera capture error does not appear in photo analysis or silence its alarm. Errors rendering the photo still appear and silence the alarm. Returning with `Start` restores camera error reporting. Ordinary PNGs without temperature data are rejected with `Photo import failed:` followed by the reader error. A rejected import leaves the current source and its alarm running. Add and edit points, lines and areas just as for a live frame. Captured overlays are not imported as editable objects; the viewer renders a fresh thermal image. `Start` returns to capture. Annotations and video workflows remain part of #19. Valid saved host corrections are restored; captured overlays remain pixels in the original file, not editable objects. Opening a photo resets display rotation and mirrors because its thermal pixels already follow the saved orientation.


## Capture and reopen a photo

After a frame is displayed, press `Capture photo`. The saved PNG includes the visible palette, isotherm, measurement shapes and markers at the image's native resolution; CSS zoom, surrounding controls and text below the preview are not part of the image. Its lossless thermal data use the same rotation and mirrors as the captured pixels. The source data stay uncorrected and the host correction is stored separately, so analysis does not apply a correction twice.

`Saving photo…` becomes `Saved <filename>` only after storage commits, and the photo gallery opens. Each capture creates a separate file, including captures made while analyzing another photo. The original is never overwritten. `Photo capture failed:` reports rendering or storage failures without stopping live capture. Hosts without photo storage show `Photo storage is unavailable in this host.`

The photo-only gallery shows previews and `Analyze`, `Download` and `Delete` actions for each filename. Analyze starts with no added measurement objects; add new points, lines and areas as usual. Download keeps a standard PNG with temperature data, not a flattened export. Delete removes that gallery record immediately; it does not remove downloaded files or close an already open analysis. A failed deletion keeps the entry visible and reports `Gallery error:`. Close and reopen Gallery to retry a failed list operation.

The app saves photos locally in this browser/site or desktop app profile. They survive reloads and camera/profile switches, but clearing app/site data or browser eviction can remove them. Download important photos for backup. Gallery contents are not synchronized between the browser and desktop app.

## Record, play and export video

The Recordings section supports `.irvis` capture, playback, microphone audio and MP4 export. See the [recording guide](media-user.md) for storage notices, thresholds and backup options. Gallery filter selects All, Photos or Videos. Recording thumbnails are previews; a black image alone does not mean the file is damaged. Open the recording to inspect it.

## Annotate a saved photo

In Gallery, choose **Annotate** beside a photo. Pick an annotation colour and size. Enter text, then click its position; leave text empty to draw with the pointer. **Undo annotation** and **Redo annotation** change only the annotation draft. **Export flattened PNG** saves a separate image without temperature data. Keep the original photo for temperature analysis; annotations never overwrite it. Draft annotations are not retained after leaving the editor.

Opening a recording restores its saved temperature correction. Playback and seeking follow saved correction changes. **Apply correction** or **Reset parameters** overrides that correction for the currently open recording; the override remains when seeking. Reopen the recording to follow its saved correction again. Files without saved correction use their recorded camera correction unchanged.

Desktop Camera commands use the selected profile’s allow-list. They require USB access to exactly one matching camera. Unavailable USB access reports `Camera control is unavailable`; browser commands remain disabled. Camera state is read on connect and after commands. Selecting a gain without a verified conversion disables readings.

After plugging in a camera, press the refresh button next to Source and pick it in Source. Refreshing does not stop a running capture. The selected camera is recognised by its name: if it moved to another place in the list, it stays selected. A selected camera that is no longer listed stays selected as `<name> (disconnected)`, for example `USB Camera (disconnected)`, and Start is disabled until it is listed again or you pick another source; another camera that took its place in the list is never chosen instead. If listing fails, the page shows `Cameras unavailable:` followed by the reason, for example `Cameras unavailable: Camera access requires HTTPS or localhost.` on the web over plain HTTP, also while Demo is selected, because it explains why Source lists no camera. If the camera's gain cannot be read, readings stay unavailable until a successful state read after reconnecting or sending another camera command.

## Change camera correction

In the desktop app, start the camera and open `Camera commands`. The panel shows the reported gain and current values separately from requested values. Set camera emissivity or atmospheric transmittance from 0.5 to 1 (resolution 1/128), or reflected temperature from −20 to 120 °C and ambient temperature from −20 to 50 °C (whole-kelvin resolution), then press the corresponding Apply button. Requests are rounded to the camera's resolution and confirmed by readback. The initial requested values are 1 for ratios and 26.85 °C for temperatures; they are not a claim about the connected camera's current values.

These settings change thermal data in the camera. Unedited readings preserve that correction; Host correction edits emissivity relative to the camera setting using the documented approximate model. On the tested TOOLTOP T7, settings survive connection close/open but reset after USB power removal. Camera distance and camera-side temperature adjustment remain disabled; a software temperature offset is available under `Host correction`. Browser camera controls remain disabled.

`Reset camera correction` under Camera commands sets emissivity to 1 and reflected/ambient temperature to 24.85 °C (298 K, the value Android labels 25 °C). It then clears Host correction, including its offset. Gain and atmospheric transmittance remain unchanged. Wait for confirmation; if a write fails, earlier settings may already have changed and the error is shown. This reset does not save settings across USB power loss.

For manual temperature range selection, use `High gain` for the vendor's Low range and `Low gain` for its High range. `Auto sensor range` starts in high gain and switches after 100 consecutive frames above 160 °C or below 150 °C, following 100 settling frames. `Manual sensor range` keeps the current confirmed gain and allows manual selection. Stop or a command error ends Auto. Gain changes preserve atmospheric transmittance; the Android app instead selects its own device-specific values.

Readings above 160 °C in high gain or below 90 °C in low gain are uncertain and excluded from measurements and alarms. Their raw pixels and uncertainty mask remain in photos and recordings. These limits follow the vendor display and do not guarantee absolute accuracy.

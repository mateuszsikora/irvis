# Thermal viewer

The viewer shows live thermal images or a synthetic demo with simple English controls.

## Start a view

Select Demo (the default) or Live camera, choose the camera profile, camera and thermal video mode, then Start. Stop releases the capture. Source or profile changes close the previous session. Live camera uses Electron when its preload API is present; otherwise it uses the browser. On macOS, Camera index is the AVFoundation video device index (default 0); use `ffmpeg -f avfoundation -list_devices true -i ""` to list devices. Open Capture diagnostics for the existing capture diagnostics (stop the viewer first).

## Navigate the workspace

The header holds Source and Camera profile. Start and Stop sit above the image with Ready, Connecting, Waiting for frames, Live, Demo running, Paused or Capture error status. Until the first frame arrives, an empty view explains how to begin. After Stop, the last frame stays visible as a paused image; palette, range and orientation controls continue to update it.

The image, temperature scale and display toolbar occupy the main area. The right panel holds palettes, range and orientation; on narrow screens it moves below the image. Clear/Smooth, Automatic/Manual and rotation angles use directly visible buttons with a selected state. Camera setup and Camera commands are expandable sections. Open Camera setup before changing the camera or video mode. `Capture photo` and `Gallery` appear below the image; Video remains labelled Soon. Measurement controls are in the settings panel.

## Adjust the image

Choose a palette swatch in the View settings panel: Iron (default), White Hot, Black Hot, Rainbow, Red Hot or Cold Blue. All six previews are visible without opening a menu. Automatic range follows certain scene extrema. Lock scale holds the current bounds while the scene changes. Manual mode offers lower and upper bounds in °C; Apply bounds accepts only finite, ordered bounds. Invalid input leaves the last applied range intact. The colour bar and its labels show the applied range.

Clear (default) uses nearest-neighbour scaling; Smooth uses browser interpolation. These are independent rendering choices, not a reproduction of the vendor's unknown TisoView algorithm. Scale offers 50%, Fit (default) and 200%, with scrolling for large images. Rotation offers 0°, 90°, 180° and 270°. Both mirror axes are independent. Lock orientation disables rotation changes: desktop/browser windows have no Android device-orientation tracking, so this locks the selected image angle instead. Uncertain pixels marks them in magenta; off by default.

## Declare the browser camera mode

The browser displays `camera mode unknown, readings assume high gain`. It assumes factory settings. Confirm camera mode and factory settings, or choose Declared gain. This is a software declaration, not a USB command. Low gain currently has no verified conversion in the shipped profile: `No verified conversion for this mode. Readings unavailable.` replaces the image/readings. Out-of-range readings show `Data look inconsistent with the declared camera mode. Check gain and factory settings.` This heuristic cannot prove camera state or detect every mismatch.

## Find camera and capture tools

Expand Camera commands in View settings. Commands come from the profile and require backend support and an active session. The browser shows them disabled with `available in the desktop app` and Download desktop app. The current Electron capture bridge also lacks command dispatch, so its commands stay disabled. `Capture photo` saves the rendered thermal image, and `Gallery` opens saved photos. Video remains unavailable until #19.

## See also

- [Technical details](ui-technical.md)
- [Replay demo](backend-replay-user.md)

## Measure temperatures

Use `Add point`, `Add line` and `Add area` to add independent objects. There is no fixed count limit; three of each can coexist. Select an object in `Selected object` and edit its coordinates in percent of the unrotated image. Points use x/y; lines and rectangles use two ends. Change the ends to move or resize an object. `Delete selected` removes one object. `Clear measurements` removes all added objects and preserves the independent `Track min`, `Track max` and `Track centre` preview shortcuts. This reset does not calibrate the shutter (NUC).

Readings appear below the preview. Points and the centre use a 3×3 neighbourhood mean; a point whose own pixel is uncertain shows `–` and has no marker. Lines and areas show their local minimum and maximum. Extrema skip uncertain or unavailable readings. `Highlight selected area` keeps the selected rectangle in colour and makes its surroundings greyscale. Orientation transforms apply to the image and overlays together.

`Temperature unit` selects °C, °F or K for readouts, colour bounds and alarm thresholds. Manual palette bounds and correction inputs retain their explicitly labelled °C units. Alarm thresholds accept negative values and one decimal place. Commit a threshold with `Apply threshold`; `Enable alarm` is separate from triggering. The status distinguishes `Alarm disabled`, `Alarm enabled — below threshold` and `Alarm triggered`. Certain pixels at or above the threshold trigger it, with 0.5 °C hysteresis. Sound plays only while triggered during capture or photo analysis, and stops on disable, Stop or leaving the viewer. After Stop → Start, the alarm waits for a frame from the new session; a retained image cannot trigger it. In photo analysis, `Stop` disables `Enable alarm` and silences sound while keeping the photo and measurement objects editable. Re-enable the alarm explicitly to resume photo warnings. Browser audio permission may be needed. `Isotherm above threshold` paints matching certain pixels red independently of the alarm switch.

## Apply host correction

Initially the viewer preserves the camera correction stored with thermal frames. Raw live capture assumes factory settings, as indicated by the camera setup notice. Edit emissivity (0.01–1.00), offset (-20–20 °C) and reflected temperature (-20–120 °C), then press `Apply correction`. Invalid or blank inputs cannot be applied. These inputs use the core fourth-power host model relative to the stored camera state, so an existing camera correction is not applied twice.

`Reset parameters` explicitly applies emissivity 1, offset 0 and reflected temperature 25 °C, matching the reference reset. Core's general default reflected temperature remains 20 °C; the viewer's reset deliberately uses 25 °C. Ambient temperature is displayed as 25 °C but disabled with `Ambient correction unsupported. No camera commands are sent.` It has no effect. Camera commands and a justified ambient model remain separate work.

## Analyze a saved photo

Choose `Open thermal photo` and select an irvis PNG containing temperature data or a one-frame `.irvis` snapshot. Loading stops live capture and starts a fresh set of editable objects on the stored temperatures. A previous camera capture error does not appear in photo analysis or silence its alarm. Errors rendering the photo still appear and silence the alarm. Returning with `Start` restores camera error reporting. Ordinary PNGs without temperature data are rejected with `Photo import failed:` followed by the reader error. A rejected import leaves the current source and its alarm running. Add and edit points, lines and areas just as for a live frame. Captured overlays are not imported as editable objects; the viewer renders a fresh thermal image. `Start` returns to capture. Annotations and video workflows remain part of #19. Valid saved host corrections are restored; captured overlays remain pixels in the original file, not editable objects. Opening a photo resets display rotation and mirrors because its thermal pixels already follow the saved orientation.


## Capture and reopen a photo

After a frame is displayed, press `Capture photo`. The saved PNG includes the visible palette, isotherm, measurement shapes and markers at the image's native resolution; CSS zoom, surrounding controls and text below the preview are not part of the image. Its lossless thermal data use the same rotation and mirrors as the captured pixels. The source data stay uncorrected and the host correction is stored separately, so analysis does not apply a correction twice.

`Saving photo…` becomes `Saved <filename>` only after storage commits, and the photo gallery opens. Each capture creates a separate file, including captures made while analyzing another photo. The original is never overwritten. `Photo capture failed:` reports rendering or storage failures without stopping live capture. Hosts without photo storage show `Photo storage is unavailable in this host.`

The photo-only gallery shows previews and `Analyze`, `Download` and `Delete` actions for each filename. Analyze starts with no added measurement objects; add new points, lines and areas as usual. Download keeps a standard PNG with temperature data, not a flattened export. Delete removes that gallery record immediately; it does not remove downloaded files or close an already open analysis. A failed deletion keeps the entry visible and reports `Gallery error:`. Close and reopen Gallery to retry a failed list operation.

The app saves photos locally in this browser/site or desktop app profile. They survive reloads and camera/profile switches, but clearing app/site data or browser eviction can remove them. Download important photos for backup. Gallery contents are not synchronized between the browser and desktop app.

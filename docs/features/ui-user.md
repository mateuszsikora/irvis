# Thermal viewer

The viewer shows live thermal images or a synthetic demo with simple English controls.

## Start a view

Select Demo (the default) or Live camera, choose the camera profile, camera and thermal video mode, then Start. Stop releases the capture. Source or profile changes close the previous session. Live camera uses Electron when its preload API is present; otherwise it uses the browser. On macOS, Camera index is the AVFoundation video device index (default 0); use `ffmpeg -f avfoundation -list_devices true -i ""` to list devices. Open Capture diagnostics for the existing capture diagnostics (stop the viewer first).

## Navigate the workspace

The header holds Source and Camera profile. Start and Stop sit above the image with Ready, Connecting, Waiting for frames, Live, Demo running, Paused or Capture error status. Until the first frame arrives, an empty view explains how to begin. After Stop, the last frame stays visible as a paused image; palette, range and orientation controls continue to update it.

The image, temperature scale and display toolbar occupy the main area. The right panel holds palettes, range and orientation; on narrow screens it moves below the image. Clear/Smooth, Automatic/Manual and rotation angles use directly visible buttons with a selected state. Camera setup and Camera commands are expandable sections. Open Camera setup before changing the camera or video mode. Measurement, Photo, Video and Gallery appear below the image with Soon labels.

## Adjust the image

Choose a palette swatch in the View settings panel: Iron (default), White Hot, Black Hot, Rainbow, Red Hot or Cold Blue. All six previews are visible without opening a menu. Automatic range follows certain scene extrema. Lock scale holds the current bounds while the scene changes. Manual mode offers lower and upper bounds in °C; Apply bounds accepts only finite, ordered bounds. Invalid input leaves the last applied range intact. The colour bar and its labels show the applied range.

Clear (default) uses nearest-neighbour scaling; Smooth uses browser interpolation. These are independent rendering choices, not a reproduction of the vendor's unknown TisoView algorithm. Scale offers 50%, Fit (default) and 200%, with scrolling for large images. Rotation offers 0°, 90°, 180° and 270°. Both mirror axes are independent. Lock orientation disables rotation changes: desktop/browser windows have no Android device-orientation tracking, so this locks the selected image angle instead. Uncertain pixels marks them in magenta; off by default.

## Declare the browser camera mode

The browser displays `camera mode unknown, readings assume high gain`. It assumes factory settings. Confirm camera mode and factory settings, or choose Declared gain. This is a software declaration, not a USB command. Low gain currently has no verified conversion in the shipped profile: `No verified conversion for this mode. Readings unavailable.` replaces the image/readings. Out-of-range readings show `Data look inconsistent with the declared camera mode. Check gain and factory settings.` This heuristic cannot prove camera state or detect every mismatch.

## Find camera and capture tools

Expand Camera commands in View settings. Commands come from the profile and require backend support and an active session. The browser shows them disabled with `available in the desktop app` and Download desktop app. The current Electron capture bridge also lacks command dispatch, so its commands stay disabled. Measurement, Photo, Video and Gallery are visible disabled entry points; their implementation belongs to #18 and #19.

## See also

- [Technical details](ui-technical.md)
- [Replay demo](backend-replay-user.md)

# Desktop comparison

The desktop app captures native camera bytes and can compare them with browser reconstruction.

## Run a comparison

Use Node 26+, install dependencies with `npm ci`, and install ffmpeg (or set `IRVIS_FFMPEG` to its executable). Run `npm run spike:m3:desktop`. Select the thermal profile mode and find the camera's ffmpeg index with `npm run capture -- list`.

In **Desktop comparison — M3**, enter the index (default 0) and confirm the kelvins per raw unit (default 1/64, P2 Pro high gain). Select **Simulation** to convert each exact frame through the planar model, reconstruct it and compare it with its original thermal rows.

For **Live static scene**, first start **Browser diagnostics** on the same camera and mode. Then start the reference. Keep the scene, gain and camera settings unchanged. Arrival times only approximate pairing: live metrics do not prove bit-exact reconstruction.

## Save results and stop

**Download comparison report** saves `report.json` with the first 100 measurements (or fewer if stopped earlier). **Download frame pair** saves `frame-pair.json` with exact bytes, native or simulated planar bytes, reconstructed raw values and metadata for offline analysis. The frame pair is the latest comparison; after the report fills, this can be a later frame not included in its 100 samples. Review both exports when assessing accuracy. Stop both reference and browser diagnostics to release both camera consumers.

A missing recent browser frame shows `Waiting for a browser frame received within 500 ms. Start browser diagnostics too.` Capture rejects a native format other than YUYV instead of silently converting an alleged exact reference. Native input uses AVFoundation on macOS, V4L2 on Linux and DirectShow on Windows. Select a camera under Camera setup. Profile commands require USB access; packaged ffmpeg remains a release milestone. Linux and Windows hardware paths still need real-device verification.

## See also

[Owner procedure and findings](../findings/m3.md), [technical details](desktop-technical.md).

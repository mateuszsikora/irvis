# Desktop comparison

The desktop spike compares the browser reconstruction with an ffmpeg reference on macOS.

## Run a comparison

Use Node 26+, install dependencies with `npm ci`, and install ffmpeg (or set `IRVIS_FFMPEG` to its executable). Run `npm run spike:m3:desktop`. Select the thermal profile mode and find the camera's ffmpeg index with `npm run capture -- list`.

In **Desktop comparison — M3**, enter the index (default 0) and confirm the kelvins per raw unit (default 1/64, P2 Pro high gain). Select **Simulation** to convert each exact frame through the planar model, reconstruct it and compare it with its original thermal rows.

For **Live static scene**, first start **Browser diagnostics** on the same camera and mode. Then start the reference. Keep the scene, gain and camera settings unchanged. Arrival times only approximate pairing: live metrics do not prove bit-exact reconstruction.

## Save results and stop

**Download comparison report** saves `report.json` with up to 100 measurements. **Download frame pair** saves `frame-pair.json` with exact bytes, native or simulated planar bytes, reconstructed raw values and metadata for offline analysis. Stop both reference and browser diagnostics to release both camera consumers.

A missing recent browser frame shows `Waiting for a browser frame received within 500 ms. Start browser diagnostics too.` Capture rejects a native format other than YUYV instead of silently converting an alleged exact reference. macOS capture is the only implemented hardware input; camera commands and packaged ffmpeg remain later milestones.

## See also

[Owner procedure and findings](../findings/m3.md), [technical details](desktop-technical.md).

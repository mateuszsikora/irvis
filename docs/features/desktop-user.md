# Desktop comparison

The desktop app captures native camera bytes and can compare them with browser reconstruction.

## Run a comparison

Use Node 26+, install dependencies with `npm ci`, and install ffmpeg (or set `IRVIS_FFMPEG` to its executable). Run `npm run spike:m3:desktop`. Select the thermal profile mode and find the camera's ffmpeg index with `npm run capture -- list`.

In **Desktop comparison — M3**, enter the index (default 0) and confirm the kelvins per raw unit (default 1/64, P2 Pro high gain). Select **Simulation** to convert each exact frame through the planar model, reconstruct it and compare it with its original thermal rows.

For **Live static scene**, first start **Browser diagnostics** on the same camera and mode. Then start the reference. Keep the scene, gain and camera settings unchanged. Arrival times only approximate pairing: live metrics do not prove bit-exact reconstruction.

## Save results and stop

**Download comparison report** saves `report.json` with the first 100 measurements (or fewer if stopped earlier). **Download frame pair** saves `frame-pair.json` with exact bytes, native or simulated planar bytes, reconstructed raw values and metadata for offline analysis. The frame pair is the latest comparison; after the report fills, this can be a later frame not included in its 100 samples. Review both exports when assessing accuracy. Stop both reference and browser diagnostics to release both camera consumers.

A missing recent browser frame shows `Waiting for a browser frame received within 500 ms. Start browser diagnostics too.` Capture rejects a native format other than YUYV instead of silently converting an alleged exact reference. Native input uses AVFoundation on macOS, V4L2 on Linux and DirectShow on Windows. Select the camera in Source, in the header. Profile commands require USB access. Linux and Windows hardware paths still need real-device verification.

## When capture ends with an error

Choosing a camera in Source reads the video modes it offers. Modes without temperature data can be chosen too and show the camera's image only (see [the viewer](ui-user.md#watch-a-mode-without-temperature-data)), at the highest frame rate the camera offers for that size; a camera that does not send such a mode as YUYV stops with `This camera sends <format>, not YUYV, in this video mode; choose another video mode.`; on Linux only the camera profile's own modes can, because the camera's list has no frame rates. When none of the modes carries temperature data, as with the built-in FaceTime camera of a Mac, the app says so before Start and chooses an image-only mode. If the modes could not be read and the camera has no video mode of the camera profile, the viewer shows `This camera has no 256 × 384 video mode; it offers …. It is probably not the thermal camera: choose another camera in Source.` Choose the thermal camera in Source (on macOS the TOOLTOP T7 is called `USB Camera`) and press Start again. Any other end of capture shows `Capture ended (<code>).` with the last lines of ffmpeg's log below it.

## Install a package

Each version's packages are attached to its GitHub Release at https://github.com/mateuszsikora/irvis/releases. Packages are unsigned: macOS and Windows warn that the developer cannot be verified. Each package carries its own ffmpeg, so no other software is needed; the ffmpeg source tarball, the `build.sh` that built it and the node-usb source package (`usb-<version>.tgz`, which holds the source of the libusb linked into node-usb) are attached to the same release.

- **macOS 13 or later** (`irvis-<version>-mac-arm64.dmg` for Apple silicon, `-mac-x64.dmg` for Intel): open the dmg and drag irvis to Applications. The first start is blocked; open **System Settings → Privacy & Security** and choose **Open Anyway** for irvis. At the first capture macOS asks for camera access with `irvis uses the camera to display and record thermal images.`
- **Windows 10 or later** (x64): run `irvis-<version>-win-x64.exe` and confirm **More info → Run anyway** in SmartScreen, or unpack `irvis-<version>-win-x64.zip` and run `irvis.exe`.
- **Linux** (x64): install the deb with `sudo apt install ./irvis-<version>-linux-amd64.deb`, which also installs the udev rule that lets you send camera commands without root; plug the camera in again afterwards. The AppImage runs after `chmod +x` where FUSE 2 is installed (`sudo apt install libfuse2t64` on Ubuntu 24.04, `libfuse2` on 22.04); without it, start it with `APPIMAGE_EXTRACT_AND_RUN=1`. Where AppArmor restricts unprivileged user namespaces (Ubuntu 24.04 and later), the Chromium sandbox of an AppImage may not start; then add `--no-sandbox` to the command, or use the deb, which installs a sandbox helper that works there. The AppImage cannot install the udev rule. Extract and install it yourself, then plug the camera in again:

  ```sh
  ./irvis-<version>-linux-x86_64.AppImage --appimage-extract resources/60-irvis.rules
  sudo install -m 644 squashfs-root/resources/60-irvis.rules /etc/udev/rules.d/60-irvis.rules
  sudo udevadm control --reload-rules
  rm -r squashfs-root
  ```

## Use your own ffmpeg

Set `IRVIS_FFMPEG` to an ffmpeg executable to use it instead of the bundled one, for example when a package was published without ffmpeg because its build failed on that system. Such a package shows `This irvis package has no ffmpeg. Install ffmpeg and start irvis with IRVIS_FFMPEG set to its path.` when it finds none on PATH. Start irvis from a terminal with the variable set:

- macOS: `IRVIS_FFMPEG=/opt/homebrew/bin/ffmpeg /Applications/irvis.app/Contents/MacOS/irvis`
- Linux: `IRVIS_FFMPEG=/usr/bin/ffmpeg irvis` (deb) or `IRVIS_FFMPEG=/usr/bin/ffmpeg ./irvis-<version>-linux-x86_64.AppImage`
- Windows (PowerShell): `$env:IRVIS_FFMPEG = 'C:\ffmpeg\bin\ffmpeg.exe'; & "$env:LOCALAPPDATA\Programs\irvis\irvis.exe"`

Any ffmpeg with the AVFoundation (macOS), V4L2 (Linux) or DirectShow (Windows) input and the rawvideo encoder works. A wrong path shows `IRVIS_FFMPEG=<path> is not an executable file`. If the package's own ffmpeg has lost its executable permission, irvis shows `The ffmpeg of this irvis package (<path>) is not an executable file. Reinstall irvis, or start it with IRVIS_FFMPEG set to another ffmpeg.`

## See also

[Owner procedure and findings](../findings/m3.md), [technical details](desktop-technical.md).

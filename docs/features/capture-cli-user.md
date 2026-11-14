# Capture tool

`tools/capture-cli` records exact frames from the InfiRay P2 Pro (TOOLTOP T7) on macOS with ffmpeg and measures them: frame size, frame rate, temperatures, the upper half of the frame, noise and automatic shutter (NUC) events. It exists for the hardware spikes; the M1 spike runs it as `npm run spike:m1` ([instructions and results](../findings/m1.md)). It is not part of the app.

## Before the first run

1. macOS, Node.js 26 and `npm ci` in the repository ([development guide](../guides/development.md#setup)).
2. ffmpeg: `brew install ffmpeg`. The tool runs the first `ffmpeg` on `PATH`, or the file that `IRVIS_FFMPEG` names, such as `IRVIS_FFMPEG=/usr/local/bin/ffmpeg npm run spike:m1`.
3. Camera permission for the terminal app: macOS asks the first time ffmpeg opens a camera. If you said no, allow it in System Settings → Privacy & Security → Camera and restart the terminal.

Run the tool from the repository root, as `npm run capture -- <command> [options]` or `node tools/capture-cli/src/cli.ts <command> [options]`. `npm run capture -- --help` prints the usage.

## Run the M1 spike

```sh
npm run spike:m1                     # session in captures/m1-<date>-<time>/
npm run spike:m1 -- --out <dir>      # session in <dir>
```

1. It lists the cameras and asks for the index of the thermal camera; Enter takes the suggested one, the first whose name contains `USB Camera`, `thermal`, `P2` or `T7` in any case. Without a suggestion, or for an index that is not in the list, it asks again.
2. It probes the camera and saves the result as `probe.txt`.
3. It runs six scenarios. For each it prints what to point the camera at and waits: Enter starts the capture, `s` and Enter skips it. One dot appears per second of capture.

   | Scenario | Mode | Seconds | What to do |
   | --- | --- | --- | --- |
   | `room` | 384 | 5 | An empty part of the room, such as a wall 1 to 2 m away |
   | `hand` | 384 | 5 | Your open hand about 30 cm away, covering the centre |
   | `mug` | 384 | 5 | The centre of the image on a mug of hot water, about 50 cm away |
   | `static` | 384 | 10 | The camera lying still on a table, facing a plain wall; nothing moves (the noise measurement) |
   | `movement` | 384 | 90 | The camera moving around the room: people, a window, the mug, your hand |
   | `mode-192` | 192 | 3 | Anything; checks the 256×192 mode |

4. After `room`, `hand` and `mug` it asks for the Android app's centre reading at the same spot. Type it in °C (`23.5` or `23,5`), or press Enter and add it later with `reference`.
5. At the end it writes `report.md` into the session directory and prints it: the probe output, the scenarios whose capture failed (under `Failed captures:`), the summary and one block per capture. Paste it into the issue.

The session directory holds every frame: 4.9 MB a second before gzip, which shrinks it by an amount that depends on the scene. `captures/` is ignored by git; keep long series local or attach them to a GitHub Release.

## List the cameras

```sh
npm run capture -- list
```

```
AVFoundation video devices:
  [0] FaceTime HD Camera
  [1] USB Camera
```

The number in brackets is the `--device` index of the other commands. It can change when cameras are plugged in or out.

## Probe a camera

```sh
npm run capture -- probe --device 1
```

Prints the ffmpeg version, the device name, the modes AVFoundation reports (`256x384 at 25 to 25 fps`), the pixel formats it offers at 256×384 (or the first mode), and what node-usb sees of every USB device with the profile's ID `0x0bda:0x5830`: names, version, interfaces and endpoints, and the configuration descriptor with the UVC formats, frame sizes and extension units. If the device cannot be opened for the descriptor, the line says why; that is itself a result for the USB command spike.

## Capture

```sh
npm run capture -- capture --device 1 --seconds 10 --mode 384 --out captures/test [--label wall] [--reference 22.4]
```

| Option | Meaning |
| --- | --- |
| `--device <index>` | From `list`. Required |
| `--seconds <s>` | How long; a positive number up to 36000 (ten hours). Required |
| `--mode 384\|192` | `384`: 256×384 with temperature data. `192`: 256×192 without. Required |
| `--out <dir>` | Created if missing; must not hold frames yet. Required |
| `--label <text>` | A name for the scene, shown in the report |
| `--reference <°C>` | The Android app's centre reading at the same spot; a negative one as `--reference=-5` |

It prints one line, such as `captures/test: 250 frames, the first 812 ms after ffmpeg started; ffmpeg exited with 0`, and leaves in `<dir>` the frames as `frames/000000.yuyv.gz`, … , `meta.json`, `packets.framecrc` and `ffmpeg.log`.

If AVFoundation did not deliver the `yuyv422` format the tool asks for, a second line says so, for example `warning: AVFoundation delivered uyvy422, not yuyv422; its bytes are reordered or converted, not as the camera sent them`. With `uyvy422` the frames have the right size but their bytes in another order, so the temperatures in the report are wrong, and the report and its summary say so instead of concluding that the mode needs a command. Post the warning and `ffmpeg.log` in the issue.

## Report

```sh
npm run capture -- report captures/test               # one capture
npm run capture -- report captures/m1-20261113-101500 # every capture of a session, with a summary
npm run capture -- report captures/test --frame 40    # previews and single-frame values from frame 40
```

It writes `report.md`, `report.json` and the previews `preview-image.png`, `preview-image.pgm`, `preview-thermal.png` and `preview-thermal.pgm` into each capture directory, and prints the Markdown. For a session it also writes the session's `report.md`, which starts with a summary table and these answers:

```
- Every frame has the expected size: yes
- Pixel format AVFoundation delivered: yuyv422
- The 384 mode delivers temperature data without any command: yes
- Upper half: greyscale (U and V within 128 ± 2); brightness rises with temperature
- Agreement with the Android app within ±2 °C: 3 of 3
```

Each capture's block has, after the device line, the pixel format AVFoundation delivered, which must read `yuyv422, as requested` for the values to mean anything. Then come the frame count and whether every frame had the expected size (196 608 B in the 384 mode), the time to the first frame, the frame rate and the spread of the intervals, the minimum, maximum and centre temperature, the upper half's colour and how its brightness follows temperature, the noise in mK, the detected NUC events, and a histogram. What each number means and how it is computed is in the [technical document](capture-cli-technical.md#report).

The previews come from the middle frame unless `--frame` says otherwise: `preview-image` is the upper half as the camera sent it, `preview-thermal` the raw values, stretched from the coldest (black) to the hottest (white) pixel in the PNG, and as 16-bit values in the PGM.

## Add the Android reading later

```sh
npm run capture -- reference captures/m1-20261113-101500/hand 33.8
npm run capture -- report captures/m1-20261113-101500
```

`reference` prints `<dir>: Android reading 33.8 °C stored; run report again`. A reading below zero works as is: `npm run capture -- reference <dir> -5`.

## What can go wrong

Errors are printed as `capture-cli: <message>`. A mistake in the command line also prints the usage and exits with code 2; every other error exits with 1.

| Message | What to do |
| --- | --- |
| `ffmpeg not found: install it (brew install ffmpeg) or set IRVIS_FFMPEG to its path` | Install ffmpeg or set `IRVIS_FFMPEG` |
| `IRVIS_FFMPEG=<path> is not an executable file` | Fix the path |
| `capture-cli <command> uses AVFoundation and runs only on macOS; this is <platform>` | Run it on a Mac; `report` and `reference` work everywhere |
| `<dir>: no frames arrived (ffmpeg exited with <code>); see <dir>/ffmpeg.log` | Check the camera permission, the device index and the mode; the log has ffmpeg's own message, such as `Selected video size (256x384) is not supported by the device.` |
| `<dir>: no frames arrived (ffmpeg was stopped after the time limit); see <dir>/ffmpeg.log` | ffmpeg did not finish within `--seconds` plus 20 s, often while macOS waits for the camera permission |
| `<dir> already holds frames; choose an empty directory` | Use a new `--out` |
| `<dir>: writing frame <n> failed: <message>` | The disk is full or the directory is not writable; free space or choose another `--out`. The capture is stopped and has no `meta.json` |
| `<dir>/meta.json is not valid JSON: <message>` | The capture was interrupted while writing; capture it again. In a session report the other captures still get their blocks |
| `--mode must be 384 or 192, not '<value>'` | |

The [technical document](capture-cli-technical.md#failure-modes) lists every message.

## See also

- [Capture tool: technical](capture-cli-technical.md)
- [M1 findings](../findings/m1.md)
- [Cameras](cameras-user.md)

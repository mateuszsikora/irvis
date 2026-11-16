# InfiRay P2 Pro

Profile `infiray-p2pro` in [profile.ts](profile.ts): the InfiRay P2 Pro thermal camera, also sold as the TOOLTOP T7. This file gives the source and the confidence of every constant in the profile. USB ID 0x5840 was observed on the owner-identified TOOLTOP T7; the temperature conversion has not been independently reference-validated. The M1 spike ([findings](../../../../../docs/findings/m1.md)) checks the video modes and the conversion on a real camera.

| Constant | Value | Source | Confidence |
| --- | --- | --- | --- |
| USB ID | `0x0bda:0x5830` and `0x0bda:0x5840` (Realtek bridge) | [LeoDJ/P2Pro-Viewer](https://github.com/LeoDJ/P2Pro-Viewer) (MIT), `P2Pro/video.py` (`P2Pro_usb_id`) and `60-p2pro.rules`; [alufers/thermal-cat](https://github.com/alufers/thermal-cat), `src/camera_adapter/infiray_p2_pro.rs`, which also notes the TOPDON TC001 and clones on `0x0bda:0x5840` | 0x5830 reported; 0x5840 also observed in M1 on 2026-11-15 |
| Device name | not set (`labelPattern` absent) | thermal-cat quotes `lsusb` as `Realtek Semiconductor Corp. USB Camera`; the name macOS shows is printed by `capture-cli list` in the M1 spike | unknown |
| Mode `yuyv-256x384` | 256×384 YUYV at 25 fps; rows 0–191 the camera's image, rows 192–383 raw values, `u16le` | P2Pro-Viewer `P2Pro/video.py` (`P2Pro_resolution`, `P2Pro_fps`, the split into "pseudo color" and "temperature data" halves); thermal-cat | reported; whether it needs a command first is checked in the M1 spike |
| Mode `yuyv-256x192` | 256×192 YUYV at 25 fps, no temperature data (`layout: null`) | thermal-cat (a "greyscale representation of the thermal data" stream) | reported |
| Sensor | 256×192 | both projects above | reported |
| Conversion, high gain | linear, °C = raw / 64 − 273.15 (`scale` 1/64, `offset` −273.15) | thermal-cat (`x as f32 / 64.0` in kelvin); [atomic14/InfiRayCapture](https://github.com/atomic14/InfiRayCapture) (MIT) uses `raw / 64.0 − 273.2`; EEVblog thread "InfiRay and their P2 Pro" | `reported`, not `confirmed`: three projects agree on the divisor 64, but they are probably not independent (they may take it from each other or from the same forum thread), and nobody has measured it against a reference. Not `unverified` either, which means a guess; the M1 spike moves it to `measured` or corrects it |

Profile version 2 adds scene-based NETD 0.07545446351476191 K from the
2026-11-16 stationary wall capture, original frames 1875–2130 (256 frames).
This is measured temporal population SD, not calibrated NETD; conversion
confidence remains reported. The high-gain `recordingThreshold` is 10 raw
units (0.15625 K): twice that noise rounded upward. See the
[decision](../../../../../docs/decisions/architecture.md#recording-defaults-use-twice-the-static-scene-noise).

Not in the profile yet:

- **Low gain.** Probably another divisor; the profile has no `gain` state field and one conversion, which is labelled `high`. The M2 probe can switch gain, but a low-gain conversion and state defaults await hardware measurements.
- **Accuracy and measurement ranges.** `sensor.ranges` is empty and `accuracy` is absent.
- **Camera state and commands.** `state` remains empty pending measurements. `commands` contains reported `gain-high` and `gain-low` sequences; `usbProtocol` supplies diagnostic constants. See [protocol](../../../../../docs/protocol.md) for confidence, unsupported NUC and experimental sensor-temperature reads.

Third-party projects used here are listed in [NOTICE](../../../../../NOTICE).

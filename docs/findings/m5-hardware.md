# M5 hardware observations

Run: 2026-11-16, TOOLTOP T7 USB 0bda:5840, firmware identity TC1_V1.02, build string `12/03/24`. Node 26.13.1 on macOS. The owner positioned the camera at a wall with a tablet and power supply near its bottom. There was no independent thermometer or calibrated reference target. Private images, raw frames and JSONL logs are kept in `.context/m5-hardware/`; they are not committed.

## Continuous control and video

`continuous.jsonl` contains 4,617 packed 256×384 YUYV frames during one uninterrupted ffmpeg capture. Commands changed one TPD field at a time, with state readback, restoration and two repeated gain cycles. Direct Conductor capture produced no frames; the same executable launched by a Terminal command file worked. This reproduces the platform access limitation in [M2](m2.md#local-hardware-run).

The following values are whole-frame lower-half raw means over the final two seconds of each interval. They are observations, not calibrated temperatures. Scene drift and automatic shutter events remain possible; especially the gain intervals had substantial settling.

| Interval | Raw mean |
| --- | ---: |
| Initial baseline | 18929.124 |
| Low gain | 16739.441 |
| High gain | 18596.468 |
| Low gain repeated | 16812.059 |
| High gain repeated | 18631.776 |
| EMS 64, TU 300 | 18503.448 |
| EMS 64, TU 330 | 15419.270 |
| EMS 64, TU restored to 300 | 18634.759 |
| EMS restored to 128 | 18908.503 |
| TAU 64, TA 300 | 18708.958 |
| TAU 64, TA 330 | 15505.903 |
| TAU 64, TA restored to 300 | 18715.905 |
| TAU restored to 128 | 18975.411 |
| Distance 16384, TAU 128 | 18971.056 |
| Distance restored to 32 | 18977.007 |
| Palette 3 | 18975.513 |
| Palette restored to 1 | 18983.839 |

The paired changes establish that EMS/TU and TAU/TA affect thermal pixels in the camera; they are not merely display metadata. They do not establish the camera's exact radiometric correction law. Distance at TAU 128 had no separable thermal effect in this scene. Palette changes had no large thermal step, but the small differences cannot prove complete independence.

EMS/TAU use a divisor of 128 in [p2pro-rs at 091a10a](https://github.com/mbuesch/p2pro-rs/blob/091a10a45d87a9edf0b61c89094ce4fc5d585dec/p2pro-hw/src/lib.rs), consistent with this camera's unity values. Older P2Pro-Viewer documentation says 127. The new controls use 128 and conservatively restrict ratios to 0.5–1; the experiment does not calibrate every input value. TU/TA use whole kelvin. The host's fourth-power correction remains its documented approximation; it is not claimed to match the vendor's full spectral model.

Using the high-gain conversion on the low-gain frames would give about −12 °C for the whole room scene. No low-gain conversion was inferred from these unreferenced measurements. An independent [P2Pro-Viewer issue](https://github.com/LeoDJ/P2Pro-Viewer/issues/22) also reports inconsistent low-gain decoding, but concerns a different owner's device and is not calibration evidence for this T7.

## State retention and power

`persistence-before.jsonl` and `persistence-reopen.jsonl` show changed values surviving USB handle close/open: distance 64, TU 301, TA 302, EMS 112, TAU 120 and gain 0. The gain command's initial ready wait timed out, but the subsequent independent read confirmed all six changed values; transfer completion alone was not counted as confirmation.

The owner physically unplugged the camera for approximately five seconds and reconnected it. `persistence-power-cycle.jsonl` returned distance 32, TU 300, TA 300, EMS 128, TAU 128 and gain 1. Deliberate changes therefore did **not** survive power removal. These are observed startup values for this device, not a universal factory-default guarantee. `persistence-restored.jsonl` confirms the initial state. No flash, calibration-table write or firmware-update command was sent.

## Actual desktop recording

The production Electron shell was driven through the shared viewer using the real camera and preload. High/low gain commands completed with matching readback. Low gain displayed unavailable readings. A real `.irvis` file contains 85 frames and nine chunks; frame 44 resumes high gain with `command-generation: 2` and a `camera-state` keyframe. Intermediate low-gain frames are omitted. Other chunks came from sensor-state changes and the existing NUC heuristic. The heuristic is not evidence of a manually requested shutter.

A second production-shell run applied emissivity 0.875 and then 1 through the numeric UI before a gain cycle. Its 110-frame recording stores raw EMS 112 and decoded emissivity 0.875 from keyframe 42, restores unity at frame 69, and resumes high gain at frame 70 with command generation 4. Both command and correction state survive the file round trip.

This confirms the recording boundary on these runs, not synchronization with sensor exposure: ffmpeg buffers frames, the camera may hold repeated frames during gain switching, and initial frames may still settle.

## Manual NUC investigation

The public Tiny1C sources supply a shutter-state read (`0x830c`) and `ooc_b_update(B_UPDATE)` (`0xc10d`, parameter 0). Sources: [falcon_cmd.c](https://github.com/danjulio/iCam/blob/50a4a6f231886ad8cc2bf423a0d1a0094f6b2ba3/firmware/components/tiny1c/falcon_cmd.c) and [vdcmd.h](https://github.com/danjulio/iCam/blob/50a4a6f231886ad8cc2bf423a0d1a0094f6b2ba3/firmware/components/tiny1c/vdcmd.h). The public Tiny1C SDK sample also labels this procedure as shutter control. No vendor library was executed or added as a dependency.

The camera returned shutter state `0101`. A controlled attempt sent `0d c1 00 00 00 00 00 00` at vendor OUT 41/45/0078/1d00 while capturing. It returned status 14; the remaining planned attempts were cancelled. The owner reported no new audible click at that time. The previously heard automatic clicks do not confirm this command. A known device-info read cleared the rejected transaction, after which all initial TPD values were read successfully.

The candidate is **rejected**, not an enabled command. This does not prove that the camera lacks manual NUC, or that its firmware needs an update. A verified command for TC1_V1.02 is still required.

## Remaining evidence

Absolute radiometric calibration and a working manual NUC command remain unresolved. Subsequent sections establish range mapping, the shared reported conversion, host temperature adjustment and the reset sequence. The tested distance write did not establish its effect or physical scaling. The implementation exposes the verified settings and explains unsupported operations; it does not infer accuracy from the kettle comparison. The [M5 checklist](m5-checklist.md) distinguishes verified operations from these gaps.

## Android implementation inspection

The owner connected the audit OnePlus 6T over USB. The installed package is `com.dyt.wcc.neutral`, version 3.07.48 (648). Its APK and extracted code remain private in `.context/m5-hardware/android/`. Only protocol facts and behavioural observations belong in this repository; no vendor implementation or binary is incorporated into irvis.

Static inspection of `Tiny1CActivity` and the arm64 library establishes:

- Android Manual Low sends TPD gain 1 (high sensor gain), and Manual High sends gain 0 (low sensor gain). These labels name temperature ranges, not sensor gain.
- Auto is a host policy, stored in Android preferences. It starts in high sensor gain; after a 100-callback settling interval, 100 consecutive maximum readings above 160 °C request low sensor gain, and 100 below 150 °C request high sensor gain. There is no separate Auto USB opcode in this path.
- The Tiny1C temperature callback applies `raw / 64 − 273.15` plus the host adjustment in either gain. Android formats readings below 90 °C as `<90.0` in its High range and readings above 160 °C as `>160.0` in its Low range. This explains why a room-temperature scene in Android High is not evidence for accurate low-gain radiometry. Neither clipping boundary is calibrated by this inspection.
- Emissivity and transmittance encode the ratio multiplied by 128, rounded to an integer. Reflected and ambient temperatures encode whole kelvin (Android truncates Celsius plus 273.15; irvis rounds to the nearest whole kelvin). Ambient input is limited to −20…50 °C in Android; reflected temperature to −20…120 °C.
- Temperature Adjustment updates host memory and Android preferences, without a USB transfer. Its default is 0 °C.
- Thermal Parameter Reset sends three ordinary TPD writes: EMS 128, TA 298 and TU 298, and clears the host adjustment. Android describes the latter two as 25 °C; raw 298 corresponds to 24.85 °C. This differs from the T7 power-on values TA=TU=300. The Tiny1C reset path does not invoke the separate save-to-flash function.
- The native Tiny1C command queue contains the same `0xc10d` zero-parameter shutter request that this T7 rejected. The old `setZoom(32768)` UI path reaches a native stub returning −1; `whenShutRefresh` only changes an image-processing flag. These paths do not establish a working manual NUC command for this camera.

These are static implementation findings, not a USB trace or a successful hardware acceptance run.

## Browser control verification

The built web app was opened in Playwright Chromium with Source set to live. All 12 camera-operation buttons were disabled, numeric inputs were disabled, and the panel displayed `available in the desktop app`. The private panel screenshot and checked button list are stored as `browser-controls.png` and `browser-controls.json`.

## Original Android app with the T7, 2026-11-17

The owner moved the same camera to the OnePlus 6T. ADB over Wi-Fi remained connected; Android enumerated USB 0bda:5840 and the original application displayed live video. Private screenshots, hierarchy dumps and application-only logcat are in `.context/m5-hardware/android/`.

Initial settings displayed Auto range, Low selected, emissivity 1.00, temperature adjustment 0.0, reflected temperature 27 °C and ambient temperature 27 °C. The displayed whole-degree temperatures agree with rounding the power-on 300 K values; they are not independent reference measurements.

Selecting Manual then High produced native gain-0 requests and a High selection with `<90.0` readings throughout this room scene. The first High tap arrived while the previous operation was pending and did not take effect; a later tap completed. Returning to Low produced gain-1 requests and ordinary room readings. Auto was restored. This confirms the label mapping on hardware, but neither a calibrated High reading nor an automatic threshold crossing.

**Range switching also writes transmittance.** The vendor log records `setTiny1CTAU` after gain selection: approximately 0.9084 for sensor gain 1 and 0.8584 for sensor gain 0 on this device. The native implementation scales these by 128 and truncates, yielding raw 116 and 109. These are vendor-selected corrections, not measured atmospheric properties. Other device branches use other values or unity. irvis's explicit gain command does not silently overwrite a separately selected transmittance; it must not be described as the complete Android range operation.

The vendor's own log repeatedly shows shutter queue operation 5 (`0xc10d`), followed by status 14 on the next status read, with the command-failed bit set. Read operations subsequently return status 0. This corroborates rejection in the earlier desktop experiment; the presence of a shutter request in a log is not evidence of a successful shutter action. No working manual NUC was established.

Setting Temperature Adjustment to +2.0 °C changed the displayed readings, and the app showed `Calibration setting complete`. Pressing Thermal Parameters `Default` reset adjustment to 0.0 and reflected/ambient fields to 25 °C, matching static analysis of the three TPD writes. The initial reflected/ambient values were then restored to 27 °C and verified in a fresh hierarchy dump. Emissivity remained 1.00. This verifies the vendor UI sequence, not a post-reset raw USB readback from irvis. Android-selected transmittance remains in force until the camera loses USB power or it is explicitly restored.


### Hot kettle comparison

The owner placed a boiled kettle in the Android camera's view. The first Auto/Low screenshot showed a maximum of 96.5 °C. After selecting Manual and allowing the gain operation to finish, High showed a maximum of 90.2 °C; cooler pixels were labelled `<90.0`. Returning to Low showed 91.9 °C, and restoring Auto showed 92.7 °C. The corresponding application logs confirm gain 0 with vendor transmittance in High and gain 1 in Low. Private captures are `kettle-auto.png`, `kettle-high.png`, `kettle-low-return.png` and `kettle-auto-restored.png` under the Android evidence directory.

This establishes a numeric High-range reading on a hot target, rather than only the room-scene clipping previously observed. It does not establish absolute accuracy: there was no independent surface thermometer, the kettle cooled during the sequence, and range changes also changed transmittance. The run does not reach the 160 °C automatic-switch threshold. Raw-frame comparison on the Mac remains pending.


### Mac raw capture after the kettle cooled

After the owner returned the camera to the Mac, USB and AVFoundation identified the T7. One launch yielded no frames and restored the initial state; the subsequent Terminal launch captured 2,905 frames. `kettle.jsonl` records wall-clock timestamps and readback for every interval. The following are mean frame maxima over a two-second window ending 0.5 seconds before the next command, avoiding transition frames. The startup interval is excluded.

| Interval | Gain readback | TAU readback | Mean maximum using raw / 64 − 273.15 |
| --- | ---: | ---: | ---: |
| High sensor gain, unity | 1 | 128 | 85.13 °C |
| Low sensor gain, unity | 0 | 128 | 79.83 °C |
| Low sensor gain, Android transmittance | 0 | 109 | 86.09 °C |
| High sensor gain, Android transmittance | 1 | 116 | 85.33 °C |
| High sensor gain, unity again | 1 | 128 | 84.42 °C |

The owner explicitly noted that the kettle was cooling. These sequential readings must not be treated as measurements of a fixed-temperature reference. All values are below the vendor High range's 90 °C display boundary, so this run does not verify low-gain accuracy within its intended range. The repeated high/unity measurement brackets the sequence's drift, but cannot separate cooling, sensor settling and the effect of the intermediate settings. Final readback restored distance 32, TU/TA 300, EMS/TAU 128, gain 1 and palette 01.


## All numeric controls and reset in the production UI

A clean exclusive-access run used the built Electron app with the physical T7. It applied emissivity 0.875 (EMS 112), reflected temperature 31.85 °C (TU 305), ambient temperature 29.85 °C (TA 303), and transmittance 0.9375 (TAU 120). Each request displayed the busy state and completed with confirmation. With host offset +2 °C applied, `Reset camera correction` confirmed all three writes, displayed camera emissivity 1 and reflected/ambient 24.85 °C, preserved transmittance 0.9375, and reset the host offset field to 0.

The private `ui-controls-gain.irvis` recording contains 178 frames. Keyframes 37, 59, 81 and 106 retain the four changed raw settings; frame 127 records reset EMS 128, TA/TU 298, unchanged TAU 120 and command generation 7. Frame 154 records restored startup EMS/TAU 128, TA/TU 300 and gain high. The application then stopped cleanly. Results and a reset screenshot are in `ui-controls-result.json` and `ui-controls-reset.png`.

Two earlier attempts encountered `IOKit request failed: 0xe00002c5` while another process held or accessed the camera (the diagnostic USB handle, then the desktop smoke capture). The UI displayed the failure rather than confirmation. The exclusive-access retry succeeded after closing those processes and rereading/restoring the camera. These are observed request-failure/recovery cases, not a physical-unplug-during-command test. Camera hardware checks must run without competing USB users.


### Reheated kettle and conversion decision

The owner reheated the kettle and signalled when it was in view. `kettle-fresh.jsonl` contains 1,394 frames with command/readback timestamps. The short high-sensor → low-sensor → high-sensor sequence used Android's respective TAU values 116/109/116. Two-second windows ending 0.5 seconds before the next command gave mean frame maxima 94.83 °C, 90.57 °C and 93.44 °C. Individual low-sensor-gain maxima in that window ranged from 89.79 to 91.91 °C. Initial raw settings were restored and read back at the end.

This reproduces numeric High-range readings above the vendor's 90 °C boundary on the Mac. Cooling, emissivity, sensor settling and transmittance prevent an absolute-accuracy claim or a fixed-temperature comparison. The implementation therefore uses the vendor's same-divisor conversion in both gains at **reported** confidence; it does not fit a new coefficient or offset to make the kettle read 100 °C. Out-of-range readings are marked uncertain according to the vendor display limits, and the mask travels with recorded raw pixels. The automatic 160/150 °C policy is separately tested in software; this kettle cannot exercise an above-160 °C physical crossing.


## Final range controls and recording acceptance

The production Electron UI selected low and high gain, then enabled Auto. An explicit allow-listed low-gain command supplied the starting mode while the real scene remained below 150 °C. Auto observed the real frames and restored high gain after its settling and threshold counters (about 29.8 seconds at the received frame rate). Auto remained enabled until Manual was selected. This verifies the physical low-to-high automatic return; the above-160 °C trigger is covered by software tests, not this scene.

Two concurrent preload requests then exercised the real main-process guard: the first gain command succeeded, and the second was rejected with `Camera command is already in progress`. The UI restored high gain afterwards. `ui-range-gain.irvis` contains 331 frames: 85 high gain and 246 low gain. Every low-gain frame retains an uncertainty mask. Gain keyframes occur at frame indices 26 (low), 80 (high), 107 (low), 284 (automatic high), 291 (low) and 306 (high). Intermediate keyframes also reflect sensor-state changes and the existing shutter heuristic; those do not demonstrate manual NUC. The camera and app were stopped after restoration. Private results are `ui-range-result.json`, `ui-range-low.png` and `ui-range-auto-return.png`.

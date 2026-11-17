# M5: desktop camera controls

Status: implemented operations exercised on one T7; unsupported operations and calibration limits are recorded below. Software tests cover both Auto thresholds; the physical scene exercises its low-to-high return.
Reference: [M2 evidence](m2.md), [protocol](../protocol.md), [Android inventory](android-app.md).
Evidence and limitations: [M5 hardware observations](m5-hardware.md). Checked rows describe those runs, not calibration or support for every compatible model.

| Operation | Expected software behaviour | Owner verification |
| --- | --- | --- |
| High gain | Sends profile gain-high; waits for readback 1; uses high conversion | [x] Readback, wall and cooling-kettle readings confirmed; no calibrated reference or absolute-accuracy claim |
| Low gain | Sends profile gain-low; waits for readback 0; uses reported conversion, marks readings below 90 °C uncertain | [x] Readback and numeric hot-target readings observed; raw low-gain frames and uncertainty retained in recording |
| Repeated requests | All commands disabled pending confirmation; main process rejects overlapping requests | [x] UI busy state observed; concurrent real preload request rejected with “Camera command is already in progress” |
| Readback failure or mismatch | Reports error; missing/invalid gain blocks readings | [x] IOKit request failure displayed during competing access; exclusive-access restart recovered. Physical unplug during a request was not tested |
| Recording across gain changes | Gain changes force keyframes and retain both conversions and uncertainty | [x] 331-frame production recording contains high/low/high keyframes; sensor exposure synchronization is not claimed |
| Reconnect | Reads camera state again; sends no automatic restore command | [x] Changed gain and all five TPD values survive handle close/open |
| Power loss | No persistence claim or invented save command | [x] Owner unplug/replug: startup values returned; changed settings were lost |
| Browser controls | Disabled; “available in the desktop app” | [x] Built web app in Chromium: all 12 operation buttons disabled, explanation present |
| Manual NUC | Disabled: no verified command; automatic clicks are not confirmation | [x] Candidate rejected with status 14 in desktop and vendor Android logs; NUC remains unavailable |
| TEMP-03 Auto/Manual range | Confirmed initial high gain; 100 settling frames and 100 consecutive crossings at 160/150 °C; Manual preserves current gain | [x] Manual switches and physical Auto return verified; both trigger directions unit-tested. Physical above-160 °C crossing and calibrated accuracy were not tested; irvis preserves user transmittance |
| TEMP-04 emissivity | Bounded camera write with readback; relative software correction uses the camera state | [x] Thermal effect, readback and power-cycle reset observed; ratio scale follows /128 |
| TEMP-05 temperature adjustment | Camera write disabled | [x] Host offset +2 °C changes displayed readings; Android Default restores 0 °C |
| TEMP-06 reflected temperature | Bounded camera write with readback; relative software correction uses the camera state | [x] Thermal effect and power-cycle reset observed; startup raw 300 |
| TEMP-07 ambient temperature | Bounded camera write with readback | [x] Thermal effect, startup raw 300 and loss on power removal observed |
| TEMP-08 thermal parameter reset | Sequential confirmed writes to EMS 128, TA/TU 298; clear host correction on success | [x] Production UI and recorded raw readback confirm reset; gain/TAU unchanged; host offset returns to 0 |
| Distance and atmospheric transmittance | Transmittance write enabled; distance disabled | [x] Transmittance affects thermal values and resets to raw 128; distance effect unresolved |

The TEMP labels follow the [audit](android-app.md); do not assume an Android reset writes camera storage. TisoView rendering choices do not establish USB commands. The checked rows state exactly what was exercised. Manual NUC remains unavailable after rejection, distance remains unavailable without verified physical scaling/effect, and absolute calibration or an above-160 °C physical target is not claimed. These limitations are explained in the UI and hardware findings.

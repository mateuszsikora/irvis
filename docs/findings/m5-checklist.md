# M5: desktop camera controls

Status: software implemented for the existing gain commands; hardware acceptance pending.
Reference: [M2 evidence](m2.md), [protocol](../protocol.md), [Android inventory](android-app.md).
No row below claims a new hardware observation. TODO(owner): record camera identity, OS, app revision, initial raw state, resulting raw state and observed defaults for every hardware run.

| Operation | Expected software behaviour | Owner verification |
| --- | --- | --- |
| High gain | Sends profile gain-high; waits for readback 1; uses high conversion | [ ] Confirm on a static scene and reference target |
| Low gain | Sends profile gain-low; waits for readback 0; disables readings and new recording frames | [ ] Confirm readback; measure conversion before enabling temperatures |
| Repeated requests | All commands disabled pending confirmation; main process rejects overlapping requests | [ ] Try repeated clicks while streaming |
| Readback failure or mismatch | Reports error; missing/invalid gain blocks readings | [ ] Disconnect during request, reconnect and confirm recovery |
| Recording across gain changes | Next recordable frame starts a keyframe through command-generation state; low frames omitted | [ ] Record high → low → high; inspect playback, keyframes and transition timing |
| Reconnect | Reads camera state again; sends no automatic restore command | [ ] Record whether gain survives stream stop and reconnect |
| Power loss | No persistence claim or invented save command | [ ] Unplug/replug USB; record resulting gain and defaults |
| Browser controls | Disabled; “available in the desktop app” | [ ] Check gain and unsupported controls in browser |
| Manual NUC | Disabled: no verified command; automatic clicks are not confirmation | [ ] Obtain independent command evidence before enabling |
| TEMP-03 Auto/Manual range | Disabled: vendor range mapping unverified | [ ] Verify protocol, busy/readback semantics and conversion for each mode |
| TEMP-04 emissivity | Camera write disabled; software correction remains separate | [ ] Verify units, camera contribution, persistence and observed default |
| TEMP-05 temperature adjustment | Camera write disabled | [ ] Verify whether correction is camera-side, persistence and observed default |
| TEMP-06 reflected temperature | Camera write disabled; software correction remains separate | [ ] Verify camera contribution, persistence and observed default |
| TEMP-07 ambient temperature | Camera write disabled | [ ] Verify camera contribution, persistence and observed default |
| TEMP-08 thermal parameter reset | Camera reset disabled | [ ] Verify whether reset writes camera storage and record each resulting default |
| Distance and atmospheric transmittance | Camera writes disabled | [ ] Verify units, raw 128 scaling, persistence and observed defaults |

The TEMP labels follow the [audit](android-app.md); do not assume an Android reset writes camera storage. TisoView rendering choices do not establish USB commands. Acceptance of #22 remains pending the owner hardware results and unresolved protocol/conversion evidence.

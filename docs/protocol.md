# P2 Pro USB protocol

Version 1 of irvis's experimental description. No closed vendor libraries are used. These commands are not yet hardware-verified on the TOOLTOP T7 (PID 5840). USB IDs are shared by other cameras; select the camera explicitly when several match.

Primary source: [LeoDJ/P2Pro-Viewer P2Pro_cmd.py, revision 23887289](https://github.com/LeoDJ/P2Pro-Viewer/blob/23887289d3841fdae25c3a11b8d3eed8cd778800/P2Pro/P2Pro_cmd.py). The implementation is attributed in `NOTICE`. Confidence **reported** means implemented or described in that source, not measured here; **hypothesis** means a probe assumption. No entry below has measured confidence.

## Transfers

| Entry | Encoding | Confidence |
| --- | --- | --- |
| Write | Vendor/interface OUT, bmRequestType 41, bRequest 45, wValue 0078 | reported |
| Read | Vendor/interface IN, C1 / 44 / 0078 | reported |
| Status | Read one byte at wIndex 0200; bits 0–1 busy, bits 2–7 error | reported |
| Long request | Write eight bytes at 9d00: command u16 LE, selector u16 BE, value u32 BE; then eight at 1d08: zero u32 BE, response length u32 BE | reported |
| Long reply | Wait for ready, read at 1d10 | reported |
| Standard read | Write at 1d00: command u16 LE, parameter zero u32, response length u16 BE; wait ready, read at 1d08 | reported for parameter zero |
| Standard palette write | At 9d00: command u16 LE, zero u32, length 1 u16 BE; wait, send one palette byte at 1d08, wait again | reported |

All numeric codes above are hexadecimal. The CLI checks ready before a transaction, polls every 10 ms for at most five seconds and limits each transfer to one second. A short read or nonzero status error fails the transaction. No interface is claimed by the normal path.

## Commands and state

| Entry | Meaning | Confidence |
| --- | --- | --- |
| 8514 / c514 | Read / write TPD; reply u16 BE | reported |
| TPD 0 | Distance: raw / 163.835 metres, raw 0–32767 | reported |
| TPD 1, 2 | Reflected and atmospheric temperature, raw kelvin 0–1024 | reported |
| TPD 3, 4 | Emissivity and atmospheric transmittance, raw / 127, 0–127 | reported |
| TPD 5 | Gain: 0 low, 1 high | reported |
| 8409 / c409 | Read / write palette on preview path zero; 1 white hot, 3 iron red, 11 black hot, 2 reserved | reported |
| 8b0d | Current sensor temperature command | reported name only |
| 8b0d reply | Two-byte standard read; logged as hex, with no unit or endian interpretation | hypothesis |
| c10f / 020f | Preview start / stop | reported, not sent by this tool |
| 010a / 020a | Y16 preview start / stop | reported, not sent by this tool |
| 840c | Shutter temperature; not an established NUC trigger | reported name only |
| NUC | Unknown; `usb nuc` logs unsupported and sends nothing | unresolved |

The TPD ranges are source claims, not proof that their extremes are useful. The CLI stores raw values. It does not populate the reserved software emissivity state fields until the effect on thermal pixels is known, and does not add a low-gain temperature conversion.

## NUC investigation and fallback

The pinned P2Pro-Viewer source has no NUC implementation. [atomic14/InfiRayCapture](https://github.com/atomic14/InfiRayCapture) describes video capture rather than shutter control. [thermal-cat's P2 Pro adapter](https://github.com/alufers/thermal-cat/blob/master/src/camera_adapter/infiray_p2_pro.rs) decodes frames but supplies no shutter command. Other InfiRay model protocols are not sufficient evidence to send their opcodes to a P2 Pro.

TODO(owner): obtain a trace of the official application's shutter action or a verified public P2 Pro command sequence. Until then observe automatic shutter events with the M1 report and record audible clicks. This is a limitation, not a successful manual NUC test.

## Platform access

The CLI uses the [node-usb legacy API](https://node-usb.github.io/node-usb/) to avoid WebUSB's interface-claim requirements. Attempt (a) opens the device and sends EP0 transfers without claiming or auto-detaching. Kernel-driver queries may be unsupported; the log preserves that as unknown, never false.

Attempt (b), `--detach`, explicitly detaches interface 0, never claims it, and tries to reattach in cleanup. Stop all video consumers first. On macOS 12+ detaching may need root or an entitlement; it is a diagnostic experiment, not a release strategy. Do not infer streaming coexistence from this attempt.

If (a) fails on macOS, attempt (c) is an IOKit helper using `IOUSBDeviceInterface::DeviceRequest` without seizing the video interface. `tools/capture-cli/iokit-request.c` implements this diagnostic helper; `--iokit <path>` uses it for each transfer with a two-second process timeout. It opens and closes the device per request without seizing it. Compilation is checked on macOS; coexistence is not yet measured. Linux with udev access is the other fallback, pending a real-device run. On Windows, installing WinUSB through Zadig can remove the UVC interface from video capture; Windows is not a supported execution target for this spike.

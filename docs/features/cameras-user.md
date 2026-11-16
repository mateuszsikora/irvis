# Cameras

irvis supports a camera model through a camera profile: data that says how to recognise the camera, which video modes it offers, where the temperatures are in a frame, how raw values become degrees Celsius, what the sensor can do, which settings the camera keeps, and which commands it accepts. A new model is a new profile, with no change to the UI, the backends or the recording format. This document is for whoever adds or changes a profile. One camera is registered: the InfiRay P2 Pro ([supported cameras](#supported-cameras)).

## Add a camera

1. Pick an id: lowercase kebab-case, for example `infiray-p2pro`. It is also the directory name.
2. Create `packages/core/src/cameras/<id>/profile.ts` exporting a `CameraProfile`:

   ```ts
   import type { CameraProfile } from '../profile.ts';

   export const profile: CameraProfile = {
     id: 'infiray-p2pro',
     version: 1, // raise it whenever a constant that changes readings changes
     name: 'InfiRay P2 Pro',
     // identification, videoModes, sensor, conversions, state, commands
   };
   ```

3. Create `packages/core/src/cameras/<id>/README.md` with the source and the confidence of every constant: links, measurements, and what is still a guess.
4. Add the profile to `cameraProfiles` in `packages/core/src/cameras/index.ts`.
5. Run `npm test`. The registry test validates every registered profile and fails with one line per problem (see [problems](#problems-the-check-reports)).
6. Update [cameras: technical](cameras-technical.md) if the schema changed, and add the camera to `docs/features/cameras-user.md` (this document). `npm run docs-check` asks for one of the two whenever `packages/core/src/cameras/` changes.

Every constant carries a `source` (where it comes from, in words a reader can follow) and a `confidence`:

| Confidence | Meaning |
| --- | --- |
| `confirmed` | Several independent sources agree, or it was measured against a reference |
| `measured` | Measured by this project on a real camera |
| `reported` | One public source, such as a forum post or another project's code |
| `unverified` | A guess or an inference nobody has checked |

## Describe what the camera does

The parts of a profile, field by field, are in the [technical document](cameras-technical.md#schema). In short:

- **Version:** a positive integer, raised whenever a constant that changes readings changes. Every recording stores the profile's id and version, so it is clear later which constants it was made with.
- **Identification:** one or more USB vendor and product IDs, and optionally a pattern for the device name. When two models share a USB ID (the TOOLTOP T7 and the TOPDON TC001 both use product ID 0x5830), the name pattern decides; when it cannot, the user chooses.
- **Video modes:** resolution, frame rate, pixel format (`yuyv`), the command that must run first if the mode needs one, and where the image rows and the temperature rows are. A mode without temperature data has `layout: null`.
- **Conversion:** one per gain mode, as data: linear (`raw × scale + offset`), a polynomial, or a lookup table.
- **Sensor:** resolution, noise (NETD), accuracy, and the temperature range of each gain mode. The P2 Pro profile uses a scene-based noise estimate, not a calibrated NETD specification. Its high-gain conversion suggests `recordingThreshold: 10` raw units (0.15625 K); recording callers pass this explicitly to the writer, while lossless photos continue to use zero. Other profiles can omit `recordingThreshold` when no default has been measured.
- **Camera state:** settings the camera keeps that change the data or how to read them. A field called `gain` selects the conversion, and its `default` is what the browser assumes until the user declares the mode. If the camera applies an emissivity and a reflected temperature to its raw values itself, name those fields `emissivity` (a number from greater than 0 to 1) and `reflected-temperature` (°C), both with `affects: 'data'`; irvis then corrects readings from what the camera applied and never applies emissivity twice. Use other ids for settings that change only the camera's own image.
- **Commands:** what the desktop app can send, over a USB vendor control transfer or a UVC extension unit, and which state fields each one changes.

## How a camera is recognised

When a device appears, irvis looks for profiles that list its USB IDs. If more than one does, it keeps those whose name pattern matches the device name, unless none matches. In the browser, which usually does not see USB IDs, only the name pattern counts. One remaining profile is used directly; several mean the user picks one; none means the camera is not supported.

## Problems the check reports

The registry test fails with a list of messages for each invalid profile, for example:

```
videoModes.yuyv-256x384.layout.thermal: rows 300 to 491 go past the frame height 384
conversions: no conversion for gain 'low'
commands.nuc: changes unknown state field 'palette'
```

Every message is listed in the [technical document](cameras-technical.md#failure-modes).

## Supported cameras

| Profile | Camera | Modes | What works |
| --- | --- | --- | --- |
| `infiray-p2pro` | InfiRay P2 Pro, also sold as the TOOLTOP T7 (USB `0x0bda:0x5830` or `0x0bda:0x5840`) | 256×384 at 25 fps with temperature data in the lower half; 256×192 at 25 fps without | Temperatures in high gain only, °C = raw / 64 − 273.15, from other projects; absolute temperature accuracy is not independently verified. No commands yet |

Where each constant of the P2 Pro profile comes from: [its README](../../packages/core/src/cameras/infiray-p2pro/README.md). The TOPDON TC001 reports the same USB ID; it has no profile, so it would be matched as a P2 Pro.

## See also

- [Cameras: technical](cameras-technical.md)
- [Core](core-user.md)
- [Why a camera is a profile](../decisions/architecture.md#a-camera-is-a-profile-and-its-conversion-is-data)

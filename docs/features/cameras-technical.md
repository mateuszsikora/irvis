# Cameras: technical

How the camera registry and the profile schema in `packages/core/src/cameras/` work, for whoever changes them. Adding a camera: [cameras](cameras-user.md#add-a-camera). Why profiles are data: [decision](../decisions/architecture.md#a-camera-is-a-profile-and-its-conversion-is-data).

## Data flow

1. `cameraProfiles` in `src/cameras/index.ts` lists every profile compiled into the app: today only `infiray-p2pro` ([below](#infiray-p2pro)).
2. A backend describes a device as a `DeviceDescription` (`vendorId`, `productId`, `label`, each optional). `matchProfiles(device, profiles = cameraProfiles)` returns the candidates:
   - with both USB IDs: the profiles whose `identification.usb` lists the pair; if there are several and the label matches the `labelPattern` of at least one, only those;
   - without them: the profiles whose `labelPattern` matches the label.

   A pattern is compiled with `new RegExp(pattern, 'i')` on every call. A profile without `labelPattern` never matches by label.
3. The caller opens the device with the single candidate, or lets the user choose among several (planned in #17 and #20).
4. The backend and the decoder (`decodeThermalFrame`, [core: technical](core-technical.md#data-flow)) read the chosen `VideoMode` and `FrameLayout`; every `ThermalFrame` carries the `Conversion` of the current gain and a `CameraStateSnapshot` ([core: technical](core-technical.md#schema)).
5. `toCelsius(raw, conversion)` (`src/cameras/conversion.ts`) turns a raw value into °C: linear `raw × scale + offset`; a polynomial by Horner's scheme from the highest coefficient; a lookup table `celsius[raw − firstRaw]`, `NaN` outside the table. Only `+`, `-`, `*` and indexing, so every engine gives the same bits ([decision](../decisions/architecture.md#measurement-code-uses-only-correctly-rounded-arithmetic)). `toCelsiusArray` does the same for a whole `Uint16Array` into a `Float64Array`.

`validateProfile(profile)` (`src/cameras/validate.ts`) checks what the types cannot. Nothing calls it at runtime; the registry test runs it on every registered profile.

## Schema

The types are in `src/cameras/profile.ts`; each field has a TSDoc comment.

| Type | Fields | Rules `validateProfile` checks |
| --- | --- | --- |
| `CameraProfile` | `id`, `version`, `name`, `identification`, `videoModes`, `sensor`, `conversions`, `state`, `commands` | `id` kebab-case; `version` a positive integer, raised whenever a constant that changes readings changes (every `.irvis` header records it, [decision](../decisions/architecture.md#camera-profiles-carry-a-version)); `name` not blank |
| `Provenance` | `source`, `confidence` (`confirmed`, `measured`, `reported`, `unverified`) | `source` not blank; `confidence` one of the four. Part of every `ProfileConversion`, `MeasurementRange`, `CameraCommand`, `sensor.netd` and `sensor.accuracy` |
| `CameraIdentification` | `usb: UsbId[]` (`vendorId`, `productId`), optional `labelPattern` (regular expression source) | at least one USB ID, each an integer from 0 to 0xffff; the pattern compiles |
| `VideoMode` | `id`, `width`, `height`, `fps`, `pixelFormat: 'yuyv'`, optional `enableCommand`, `layout: FrameLayout \| null` | ids unique and kebab-case; positive integer size; `fps` > 0; `enableCommand` names a command of the profile |
| `FrameLayout` | optional `image: RowRange`, `thermal: RowRange & { packing: 'u16le' }` | each range (`firstRow`, `rows`) lies inside the frame; the two do not overlap; the thermal block is `sensor.width` × `sensor.height` values (the mode's `width` values per row, `rows` rows) |
| `SensorSpec` | `width`, `height`, optional `netd` (`kelvin`), optional `accuracy` (`celsius`, `percent`), `ranges: MeasurementRange[]` (`gain`, `minCelsius`, `maxCelsius`) | positive integer size; `kelvin` > 0; accuracy values ≥ 0; `minCelsius` < `maxCelsius`; each range's `gain` unique and, with an enum state field `gain`, one of its values |
| `Conversion` | `{ kind: 'linear'; scale; offset }`: °C = raw × scale + offset. `{ kind: 'polynomial'; coefficients }`: °C = c0 + c1·raw + …, by Horner's scheme. `{ kind: 'lut'; firstRaw; celsius }`: °C = celsius[raw − firstRaw] | `scale` finite and not 0, `offset` finite; at least two finite coefficients; `firstRaw` from 0 to 65535, a non-empty table of finite values that ends at or below raw 65535 |
| `ProfileConversion` | `gain`, `conversion`, optional `recordingThreshold`, provenance | `recordingThreshold` is an integer 0–32767 in raw units, absent means no suggestion; at least one; `gain` unique; with an enum state field `gain`: one conversion for each of its values and none for other values; without it: exactly one conversion |
| `CameraStateField` | `id`, `label`, `affects` (`data` or `meaning`), `refresh` (`command` or `second`), and `{ kind: 'enum'; values; default }` or `{ kind: 'number'; unit; default }` | ids unique and kebab-case; an enum has unique values and its `default` is one of them; a number's `default` is finite; a field called `gain` is an enum; `emissivity` and `reflected-temperature` come together, each a number with `affects: 'data'`, unit `''` (default greater than 0 and at most 1) and `°C` (default above −273.15) |
| `CameraStateSnapshot` | `origin` (`camera`, `declared`, `assumed`), `values` (by field id) | Not part of a profile: what a frame carries |
| `CameraCommand` | `id`, `label`, `transport`, optional `followUp` (ordered vendor transfers), `changes` (state field ids), provenance | ids unique and kebab-case; `changes` names existing fields |
| `VendorControlTransport` | `kind: 'vendor-control'`, `requestType`, `request` (0–0xff), `value`, `index` (0–0xffff), `data` | every number in its range, every data byte 0–0xff |
| `UvcExtensionUnitTransport` | `kind: 'uvc-xu'`, `unit`, `selector` (0–0xff), `data` | the same |

Three state field ids are reserved, because code outside the profile reads them from a frame's `CameraStateSnapshot`: `gain` selects the conversion, and `emissivity` and `reflected-temperature` (`EMISSIVITY_FIELD`, `REFLECTED_TEMPERATURE_FIELD` in `src/cameras/fields.ts`) are the emissivity correction the camera applies to its raw values itself. The software correction starts from them, so it never applies emissivity twice ([decision](../decisions/architecture.md#the-software-correction-works-relative-to-what-the-camera-applied), [core: technical](core-technical.md#data-flow)). A camera that keeps an emissivity only for its own image gives that field another id. No profile has them yet; whether the P2 Pro applies its TPD emissivity to the raw values is measured in #7.

Gain commands encode fixed values as transfer sequences. TODO(owner): measure camera state effects and sensor-temperature encoding before modelling conversion parameters that change every frame.

## infiray-p2pro

`src/cameras/infiray-p2pro/profile.ts`, with the source and confidence of every constant in its [README](../../packages/core/src/cameras/infiray-p2pro/README.md):

| Part | Value |
| --- | --- |
| `version` | 3 |
| `identification` | USB `0x0bda:0x5830` and `0x0bda:0x5840`, no `labelPattern` (`USB Camera` is not specific enough to identify a model) |
| `videoModes` | `yuyv-256x384`, 25 fps, `image` rows 0–191, `thermal` rows 192–383 `u16le`, no `enableCommand`; `yuyv-256x192`, 25 fps, `layout: null` |
| `sensor` | 256×192, scene-based `netd.kelvin` 0.07545446351476191 (`measured`), no `accuracy`, `ranges` empty |
| `conversions` | High and low gain: linear, `scale` 1/64, `offset` −273.15, confidence `reported`; high `maxCelsius: 160`, low `minCelsius: 90`; high `recordingThreshold: 10` (0.15625 K) |
| `state`, `commands` | Gain enum, emissivity and reflected temperature; fixed gain commands and four bounded numeric correction commands |

M5 inspected the Android implementation and compared both gains on a cooling hot kettle. Both use raw / 64 − 273.15; the confidence stays reported because there was no independent reference thermometer. Vendor Low maps to high sensor gain and High to low sensor gain. Conversion limits follow vendor display clipping, not a calibrated accuracy specification.

The high-gain recording suggestion is ceil(2 × NETD × 64). It uses unadjusted temporal noise from 256 event-free frames of the stationary wall scene; it is not a calibrated NETD specification. Writers still require an explicit threshold. Photos remain lossless by default. See the [decision](../decisions/architecture.md#recording-defaults-use-twice-the-static-scene-noise).

## Interfaces

Exported from `@irvis/core` (`src/cameras/index.ts`):

| Name | Signature | Notes |
| --- | --- | --- |
| `cameraProfiles` | `readonly CameraProfile[]` | The registry |
| `findProfile` | `(id: string, profiles = cameraProfiles) => CameraProfile \| undefined` | |
| `matchProfiles` | `(device: DeviceDescription, profiles = cameraProfiles) => CameraProfile[]` | Order follows `profiles`. See [data flow](#data-flow) |
| `validateProfile` | `(profile: CameraProfile) => string[]` | One message per problem, empty when the profile is consistent |
| `EMISSIVITY_FIELD`, `REFLECTED_TEMPERATURE_FIELD` | `'emissivity'`, `'reflected-temperature'` | The reserved state field ids ([schema](#schema)) |
| `toCelsius` | `(raw: number, conversion: Conversion) => number` | `NaN` for a raw value outside a lookup table |
| `toCelsiusArray` | `(raw: Uint16Array, conversion: Conversion) => Float64Array` | |
| types | everything in `src/cameras/profile.ts`, and `DeviceDescription` | |

## Failure modes

`validateProfile` messages, verbatim, with the parts in angle brackets filled in. Numbers are decimal. `<where>` is the path of the part, for example `conversions.high`, `commands.nuc` or `sensor.ranges[0]`.

| Message | Cause |
| --- | --- |
| `id '<id>' is not kebab-case` | The profile id |
| `version <version> is not a positive integer` | |
| `name is empty` | |
| `identification: no USB ID` | |
| `identification: USB ID <vendorId>:<productId> is not two 16-bit integers` | |
| `identification: labelPattern '<pattern>' is not a valid regular expression` | |
| `<where>: source is empty`, `<where>: unknown confidence '<value>'` | Provenance |
| `sensor: width and height must be positive integers` | |
| `<where>: recordingThreshold must be an integer from 0 to 32767` | Invalid optional recording suggestion for a gain |
| `sensor.netd: kelvin must be greater than 0` | |
| `sensor.accuracy: celsius and percent must be 0 or more` | |
| `sensor.ranges[<i>]: minCelsius must be below maxCelsius` | |
| `sensor.ranges: gain '<gain>' appears twice`, `sensor.ranges[<i>]: '<gain>' is not a value of state field 'gain'` | Ranges are checked against the `gain` field like conversions, but a gain value without a range is allowed |
| `state: field '<id>' appears twice`, `state: field id '<id>' is not kebab-case` | |
| `state.<id>: no values`, `state.<id>: value '<value>' appears twice`, `state.<id>: default '<value>' is not one of its values` | Enum field |
| `state.<id>: default must be finite` | Number field |
| `state.gain: must be an enum, because it selects the conversion` | |
| `state.emissivity: needs the state field 'reflected-temperature' too`, `state.reflected-temperature: needs the state field 'emissivity' too` | One of the two reserved emissivity fields without the other |
| `state.emissivity: must be a number field with affects 'data' and unit '', because the emissivity correction reads it`, `state.reflected-temperature: must be a number field with affects 'data' and unit '°C', because the emissivity correction reads it` | A reserved field of another kind, `affects` or unit |
| `state.emissivity: default must be greater than 0 and at most 1`, `state.reflected-temperature: default must be above -273.15 °C` | |
| `commands: '<id>' appears twice`, `commands: id '<id>' is not kebab-case` | |
| `commands.<id>: <field> must be an integer from 0 to <max>` | `<field>` is `requestType`, `request`, `value`, `index`, `unit` or `selector`; `<max>` is 255 or 65535 |
| `commands.<id>: every data byte must be 0 to 255` | |
| `commands.<id>: changes unknown state field '<field>'` | |
| `videoModes: none`, `videoModes: '<id>' appears twice`, `videoModes: id '<id>' is not kebab-case` | |
| `videoModes.<id>: width and height must be positive integers`, `videoModes.<id>: fps must be greater than 0` | |
| `videoModes.<id>: enableCommand '<command>' is not a command of the profile` | |
| `videoModes.<id>.layout.<image or thermal>: firstRow and rows must be integers inside the frame` | |
| `videoModes.<id>.layout.<image or thermal>: rows <first> to <last> go past the frame height <height>` | |
| `videoModes.<id>.layout: image and thermal rows overlap` | |
| `videoModes.<id>.layout.thermal: <width>×<rows> values do not match the sensor's <width>×<height>` | |
| `conversions: none`, `conversions: gain '<gain>' appears twice` | |
| `conversions: no conversion for gain '<value>'` | A value of the `gain` field has no conversion |
| `conversions: more than one, but there is no enum state field 'gain' to choose between them` | |
| `conversions.<gain>: '<gain>' is not a value of state field 'gain'` | |
| `conversions.<gain>: scale must be finite and not 0`, `conversions.<gain>: offset must be finite` | Linear |
| `conversions.<gain>: a polynomial needs at least two coefficients`, `conversions.<gain>: every coefficient must be finite` | Polynomial |
| `conversions.<gain>: firstRaw must be an integer from 0 to 65535`, `conversions.<gain>: the table is empty`, `conversions.<gain>: the table goes past raw 65535`, `conversions.<gain>: every table value must be finite` | Lookup table |

## Tests

| File | Covers |
| --- | --- |
| `packages/core/src/cameras/index.test.ts` | Every registered profile passes `validateProfile` and the ids are unique ([invariant 18](../invariants.md)); `findProfile`; `matchProfiles` by USB ID, a shared USB ID narrowed by the label, several candidates when the label does not decide, the label alone, and no input |
| `packages/core/src/cameras/validate.test.ts` | A consistent profile passes; one test per kind of problem: id, version, USB IDs, label pattern, rows past the frame, overlapping rows, thermal size against the sensor, unknown enable command, missing and unselectable conversions, measurement ranges with an unknown or repeated gain, linear scale 0, empty source, unknown state field in a command, the reserved emissivity fields (accepted together; alone, of another kind or unit, and with defaults out of range rejected; [invariant 28](../invariants.md)), transport ranges |
| `packages/core/src/cameras/conversion.test.ts` | `toCelsius` for linear, polynomial and lookup-table conversions, `NaN` outside a table; `toCelsiusArray` |
| `packages/core/src/cameras/infiray-p2pro/profile.test.ts` | The P2 Pro profile is registered and valid, matches `0x0bda:0x5830` and `0x0bda:0x5840`, and a synthetic 256×384 frame (196 608 B) decodes to 22.5 °C and a 35 °C centre |
| `packages/core/test/profiles.ts` | Not a test: `testProfile(overrides)`, a consistent profile with made-up constants that the tests above change one part at a time |

Not covered: every message in the table above has its check in `validate.ts`, but not every one has a test. Real packed camera fixtures and v1 recording regressions are covered in `packages/core/test/real-frames.test.ts`; the profile test checks the noise-derived threshold and the validator test checks its allowed range.

## See also

- [Cameras](cameras-user.md)
- [Core: technical](core-technical.md)

## Experimental USB commands

`CameraCommand.followUp` optionally holds vendor transfers sent after `transport`, in order, before checking readiness. `validateProfile` validates their fields like the first transport. The P2 Pro profile declares `gain-high` and `gain-low`; its exported `usbProtocol` holds TPD limits, selectors and transfer constants, plus the explicitly hypothetical sensor-temperature reply length. EMS/TAU accept raw 128 to restore the initial values observed on the T7; the desktop ratio decoding now uses 128 following M5 measurements and the newer open implementation. See [protocol](../protocol.md) for provenance and confidence. The CLI rereads all probe state after commands independently of `changes`, which names decoded correction fields for the numeric commands; gain now selects one of the two reported conversions.

`CameraCommand.parameter` optionally declares numeric `min`, `max`, `step`, `default`, `unit`, positive `scale`, `offset`, `byteOffset` and raw snapshot `readback` field. Encoding is round(value × scale + offset) as unsigned BE u32 in the first vendor transfer. Validation checks finite bounds/default/scale, encoded range, offset fit and kebab-case readback ID.

P2 Pro profile version 3 adds four numeric TPD writes and decoded emissivity/reflected-temperature state. Ratio input bounds are 0.5–1, step 1/128; reflected temperature is −20–120 °C and ambient temperature −20–50 °C, step 1 K. Defaults reflect the tested T7 startup state, not universal factory settings. Raw TPD fields remain available in snapshots. Both gains now have reported conversions and display-derived reading limits. Automatic range and reset are host sequences using these verified commands, not new USB opcodes; NUC and distance writes remain unavailable. See [M5 observations](../findings/m5-hardware.md).

`ProfileConversion.minCelsius` and `maxCelsius` are optional finite reading limits; when both are present they must increase. The viewer marks readings outside them uncertain before host correction, preserving the mask in photos and recordings. They do not alter conversion coefficients or claim a calibrated sensor range.

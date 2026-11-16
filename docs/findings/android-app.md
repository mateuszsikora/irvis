# Android vendor app feature and evidence catalogue

Directly observed inventory for [#11](https://github.com/mateuszsikora/irvis/issues/11). This report describes the Android app, not implemented irvis behaviour. The audit used the connected phone on 16 November 2026. A Wi-Fi interruption was resolved through USB before continuing. The owner accepted the feature list. The accepted text catalogue and implementation handoff complete the revised inventory scope of #11; implementing the features remains M4/M5 work.

## Source and evidence

- App's About text: `Infrared Thermal Imager`, `App Version:3.07.48`.
- Android package: `com.dyt.wcc.neutral`; version code `648`.
- Foreground activity: `com.dyt.wcc.ui.preview.tiny1c.Tiny1CActivity`.
- Phone: OnePlus 6T (`ONEPLUS A6013`), Android 11.
- The owner connected the camera, opened the app and confirmed its model as TOOLTOP T7. The activity name alone does not identify the hardware.
- Screenshots and recordings remain private in the gitignored `.context/android-audit/` directory. They are excluded from the repository and issue attachments at the owner's request. Capture numbers below are references to that local archive, not public links. Its `manifest.json`, `catalog.json`, `catalog.csv` and `features.json` record artifact identities and feature mappings; `index.html` and `review-bundle.zip` provide local review copies. The text catalogue is the public deliverable.
- Values below are the observed configuration, not factory defaults. The thermal-parameter reset was exercised; the final-state section records restoration. No USB traffic was captured.

## Feature catalogue

The 27 entries below describe the vendor app and its tested user flows. IDs are stable catalogue references, not irvis test IDs. Each entry gives its purpose, entry point, observed result, coverage, implementation classification and evidence.

**Coverage:** `Exercised` means the stated flow was tested; it does not mean exhaustive QA. `Partial` means some sub-actions remain unconfirmed. `Inventoried` means controls/options were inspected without testing every action.

**Implementation:** `software` means a proposed host implementation from available frames; `hardware` means camera control. This does not reveal how the vendor implemented a feature. Thermal parameters, TisoView and range switching still need [protocol evidence](m2.md).

**Scope:** the owner accepted the feature list as parity targets, except language selection. Language selection is excluded by the owner's English-only decision; the vendor language list is retained solely as evidence. See [UI language decision](../decisions/architecture.md#the-ui-uses-simple-english-only).

| Group | IDs | Entries |
| --- | --- | --- |
| [View and rendering](#view-and-rendering) | VIEW-01–06 | 6 |
| [Measurements and overlays](#measurements-and-overlays) | MEASURE-01–05 | 5 |
| [Temperature settings and alarm](#temperature-settings-and-alarm) | TEMP-01–08 | 8 |
| [Photos and analysis](#photos-and-analysis) | PHOTO-01–03 | 3 |
| [Video and gallery](#video-and-gallery) | MEDIA-01–04 | 4 |
| [Vendor-only settings](#vendor-only-settings) | LANG-01 | 1 |

## View and rendering

### VIEW-01 — Live thermal image and scale

**Purpose:** See the thermal scene and relate its colours to displayed temperatures.

**Open:** Main preview.

**Observed:** Updating image, numeric temperatures and colour scale

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 01.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #17.

### VIEW-02 — Six palette choices

**Purpose:** Choose how temperature differences are represented by colour.

**Open:** Colour-wheel button on the right toolbar.

**Observed:** Six unlabelled colour icons, including opposite greyscale ramps; exact names and colour values were not established

**Coverage:** Inventoried.

**Implementation:** software.

**Evidence:** 08, 09.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #12, #17.

### VIEW-03 — Automatic and manual colour range

**Purpose:** Let the palette follow the scene or choose its lower and upper limits.

**Open:** A/scale button at the bottom of the right toolbar.

**Observed:** The `A`/scale button exposes lower and upper handles on an extended temperature scale. Dragging the lower handle changed its displayed value from 19.2 to 9.6 °C; the upper handle also moved from 22.8 to 30.8 °C. Trying to drag the lower handle above it stopped at 30.2 °C, preserving their order in that attempt. Toggling the button again restores automatic display

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 01, 16, 39, 40, 123–125.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #17.

### VIEW-04 — Scale lock control

**Purpose:** Keep the colour mapping stable while the scene changes.

**Open:** Padlock beside the temperature scale.

**Observed:** Padlock freezes colour-scale bounds: 8.4 and 22.7 °C remained unchanged across two captures while scene extrema changed. Unlock restores automatic bounds

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 36–38.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #17.

### VIEW-05 — Image transformation

**Purpose:** Mirror the image horizontally or vertically and lock the preview orientation.

**Open:** Split-triangle button on the right toolbar.

**Observed:** Horizontal and vertical reflection were each toggled and restored. Orientation lock changes Android's requested orientation from 6 to 0 while remaining landscape; unlocking restores 6. Physical rotation was not exercised

**Coverage:** Partial.

**Implementation:** software.

**Evidence:** 32, 33, 41, 62.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #17.

### VIEW-06 — Image enhancement

**Purpose:** Choose the vendor's clear or smooth rendering mode.

**Open:** Settings → TisoView; question-mark icon opens the explanation.

**Observed:** `TisoView` On/Off; help says `On: Clear image` and `Off: Smooth image`; Off visibly changes image rendering, then On restored

**Coverage:** Exercised.

**Implementation:** software rendering feature for irvis; exact vendor algorithm and any camera-side contribution remain unverified.

**Evidence:** 18, 105.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #17, #22.

## Measurements and overlays

### MEASURE-01 — Global temperature tracking

**Purpose:** Locate the hottest and coldest pixels and read the centre of the image.

**Open:** Settings → High temperature tracking / Center point temperature / Low temperature tracking.

**Observed:** Separate On/Off settings for `High temperature tracking`, `Center point temperature`, `Low temperature tracking`; all toggled Off (markers disappear), then restored On

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 02, 03, 17, 106.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #18.

### MEASURE-02 — Measurement tools

**Purpose:** Measure a chosen point, line or rectangular region, with several objects visible together.

**Open:** Measurement-tools button on the right toolbar; select point, line or rectangle, then place it on the image.

**Observed:** Point, line and rectangle coexist, with a limit of three of each; fourth-object attempts did not add another. Point displays a reading; line and rectangle display local minimum and maximum markers. Points, lines and rectangles can be moved and individually deleted using the transient trash icon after a long press; rectangles expose resize handles and were resized. The tested line drag moved the whole line; endpoint resizing was not established

**Coverage:** Partial.

**Implementation:** software.

**Evidence:** 10–13, 64–66, 68–71, 126, 127, 129–132.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #18.

### MEASURE-03 — Reset measurements

**Purpose:** Clear added measurement objects in one action.

**Open:** Circular arrow on the left toolbar.

**Observed:** Left circular arrow removes added points, lines and rectangles together; global min/max/centre tracking remains. UI resource: `iv_preview_left_Reset`. This is not evidence of a NUC command

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 71, 72.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #18.

### MEASURE-04 — Tracking shortcuts

**Purpose:** Access the three tracking-marker controls from the preview.

**Open:** Plus button on the right toolbar.

**Observed:** Plus button opens red, blue and yellow marker icons

**Coverage:** Inventoried.

**Implementation:** software.

**Evidence:** 14.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #18.

### MEASURE-05 — Region highlighting

**Purpose:** Emphasize a selected region by suppressing surrounding colour.

**Open:** Magnifier-in-square button on the right toolbar.

**Observed:** Magnifier-in-square button leaves the drawn rectangle coloured and makes the surrounding image greyscale

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 15.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #17, #18.

## Temperature settings and alarm

### TEMP-01 — Units

**Purpose:** Read temperatures in Celsius, Fahrenheit or kelvins.

**Open:** Settings → Temperature Unit.

**Observed:** Switching to °F and K changes displayed readings and scale units; °C restored

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 95, 103, 104.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #13, #18.

### TEMP-02 — Threshold setting

**Purpose:** Sound an alarm when the temperature exceeds a chosen threshold.

**Open:** Thermometer/warning button on the left toolbar.

**Observed:** Signed picker with one decimal place. With the scene around 20 °C, 0 °C triggered audio and 100 °C did not start playback. The owner confirmed hearing the bell. The red icon indicates enabled state, including below the threshold; white is disabled. Left disabled and not retested after the owner asked

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 07, 56–61.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #13, #18.

### TEMP-03 — Range switching

**Purpose:** Select automatic temperature-range switching or manually choose Low/High.

**Open:** Settings → High and low temperature range switch → High and Low TEMP. Switch.

**Observed:** `Auto.` disables the Low/High selector. `Manual` enables it. After selecting High and waiting for the switch, room-temperature readings become `<90.0 °C`. Low and Auto were restored. Switching shows a busy indicator; a tap during this period may not take effect

**Coverage:** Exercised.

**Implementation:** hardware; the UI control is observed, while its correspondence with specific gain commands must be verified in #22.

**Evidence:** 112, 121, 122.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #7, #22.

### TEMP-04 — Emissivity

**Purpose:** Enter the object's emissivity for temperature correction.

**Open:** Settings → Thermal Parameters → Emissivity.

**Observed:** Accepted and retained 0.95; rejected 0 and 1.01 with `The value range is (0.01 ~ 1.00)`. Numeric keyboard Done commits the value; simply dismissing it does not. Restored 1.00

**Coverage:** Exercised.

**Implementation:** software correction input in irvis; any camera-side correction requires a verified command in #22.

**Evidence:** 80–84.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #13, #18, #22.

### TEMP-05 — Temperature adjustment

**Purpose:** Apply a numeric temperature adjustment.

**Open:** Settings → Thermal Parameters → Temperature Adjustment.

**Observed:** Accepted 1.5; rejected 1000 with `The value range is (-20.00 ~ 20.00)`. Restored 0.0

**Coverage:** Exercised.

**Implementation:** software correction input in irvis; vendor computation location is unverified. #18 must document the host correction model or show an unsupported state; camera commands belong to #22.

**Evidence:** 85, 86.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #13, #18, #22.

### TEMP-06 — Reflected temperature

**Purpose:** Supply the reflected-temperature input used by the vendor's correction.

**Open:** Settings → Thermal Parameters → Reflection Temperature.

**Observed:** Accepted 25; rejected 1000 with `The value range is (-20 ~ 120)`. Original value 27

**Coverage:** Exercised.

**Implementation:** software correction input in irvis; vendor computation location is unverified. #18 must document the host correction model or show an unsupported state; camera commands belong to #22.

**Evidence:** 87, 88.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #13, #18, #22.

### TEMP-07 — Ambient temperature

**Purpose:** Supply the ambient-temperature input used by the vendor's correction.

**Open:** Settings → Thermal Parameters → Ambient Temperature.

**Observed:** Accepted 25; rejected 1000 with `The value range is (-20 ~ 50)`. Original value 27

**Coverage:** Exercised.

**Implementation:** software correction input in irvis; vendor computation location is unverified. #18 must document the host correction model or show an unsupported state; camera commands belong to #22.

**Evidence:** 89, 90.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #13, #18, #22.

### TEMP-08 — Thermal parameter reset

**Purpose:** Restore the vendor's thermal-parameter defaults.

**Open:** Settings → Thermal Parameters → Default.

**Observed:** `Default` sets emissivity 1.0, adjustment 0.0, reflected temperature 25 °C and ambient temperature 25 °C. The original 27 °C values were subsequently restored

**Coverage:** Exercised.

**Implementation:** software reset of the correction inputs; any reset of camera-stored settings requires verified hardware support in #22.

**Evidence:** 91–93.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #18, #22.

## Photos and analysis

### PHOTO-01 — Photo capture

**Purpose:** Save the current thermal view with its visible overlays.

**Open:** Camera button on the left toolbar.

**Observed:** Camera button saves a still to the app gallery, including visible measurement overlays

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 21–23.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #15, #19.

### PHOTO-02 — Photo analysis

**Purpose:** Take new measurements from a saved thermal photo.

**Open:** Gallery → original photo → analysis icon → point, line or rectangle.

**Observed:** Added a new point to a saved photo and obtained a 19.4 °C reading. A long press exposes a trash icon. Added a new line (15.8–19.7 °C) and rectangle (16.7–20.6 °C) to the saved original, independently of its captured overlays

**Coverage:** Partial.

**Implementation:** software.

**Evidence:** 24, 45, 46, 134.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #18.

### PHOTO-03 — Photo annotation

**Purpose:** Add text or drawing annotations and retain a separate output copy.

**Open:** Gallery → original photo → text or pencil icon.

**Observed:** Drawing and text modes, colour selector, drawing-size controls, undo/redo icons. Entered `Audit` text; after leaving the editor, a separate annotated copy appeared in the gallery and could be reopened

**Coverage:** Partial.

**Implementation:** software.

**Evidence:** 23, 25, 26, 47, 48, 52, 53.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #15, #19.

## Video and gallery

### MEDIA-01 — Video recording

**Purpose:** Record the thermal view and stop it to create a playable clip.

**Open:** Video-camera button on the left toolbar.

**Observed:** Start/stop control, red icon and elapsed timer; a three-second test clip appears in the gallery. The silent clip is MP4/H.264, 1280×960, 81 decoded frames over 3.206 seconds (about 25.27 fps), with no audio stream

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 28, 29.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #19.

### MEDIA-02 — Recording audio option

**Purpose:** Include microphone sound in a video recording.

**Open:** Settings → Record with Audio, then record a clip.

**Observed:** `Record with Audio` On requests microphone permission. Granted `Only this time` for a short test: the MP4 contains H.264 1280×960 video (95 decoded frames, 3.843 s) and AAC mono audio at 44.1 kHz (3.819 s). Restored Off

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 115, 116, 119, 120; `audio-video-metadata.json`.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #19.

### MEDIA-03 — Video playback handoff

**Purpose:** Open a saved clip in an Android video player.

**Open:** Gallery → video → Play → Open with.

**Observed:** Play opens Android's `OPEN WITH` chooser. Selected Gallery with `Just once`; the silent clip played and returned to the app preview at its end

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 30, 31, 140–142.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #19.

### MEDIA-04 — Gallery management

**Purpose:** Browse, filter, select and delete saved photos and videos.

**Open:** Gallery button on the left toolbar; all/photo/video filters and trash at the top.

**Observed:** All/photo/video filters display the expected subsets. Selecting an audit-created analysis copy and tapping trash removed it immediately, without a confirmation dialog. Two additional test clips were then selected and removed; the original photo, original silent clip and first annotated copy were kept

**Coverage:** Exercised.

**Implementation:** software.

**Evidence:** 133, 136–138, 143–145.

**irvis scope:** Accepted parity target; the issue mapping does not mean this is implemented in irvis.

**Related work:** #17, #19.

## Vendor-only settings

### LANG-01 — Language selection

**Purpose:** Change the vendor app's interface language.

**Open:** Settings → Language.

**Observed:** Full list, scrolled to both ends: Chinese, English, Russian, German, Italian, Korean, Japanese, French, Spanish, Finnish, Polish and Portuguese. English retained; translation quality not tested

**Coverage:** Inventoried.

**Implementation:** software.

**Evidence:** 107–110.

**irvis scope:** Excluded: simple English only; no language selector, translation catalogues or Polish skeleton.

**Related work:** No implementation issue; excluded from #17.

## Material catalogue

The local directory contains 152 nonempty numbered screenshots, one empty failed capture, four media files, a decoded video frame, two media metadata files, four UI hierarchy dumps and two diagnostic logs. Original names and bytes are preserved. Generated indexes, the report copy and the ZIP are derived review artifacts; local automation scripts are not source evidence.

| Material | Role | How to use it |
| --- | --- | --- |
| Numbered PNG captures | Screens, test steps and restored settings | Start with the feature cards in `index.html`; the full artifact register also includes uncited exploratory captures |
| Empty `34-range-lock.png` | Failed capture during disconnection | Excluded from evidence and the review ZIP; `34-before-lock.png` is a different, valid file |
| `media/` | Original photo, annotated copy, silent clip and audio-enabled test clip | Retained locally for format analysis; raw media are excluded from the review ZIP |
| `media-metadata.json`, `audio-video-metadata.json` | Saved media probe results | Support output-format claims; a valid stream alone does not establish visual correctness |
| `audio-video-frame.png` | Frame decoded from the audio-enabled video | Shows that the recorded image exists despite its black gallery thumbnail |
| UI XML files | View labels, resource IDs and bounds | Support control identification; labels do not establish hardware semantics |
| `alarm-audio.txt` | Android audio-service diagnostic dump | Local corroboration of the alarm test; may contain unrelated app events, so excluded from the review ZIP |
| `reset-app-log.txt` | App log collected around measurement reset | Exploratory context only; no confirmed NUC command follows from this log |
| `catalog.json`, `catalog.csv`, `features.json` | Artifact register and feature index | Search by feature ID, file, coverage or evidence role |
| `index.html`, `report.txt`, `review-bundle.zip` | Review outputs | Browse descriptions and cited screenshots, or unpack the ZIP for an offline copy |

The artifact register distinguishes cited evidence, context, exploratory attempts, excluded captures and local-only diagnostics/media. In particular, filenames such as `67-point-deleted.png`, `96-kelvin.png`, `113-high-range-confirmed.png` and `135-saved-photo-area-resized.png` name attempted actions whose expected result was not confirmed. `144-delete-confirmation.png` actually shows the gallery after immediate deletion, not a confirmation dialog.

## Saved-file evidence

App-owned output is under `/sdcard/DCIM/DYTCamera/`. Only audit-created media were copied to `.context/android-audit/media/`; `media-metadata.json` records probe results. The original JPEG contains APP2 segments of 1,642, 65,535 and 32,773 bytes before the image data; the annotated copy contains a single 552-byte APP2 segment. Both have a normal JPEG end marker, without appended data. Combined with the original supporting new temperature measurements and the annotated copy opening without analysis tools, this suggests that annotation produces a flattened export. The APP2 payload was not decoded, so its exact format is unknown.

The audio-enabled clip initially showed a black gallery thumbnail, although decoding a frame at one second produced the expected thermal image (`audio-video-frame.png`). This observation does not establish how often thumbnail generation fails.

## Coverage limits and implementation handoff

- The shutter clicks automatically every 6–8 seconds according to the owner. The circular arrow resets measurement objects; the audit establishes no manual NUC control.
- Numeric validation messages establish the advertised ranges, not exhaustive boundary, precision or calibrated-accuracy tests.
- Saved-photo point/line/area creation is confirmed. Live rectangle resizing is confirmed; saved-photo resizing was attempted without a confirmed size change. No dedicated sharing control was found in the inspected gallery/editor; file copying and annotated-copy creation establish output paths, not the absence of other export routes.
- This is a functional inventory on one phone and one camera, not exhaustive vendor-app QA: no temperature reference source, physical orientation-change test, long recording, full translation review, or USB command trace. Palette icons were inventoried, not reverse-engineered into exact colour tables.
- #18 owns the documented host correction model and unsupported states. #22 owns command verification for thermal parameters and range switching, using the existing #7 findings; TisoView is an image-rendering target, not a proven command. The vendor's `Low` temperature range is not automatically equivalent to low sensor gain.
- #17 owns rendering, palette/range controls and the English-only shell; #18 owns measurement tools, overlays, correction inputs and alarm behaviour; #19 owns photos, annotations, gallery and recording/audio/playback; #22 owns verified camera controls and its hardware checklist. Their issue checklists carry the accepted Android parity targets. Closed core issues #12–#15 are historical dependencies; this audit does not claim they already implement the new UI scope.

## Final state and test side effects

The audit leaves three app-gallery artifacts: the original photo, the original three-second silent video, and the first annotated copy containing `Audit`. The later analysis copy and two additional short clips were removed through the app's gallery. The audio test clip remains only in the local evidence directory, together with the original three artifacts; it is not part of the screenshot review bundle.

Final screenshots 148–152 confirm the restored configuration: English, °C, TisoView On, all three tracking markers On, automatic colour scaling with scale lock off, automatic temperature-range switching with Low selected, recording audio Off, alarm Off, emissivity 1.00, adjustment 0.0, reflected and ambient temperatures 27 °C. Measurement objects were cleared; both mirrors and orientation lock were returned to their prior state. The microphone permission granted with `Only this time` was explicitly revoked after the recording test (`granted=false`). After relaunch, the app resumed the camera stream and retained the settings; it was left on the live view with the alarm off. Orientation request remained 6 (unlocked).

## See also

- [Roadmap](../roadmap.md)
- [M2 USB findings](m2.md)

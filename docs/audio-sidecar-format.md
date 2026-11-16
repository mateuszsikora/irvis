# Audio sidecar version 2

Optional microphone audio lives in `<recording-stem>.audio-v2.pcm`. The existing JSON header view state contains `audio: { version: 2, file: "<filename>", clock: "performance" }`. This adds no binary record types to the frozen `.irvis` v1 format. Keep both files for a raw backup; MP4 combines them. Export also accepts the initial version 1 WebM/Opus sidecars, whose timing cannot be reconstructed retroactively.

All multibyte numbers are little-endian. The 12-byte header contains eight ASCII bytes `IRVAUD02` followed by a uint32 sample rate (8000–192000 Hz). Audio is mono, with normalized IEEE-754 float32 samples at the AudioContext's native rate.

Each packet contains:

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 8 | float64 timestamp of the first sample, milliseconds on the renderer's `performance.now()` timeline |
| 8 | 4 | uint32 sample count, 1–4096 |
| 12 | count × 4 | float32 samples |
| 12 + count × 4 | 4 | CRC-32/ISO-HDLC of the preceding packet bytes (polynomial 0xedb88320, initial/final xor 0xffffffff) |

There is no final index. The reader validates each packet and stops at the first incomplete, corrupt, invalid or backwards-timestamp packet. Thus a torn final write does not invalidate earlier audio. Nonfinite sample values are rendered as silence.

## Clock and synchronization

The viewer timestamps each incoming camera frame with `performance.now()` at the subscription boundary, before rendering. That receipt timestamp becomes the recorded frame timestamp; redraws retain it. This puts browser, desktop and Demo frames on the same host clock as audio regardless of camera timestamp origins. Recording ignores frames received before the recording request. Source camera timestamps are not used for audio alignment.

An AudioWorklet groups 2048 mono samples and sends their `currentFrame` sample position. On delivery, the recorder maps that position through `AudioContext.currentTime` to `performance.now()`. Subtracting the elapsed sample time accounts for queued message delivery, rather than mistaking that delay for capture time. The mapping is refreshed for each packet so independent device-clock drift does not accumulate. Precision is limited by the audio render quantum and browser clock resolution; physical camera and microphone acquisition latency is not calibrated. Interrupted audio clocks stop recording with an error.

Export uses the first retained thermal frame as time zero. It crops microphone pre-roll, places each packet at its timestamp, fills gaps or a late start with silence, and trims/pads to the last video frame plus one nominal frame interval. An OfflineAudioContext resamples to mono 44.1 kHz; Mediabunny encodes AAC at 128 kbps. Missing thermal frames retain their timestamps, so they do not shift later audio. AAC decoding may expose up to two codec frames of priming/padding; the browser test checks the position of an audible pulse against an actual decoded video flash, not just track presence.

## Durability and backpressure

The header and each packet are flushed before acknowledgment. The worklet permits at most two unacknowledged packets (4096 samples, about 85 ms at 48 kHz), including any final partial packet. A full queue stops capture and reports `Audio storage is too slow; recording stopped.` There is no unbounded MessagePort or disk queue. Stop immediately releases microphone tracks, requests the partial packet, drains writes and closes storage. A stop acknowledgment missing for one second reports an error and closes the audio context.

`packages/media/test/audio-sidecar.test.ts` checks alignment, pre-roll, gaps, tail padding, CRC failures and every partial-write boundary. `packages/media/test/browser.mjs` validates the decoded AAC pulse/H.264 flash alignment after an early microphone start and a missing thermal frame, a scheduled live oscillator pulse through the actual worklet clock mapping, mono 44.1 kHz export, track release, permission denial and capture shutdown on blocked audio storage.

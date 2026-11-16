# Real-frame codec findings

Measured on 2026-11-16 for #16. This report describes one stationary TOOLTOP T7
capture, not a calibrated sensor specification or a moving-camera benchmark.
The original #6 captures disappeared with their workspace; this is a new
capture, not a reconstruction of those files.

## Evidence and reproduction

The owner placed the camera on a table facing a wall. The preview includes
spatial structure and a foreground region; this is not a uniform laboratory
target. Capture ran through macOS Terminal with camera permission, ffmpeg
9.0.2, 256×384 `yuyv422` at nominal 25 fps, without sending USB commands.
Conversion uses the reported high-gain 1/64 K scale; reference accuracy and
actual camera calibration were not independently checked.

The full 90 s capture is retained on the owner's Mac outside workspace
cleanup, at `/Users/mateuszsikora/irvis-captures/m1-scenes-1794808411555/`:

- `static-wall-full/`: 2250 packed frames, each 196608 B, zero trailing bytes.
- `static-wall-after-6s/`: original frames 150 onward, 2100 frames, copied
  without changing bytes or arrival timestamps. The name describes removing
  150 nominal frames, not a claim that all thermal settling ends after 6 s.
- Original AVFoundation packet sizes are 197120 B. The capture CLI packs
  pixels without automatic conversion; the 512 allocation bytes are not image
  data. This repeat did not independently re-run the byte-preservation test
  from #6.

Reproduce under Node 26 after `npm ci` (the long series is local, not in Git):

```sh
capture_root=/Users/mateuszsikora/irvis-captures/m1-scenes-1794808411555
npm run capture -- report "$capture_root/static-wall-after-6s"
npm run bench:irvis -- --capture "$capture_root/static-wall-full" --start 150
npm run bench:irvis -- --capture "$capture_root/static-wall-full" --start 150 --threshold 10
```

The committed [fixtures](../../fixtures/infiray-p2pro/static-wall/README.md)
are original frames 1875–1884, ten consecutive gzip files with a provenance
manifest and uncompressed SHA-256 hashes. A fixed lossless `.irvis` recording
makes future readers prove v1 compatibility without asking a current writer
to recreate its own input. These ten frames are sufficient for regression,
not for reproducing the long-series noise measurement.

## Noise and events

After excluding the first 150 frames, the report finds 16 event candidates,
including frozen sequences and large early steps. They are not confirmed
shutter events. Arrival rate is 25.10 fps, PTS rate 24.99 fps with one inferred
missing frame; arrival interval p99 is 50.6 ms and maximum 81.4 ms.
The middle preview has min 19.5 °C, max 24.7 °C and centre 20.0 °C.
Whole-series centre SD is 1.484 K: using the entire series as NETD would mix
settling, steps and frozen intervals into the estimate.

The capture report selects the longest event-free interval: excerpt frames
1725–1980, original frames 1875–2130, 256 frames (about 10.2 s). For each pixel
it computes population SD over time, then takes the median across pixels:

| Statistic | Result |
| --- | --- |
| Median temporal SD | 75.45446351476191 mK |
| Mean temporal SD | 76.08756640857847 mK |
| Median after subtracting each frame's mean shift | 46.52281811928624 mK |

The profile stores the unadjusted median as a scene-based NETD estimate.
The smaller adjusted figure removes common-mode variation as well as random
noise. The [k = 2 decision](../decisions/architecture.md#recording-defaults-use-twice-the-static-scene-noise)
gives `ceil(2 × 0.07545446351476191 × 64) = 10` raw units, or 0.15625 K.
The earlier #6 estimate was 99.48 mK on a different session; the variation is
another reason not to present either value as a calibrated NETD specification.

## Codec benchmark

Node 26.13.0 on Apple M2 Pro; deflate level 6, default encoder tuning and NUC
heuristics, 10 s keyframe interval. No motion compensation. Every decoded
pixel of all 2100 post-startup frames was compared to its source at every
threshold. Sizes include the complete header, chunks, frames, index and
trailer. MB is decimal; MB/min uses the arrival-time span plus 40 ms, not a
separate minute-long file. Timing is observational and not a CI limit.

| T (raw) | Bound (K) | File bytes | MB/min | Skip | Dense | Sparse | Encode ms/frame | Decode ms/frame | Max error (raw) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 9539915 | 6.84 | 16.0% | 84.0% | 0.0% | 3.30 | 0.60 | 0 |
| 8 | 0.125 | 4575469 | 3.28 | 57.4% | 3.4% | 39.2% | 1.50 | 0.43 | 8 |
| 10 | 0.15625 | 3738178 | 2.68 | 66.9% | 1.2% | 31.9% | 1.59 | 0.44 | 10 |
| 16 | 0.25 | 2516953 | 1.80 | 77.6% | 1.0% | 21.4% | 1.23 | 0.38 | 16 |

Block percentages exclude keyframes, which have no block-mode counters.
The uncompressed thermal planes total 206438400 B; packed YUYV also contains
the image half and is twice that size. Periodic identical frames help skip
rates; these sizes should not be extrapolated to arbitrary moving scenes.
At the proposed default, skip and sparse dominate but dense is still used.
There is no measured reason here to remove any of the three modes or retune
the existing precision/weight/dense-bias defaults.

## Version 1 verdict and limits

Freeze the existing layout with no motion vectors. This stationary series
validates real-frame round trips and measures the existing block modes; it
cannot quantify a motion-compensation gain. No motion-search implementation
was benchmarked. Adding motion syntax without moving-camera evidence is
unjustified, so it remains future-version work
([decision](../decisions/architecture.md#version-1-freezes-without-motion-vectors)).

The format freeze does not certify absolute temperatures, low gain, moving
objects, every camera unit, or a browser's reconstruction path. The existing
synthetic tests retain coverage of movement, hot tips, dead pixels and NUC
transitions. View-state remains extensible JSON; the binary framing and
currently defined record/field syntax are frozen in [the specification](../irvis-format.md).

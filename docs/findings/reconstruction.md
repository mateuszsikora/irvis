# Synthetic planar reconstruction results (#8)

Measured 15 November 2026 on Apple M2 Pro, Node v26.11.1. This is a synthetic algorithm experiment, not the M3 browser spike: no hardware capture, browser conversion or temperature calibration was tested.

Command: `node packages/core/test/benchmark/reconstruction.ts`. Thermal size 256×192, three warmups, median of three timed reconstructions per case (allocation and hint fitting included; simulation and comparison excluded). The 96 cases comprise background, hand, 320 °C tip, checkerboard and twenty seeded random scenes, each with and without blur and with monotonic or garbage upper halves. Blur uses three 3×3 box passes. See [metric definitions and scene construction](../features/core-technical.md#planar-reconstruction).

## Results

Every case had 100% Y match and 100% chroma-model match against the simulation. All 96 cases passed the 99.9% flat-region target. No case passed all targets because all exceeded 30 ms; timings ranged from 40.45 to 137.52 ms. The implementation therefore works partly on these synthetic data and does not meet the performance target.

The following rows aggregate 24 cases each. Percentages are bit-exact raw values; error columns are kelvins. The p99 column is the largest per-scene p99, not a pooled percentile.

| Blur | Upper image | Mean exact % | Minimum exact % | Minimum flat exact % | Maximum mean error K | Maximum p99 K | Maximum error K | Maximum byte jumps per scene |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no | monotonic | 100.0000 | 100.0000 | 100.0000 | 0.0000 | 0 | 0 | 0 |
| no | garbage | 99.8764 | 99.4670 | 100.0000 | 0.6548 | 0 | 132 | 262 |
| yes | monotonic | 99.5289 | 97.0988 | 100.0000 | 0.1160 | 4 | 4 | 1426 |
| yes | garbage | 87.5889 | 57.6538 | 99.9860 | 3.0132 | 64 | 84 | 20814 |

## Limits and follow-up

Unblurred scenes with monotonic hints were exact. Blur with an uninformative image is the weakest case: averaged chroma loses the edge position, the hint is disabled, and the bounded candidate set and spatial cost cannot always resolve it. The confidence mask uses a local cost margin and can still mark a wrong value confident. It must not be interpreted as calibrated accuracy.

The benchmark prints every byte-jump location and the per-case hint R² in JSON lines, and reports target failures without failing its process. The small 64×48 regression suite uses twenty seeds and tighter relative geometry than this full-size benchmark; its floors are separately measured, not borrowed from these numbers.

Next experiments should profile candidate construction and dynamic programming, calibrate uncertainty against real dumps, and check the browser chroma model before using readings for measurement. A WASM implementation remains a separate-package option. Browser uncertainty presentation and image-only fallback belong to the browser integration work; neither is implemented by this core change.

# Electron comparison backend

## Data flow

`packages/backend-electron/src/index.ts` reads the optional preload bridge from `window.irvisDesktop`; it imports no Electron or Node module. ESLint forbids these imports and dynamic imports. It is bundled into the same web build served by Netlify.

`compare(reference, mode, kelvinsPerRaw, live?)` validates packed reference dimensions, extracts little-endian thermal values using the mode's thermal rows, and calls core's `simulateYUYVtoI420` when no live frame is supplied. It reconstructs the planar frame without brightness hints and uses `compareFrames` for error metrics.

## Schema

The result contains `variant`, `metrics`, exact `reference` raw values, `reconstructed` raw values and the `planar` frame. Metrics include low-byte match, chroma-model match, mean/p99/max absolute errors in kelvins, indices of errors at least 3 K, and reconstruction duration. Bit-exact and flat-region matches are emitted only for simulation.

The web panel stores the first 100 measurement records per start, then stops appending to the report while continuing to update the latest comparison. Frame-pair export saves that latest comparison, so its frame may be newer than the last sample in the bounded report. Live pairing chooses the latest browser result with an arrival gap no greater than 500 ms. Reports record both source timestamps and receipt times, browser statistics, profile/mode, user agent, user-confirmed scale and a pending hardware verdict. Frame dumps serialize typed arrays as numeric arrays and preserve planar layout/strides. Live differences include unsynchronized exposure and sensor noise, not only conversion error.

## Interfaces

`desktopBridge()` returns the optional narrow preload API. Its `subscribe(frame, error)` returns an unsubscribe function. Start and stop return promises. No hardware backend is instantiated in an ordinary browser.

## Failure modes

`Reference does not match the profile mode.` rejects truncated or incorrectly sized references and modes without thermal rows. `Planar dimensions differ.` rejects a mismatched browser stream. Core validates planar bounds and positive finite comparison scale.

## Tests

`apps/web/src/Comparison.test.tsx` checks extraction of thermal rows, simulation metrics, omission of bit-exact claims for live pairs, and malformed frames. The desktop smoke test checks the bridge in the actual sandbox. Camera accuracy is not inferred from synthetic tests.

## See also

[Desktop technical details](desktop-technical.md), [M3 findings](../findings/m3.md).

# Static-wall capture

Ten consecutive packed frames from the owner's TOOLTOP T7, stationary on a
table facing a wall, recorded on 2026-11-16. These are real camera bytes, not
synthetic scenes. No LFS is used.

`manifest.json` identifies the source session, zero-based original frame
indices (1875–1884), original arrival timestamps in milliseconds, SHA-256 of
each **uncompressed** 196608-byte YUYV frame, and raw thermal extrema/centre.
The noise block describes the longer 256-frame interval, not these ten frames;
its `firstFrame` is relative to the excerpt that omits original frames 0–149.
Each gzip was copied unchanged from the capture. The lower 192 rows contain
little-endian u16 values; conversion is assumed high gain, raw/64 − 273.15 °C.

`lossless-v1.irvis` is a fixed compatibility artifact, encoded once from these
ten frames with T=0 and profile version 2. Do not regenerate it when changing
the writer: the regression test must keep reading this existing file exactly.
Its binary format version is 1. Encoder byte-for-byte output is not frozen.

The complete series is retained outside Conductor workspaces at
`/Users/mateuszsikora/irvis-captures/m1-scenes-1794808411555/` on the owner's
Mac. It is not required to run the regression tests. Reproduction commands,
noise method and limitations: [codec findings](../../../docs/findings/irvis-codec.md).

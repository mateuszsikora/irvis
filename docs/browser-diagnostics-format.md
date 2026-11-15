# Browser diagnostics export format

Version: 1

`m3-report.json` is UTF-8 JSON. Fields are `version` (1), `userAgent`, `startedAt` (UTC ISO string), `profileId`, `modeId`, `frames` (processed count), `first` and `last` (source timestamps in milliseconds), `processedFps`, `metadata`, `status`, `statistics`, `reconstructionMs` (latest frame only), and `reference` (text stating there is no exact reference). Fields without a result may be absent; zero frames means timing is not yet measured.

`metadata` contains `format`, `codedWidth`, `codedHeight`, `visibleRect` (null or x/y/width/height), `colorSpace` (WebCodecs primaries, transfer, matrix and fullRange, possibly unknown), and `timestampUs` (source microseconds). Colour-space metadata describes the browser's declaration; it does not prove sample preservation.

`statistics` describes the latest reconstructed thermal frame: `minRaw`, `maxRaw`, `meanRaw`, `centerRaw` (pixel at floor(width/2), floor(height/2)), `uncertainFraction`, and `highByteHistogram` (256 counts indexed by reconstructed high byte). It includes uncertain pixels and applies no temperature conversion.

`m3-planar.json` uses compact JSON without indentation (the schema is unchanged) and adds `frame` to the report. `frame` contains `kind: "yuv420"`, `layout: "i420" | "nv12"`, `width`, `height`, `timestamp` in milliseconds, `planes` (offset and stride in bytes), and `data` (JSON array of byte values, including any padding from copyTo). Its metadata describes that copied frame. To analyse offline, parse JSON and convert `frame.data` to `Uint8Array`; pass that frame and the chosen profile's thermal rows to core's `reconstructPlanar`. The format deliberately retains the original planar samples rather than reconstructed values.

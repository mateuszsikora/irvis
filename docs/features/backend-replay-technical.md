# Replay backend

## Data flow

`packages/backend-replay/src/index.ts` exports `createReplayBackend(fixtures?)`, implementing `CameraBackend` with id `replay`. `listDevices` returns `demo`, labelled Synthetic camera. Each open has its own timer and listeners. It emits thermal frames at the selected profile mode's fps, looping supplied in-memory fixtures or generating a moving warm spot. Synthetic raw values are 18500–19400 with the profile's first conversion; these are illustrative values, not simulated calibrated physics. Fixtures retain their conversion, state, dimensions, uncertainty and timestamp.

## Interfaces

Capabilities: `exactRaw: true`, `deviceControl: false`, `concurrentWith: []`. Open requires device `demo` and a profile video mode with thermal rows. Synthetic dimensions come from `profile.sensor`; camera state uses profile defaults with origin `assumed`. Frames arrive through subscriptions without a queue. `close` is idempotent, clears the timer and listeners, and prevents new subscriptions. Fixtures are borrowed read-only; callers must not mutate them during playback.

## Failure modes

An empty fixture list throws `Replay needs at least one frame.` Invalid device or nonthermal mode throws `Invalid replay device or mode.` A missing profile conversion throws `Replay needs a conversion.`

## Tests

`test/replay.test.ts` covers synthetic delivery, fixture looping, unsubscribe and idempotent close with fake timers.

## See also

- [User guide](backend-replay-user.md)

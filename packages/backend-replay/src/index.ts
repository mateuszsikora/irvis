import type { CameraBackend, CameraSession, RawFrame, ThermalFrame } from '@irvis/core';

/** Loops in-memory fixtures, or generates a moving synthetic thermal scene. */
export function createReplayBackend(fixtures?: readonly ThermalFrame[]): CameraBackend {
  if (fixtures?.length === 0) throw new Error('Replay needs at least one frame.');
  return {
    id: 'replay',
    capabilities: { exactRaw: true, deviceControl: false, concurrentWith: [] },
    listDevices() {
      return Promise.resolve([{ id: 'demo', label: 'Synthetic camera' }]);
    },
    open({ deviceId, profile, modeId }) {
      const mode = profile.videoModes.find((m) => m.id === modeId);
      if (deviceId !== 'demo' || !mode?.layout)
        return Promise.reject(new Error('Invalid replay device or mode.'));
      const conversion = profile.conversions[0]?.conversion;
      if (!conversion) return Promise.reject(new Error('Replay needs a conversion.'));
      const listeners = new Set<(frame: RawFrame) => void>();
      let tick = 0,
        closed = false;
      const timer = setInterval(() => {
        const fixture = fixtures?.[tick % fixtures.length];
        const { width, height } = profile.sensor;
        const raw =
          fixture?.raw ??
          Uint16Array.from(
            { length: width * height },
            (_, i) =>
              18500 +
              Math.round(
                900 *
                  Math.max(
                    0,
                    1 -
                      Math.hypot(
                        (i % width) - ((tick * 2) % width),
                        Math.floor(i / width) - height / 2,
                      ) /
                        50,
                  ),
              ),
          );
        const frame: ThermalFrame = fixture ?? {
          width,
          height,
          raw,
          conversion,
          timestamp: (tick * 1000) / mode.fps,
          uncertain: null,
          cameraState: {
            origin: 'assumed',
            values: Object.fromEntries(profile.state.map((f) => [f.id, f.default])),
          },
        };
        tick++;
        for (const listener of listeners) listener({ kind: 'thermal', frame });
      }, 1000 / mode.fps);
      return Promise.resolve<CameraSession>({
        device: { id: 'demo', label: 'Synthetic camera' },
        profile,
        mode,
        frames: {
          subscribe: (listener) => {
            if (!closed) listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
        },
        close() {
          closed = true;
          clearInterval(timer);
          listeners.clear();
          return Promise.resolve();
        },
      });
    },
  };
}

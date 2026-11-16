import type { CameraBackend, RawFrame } from '@irvis/core';
import { startDiagnostics } from '@irvis/backend-browser';
import { type DesktopBridge, desktopBridge } from '@irvis/backend-electron';

const owners = new WeakMap<DesktopBridge, symbol>();

/** Adapt the existing capture paths without adding privileged APIs to the UI. */
export function liveBackend(onError: (message: string) => void): CameraBackend {
  const bridge = desktopBridge();
  return {
    id: bridge ? 'electron' : 'browser',
    capabilities: {
      exactRaw: !!bridge,
      deviceControl: !!bridge?.command,
      concurrentWith: bridge?.concurrentWith ?? [],
    },
    async listDevices() {
      if (bridge)
        return bridge.listDevices ? bridge.listDevices() : [{ id: '0', label: 'Camera 0' }];
      if (!navigator.mediaDevices) throw new Error('Camera access requires HTTPS or localhost.');
      const devices = await navigator.mediaDevices.enumerateDevices();
      return [
        { id: 'default', label: 'Default camera' },
        ...devices
          .filter((d) => d.kind === 'videoinput' && d.deviceId)
          .map((d) => ({ id: d.deviceId, label: d.label })),
      ];
    },
    async open({ deviceId, profile, modeId }) {
      const mode = profile.videoModes.find((m) => m.id === modeId);
      if (!mode?.layout) throw new Error('This mode has no thermal data.');
      onError('');
      const owner = Symbol('capture');
      let closed = false;
      if (bridge) owners.set(bridge, owner);
      const isCurrent = () => !closed && (!bridge || owners.get(bridge) === owner);
      const reportError = (message: string) => {
        if (isCurrent()) onError(message);
      };
      const listeners = new Set<(frame: RawFrame) => void>();
      const emit = (frame: RawFrame) => {
        if (!isCurrent()) return;
        for (const listener of listeners) listener(frame);
      };
      let stop: () => void;
      if (bridge) {
        const unsubscribe = bridge.subscribe(emit, reportError);
        try {
          await bridge.start({ profileId: profile.id, modeId, device: deviceId });
        } catch (error) {
          unsubscribe();
          if (owners.get(bridge) === owner) owners.delete(bridge);
          throw error;
        }
        stop = unsubscribe;
      } else
        stop = startDiagnostics(mode, deviceId === 'default' ? '' : deviceId, {
          metadata: () => {},
          result: (result) => emit(result.frame),
          error: reportError,
        });
      return {
        device: { id: deviceId, label: deviceId },
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
        ...(bridge?.command
          ? {
              command: async (id: string) => {
                if (!isCurrent()) throw new Error('Camera session is closed');
                await bridge.command!(id);
              },
            }
          : {}),
        async close() {
          if (closed) return;
          closed = true;
          stop();
          listeners.clear();
          if (bridge && owners.get(bridge) === owner) {
            owners.delete(bridge);
            await bridge.stop();
          }
        },
      };
    },
  };
}

import {
  findVideoMode,
  type CameraBackend,
  type CameraDevice,
  type DeviceVideoMode,
  type RawFrame,
} from '@irvis/core';
import { startDiagnostics } from '@irvis/backend-browser';
import { type DesktopBridge, desktopBridge } from '@irvis/backend-electron';

const owners = new WeakMap<DesktopBridge, symbol>();

/** Chrome ends the label of a USB camera with its IDs, for example `USB Camera (0bda:5830)`. */
function labelUsbIds(label: string) {
  const m = /\(([0-9a-f]{4}):([0-9a-f]{4})\)$/i.exec(label);
  return m ? { vendorId: parseInt(m[1]!, 16), productId: parseInt(m[2]!, 16) } : {};
}

/** The cameras that a live backend can open: ffmpeg's list in the desktop app, the browser's otherwise. */
export async function listLiveCameras(): Promise<readonly CameraDevice[]> {
  const bridge = desktopBridge();
  if (bridge) return bridge.listDevices ? bridge.listDevices() : [{ id: '0', label: 'Camera 0' }];
  if (!navigator.mediaDevices) throw new Error('Camera access requires HTTPS or localhost.');
  const devices = await navigator.mediaDevices.enumerateDevices();
  return [
    { id: 'default', label: 'Default camera' },
    ...devices
      .filter((d) => d.kind === 'videoinput' && d.deviceId)
      .map((d) => ({ id: d.deviceId, label: d.label, ...labelUsbIds(d.label) })),
  ];
}

/**
 * The video modes a camera reports, or null when they are unknown: in the
 * browser, which offers no way to read them without opening the camera, with
 * a bridge without `listModes`, when the desktop app read none, or when it failed.
 */
export async function listCameraModes(
  deviceId: string,
): Promise<readonly DeviceVideoMode[] | null> {
  try {
    const modes = await desktopBridge()?.listModes?.(deviceId);
    return modes?.length ? modes : null;
  } catch {
    return null;
  }
}

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
    listDevices: listLiveCameras,
    async open({ deviceId, profile, modeId }) {
      const mode = findVideoMode(profile, modeId);
      if (!mode) throw new Error(`Unknown video mode: ${modeId}`);
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
              command: async (id: string, value?: number) => {
                if (!isCurrent()) throw new Error('Camera session is closed');
                await bridge.command!(id, value);
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

import {
  compareFrames,
  type CameraDevice,
  type DeviceVideoMode,
  type BackendId,
  reconstructPlanar,
  simulateYUYVtoI420,
  type VideoMode,
  type YuyvFrame,
  type Yuv420Frame,
} from '@irvis/core';
export interface ReferenceFrame extends YuyvFrame {
  receivedAt: number;
}
export interface DesktopBridge {
  readonly concurrentWith?: readonly BackendId[];
  listDevices?: () => Promise<readonly CameraDevice[]>;
  /** The video modes a device reports, by CameraDevice.id. */
  listModes?: (device: string) => Promise<readonly DeviceVideoMode[]>;
  command?: (id: string, value?: number) => Promise<void>;
  recordingStorage?: (
    op: string,
    name?: string,
    bytes?: Uint8Array,
    offset?: number,
    length?: number,
  ) => Promise<unknown>;
  /** Photos in the app's directory: `list`, `save` (with the photo's time) and `remove`. */
  photoStorage?: (
    op: string,
    name?: string,
    bytes?: Uint8Array,
    createdAt?: number,
  ) => Promise<unknown>;
  /**
   * Shows the system's save dialog for `name` and writes there a file of the
   * library or the bytes given; true once written, false when cancelled.
   */
  saveAs?: (
    name: string,
    what: { kind: 'recordings' | 'photos'; name: string } | Uint8Array,
  ) => Promise<boolean>;
  start(options: { profileId: string; modeId: string; device: number | string }): Promise<void>;
  stop(): Promise<void>;
  subscribe(frame: (value: ReferenceFrame) => void, error: (message: string) => void): () => void;
}
declare global {
  interface Window {
    irvisDesktop?: DesktopBridge;
  }
}
export function desktopBridge(): DesktopBridge | undefined {
  return window.irvisDesktop;
}

/** Live pairs are only arrival-time neighbours, never synchronized sensor exposures. */
export function compare(
  reference: YuyvFrame,
  mode: VideoMode,
  kelvinsPerRaw: number,
  live?: Yuv420Frame,
) {
  if (
    !mode.layout ||
    reference.width !== mode.width ||
    reference.height !== mode.height ||
    reference.data.length !== mode.width * mode.height * 2
  )
    throw new Error('Reference does not match the profile mode.');
  const planar = live ?? simulateYUYVtoI420(reference);
  if (planar.width !== mode.width || planar.height !== mode.height)
    throw new Error('Planar dimensions differ.');
  const thermal = mode.layout.thermal;
  const raw = new Uint16Array(mode.width * thermal.rows);
  const offset = thermal.firstRow * mode.width * 2;
  for (let i = 0; i < raw.length; i++)
    raw[i] = reference.data[offset + i * 2]! | (reference.data[offset + i * 2 + 1]! << 8);
  let minRaw = Infinity,
    maxRaw = -Infinity,
    sumRaw = 0;
  for (const value of raw) {
    minRaw = Math.min(minRaw, value);
    maxRaw = Math.max(maxRaw, value);
    sumRaw += value;
  }
  const referenceStatistics = {
    minRaw,
    maxRaw,
    meanRaw: sumRaw / raw.length,
    centerRaw: raw[Math.floor(thermal.rows / 2) * mode.width + Math.floor(mode.width / 2)],
  };
  const start = performance.now();
  const result = reconstructPlanar(planar, { thermal });
  const metrics = compareFrames(
    raw,
    result.raw,
    planar,
    thermal,
    kelvinsPerRaw,
    performance.now() - start,
  );
  const { exactMatch, flatRegionMatch, ...liveMetrics } = metrics;
  return {
    variant: live ? 'live' : 'simulation',
    metrics: live ? liveMetrics : { ...liveMetrics, exactMatch, flatRegionMatch },
    reference: raw,
    referenceStatistics,
    reconstructed: result.raw,
    planar,
  };
}

export { createDesktopRecordingStorage } from './recordings.ts';
export { createDesktopPhotoLibrary, type DesktopPhoto } from './photos.ts';
export { desktopSaveAs } from './save.ts';

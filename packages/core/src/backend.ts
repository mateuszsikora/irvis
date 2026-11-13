import type { CameraProfile, VideoMode } from './cameras/profile.ts';
import type { RawFrame } from './frames.ts';
import type { Subscribable } from './store.ts';

/** Which implementation a backend is. */
export type BackendId = 'browser' | 'electron' | 'replay';

/** What a backend can do; the UI offers only what these allow. */
export interface BackendCapabilities {
  /** Frames carry the camera's bytes unchanged (YuyvFrame), not a lossy 4:2:0 copy. */
  readonly exactRaw: boolean;
  /** The backend can send commands from the profile to the camera. */
  readonly deviceControl: boolean;
  /** Backends that can use the same camera at the same time as this one. */
  readonly concurrentWith: readonly BackendId[];
}

/** A camera the operating system reports. */
export interface CameraDevice {
  /** Stable for as long as the device stays connected; backend-specific. */
  readonly id: string;
  /** The name the operating system shows. */
  readonly label: string;
  /** USB IDs, when the backend can see them. The browser usually cannot. */
  readonly vendorId?: number;
  readonly productId?: number;
}

/** What to open: a device, the profile chosen for it, and one of its video modes. */
export interface OpenRequest {
  readonly deviceId: string;
  readonly profile: CameraProfile;
  /** VideoMode.id from the profile. */
  readonly modeId: string;
}

/** An open camera. */
export interface CameraSession {
  readonly device: CameraDevice;
  readonly profile: CameraProfile;
  readonly mode: VideoMode;
  /** Frames in the order they arrive. A slow listener makes the backend drop frames, not queue them. */
  readonly frames: Subscribable<RawFrame>;
  /** Stops the stream and releases the device. */
  close(): Promise<void>;
}

/** A source of camera frames: the browser, the Electron main process, or a replay. */
export interface CameraBackend {
  readonly id: BackendId;
  readonly capabilities: BackendCapabilities;
  listDevices(): Promise<readonly CameraDevice[]>;
  open(request: OpenRequest): Promise<CameraSession>;
}

import type { CameraStateSnapshot, Conversion } from './cameras/profile.ts';

/**
 * Packed YUYV (4:2:2) bytes exactly as the camera sent them, for example
 * read from ffmpeg in Electron. The exact path: no byte was changed.
 */
export interface YuyvFrame {
  readonly kind: 'yuyv';
  /** Pixels per row. */
  readonly width: number;
  /** Rows. */
  readonly height: number;
  /** width × height × 2 bytes, row-major, `[Y0 U Y1 V]` per pair of pixels. */
  readonly data: Uint8Array;
  /** Milliseconds on the source's monotonic clock. */
  readonly timestamp: number;
}

/** Where one plane of a planar frame lies in its buffer, as WebCodecs PlaneLayout. */
export interface PlaneLayout {
  readonly offset: number;
  /** Bytes from the start of one row to the start of the next. */
  readonly stride: number;
}

/**
 * A 4:2:0 frame as the browser delivers it (VideoFrame.copyTo). Lossy: the
 * raw values have to be reconstructed from it.
 */
export interface Yuv420Frame {
  readonly kind: 'yuv420';
  /** `i420`: planes Y, U, V. `nv12`: planes Y and interleaved UV. */
  readonly layout: 'i420' | 'nv12';
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly planes: readonly PlaneLayout[];
  readonly timestamp: number;
}

/** A frame whose temperature data are already decoded, for example from a recording. */
export interface ThermalRawFrame {
  readonly kind: 'thermal';
  readonly frame: ThermalFrame;
}

/** What a CameraBackend delivers, before decoding. */
export type RawFrame = YuyvFrame | Yuv420Frame | ThermalRawFrame;

/** Temperature data of one frame, independent of where it came from. */
export interface ThermalFrame {
  /** Thermal pixels per row. */
  readonly width: number;
  /** Thermal rows. */
  readonly height: number;
  /** Milliseconds on the source's monotonic clock. */
  readonly timestamp: number;
  /** Raw sensor values, row-major, width × height. */
  readonly raw: Uint16Array;
  /** How `raw` converts to degrees Celsius in this frame. */
  readonly conversion: Conversion;
  /** The camera state the frame was taken in, and whether it is known. */
  readonly cameraState: CameraStateSnapshot;
  /**
   * 1 where the value is uncertain (the reconstruction could not recover it
   * exactly), 0 elsewhere; width × height. Null when every value is exact.
   */
  readonly uncertain: Uint8Array | null;
}

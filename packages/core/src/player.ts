import type { IrvisReader } from './irvis/reader.ts';
import type { Subscribable } from './store.ts';
import type { ThermalFrame } from './frames.ts';
import type { ViewStateValues } from './irvis/format.ts';
import type { Store } from './store.ts';

/** Where playback is and how it runs. */
export interface PlayerViewState {
  /** Milliseconds from the start of the recording. */
  readonly position: number;
  /** Length of the recording in milliseconds. */
  readonly duration: number;
  readonly paused: boolean;
  /** Playback speed; 1 is real time. */
  readonly rate: number;
}

/** Playback controls of a recording, next to the CameraBackend that delivers its frames. */
export interface Player {
  play(): void;
  pause(): void;
  /** Moves to the frame at or before `position` (milliseconds), clamped to the recording. */
  seek(position: number): void;
  /** Sets the speed; `rate` is greater than 0. */
  setRate(rate: number): void;
  readonly viewState: Store<PlayerViewState>;
}

/** A file player owns no camera or storage handle; the host owns its ByteSource. */
export interface RecordingPlayer extends Player {
  readonly reader: IrvisReader;
  readonly frames: Subscribable<ThermalFrame>;
  readonly recordedViewState: Subscribable<ViewStateValues>;
  readonly errors: Subscribable<unknown>;
  close(): void;
}

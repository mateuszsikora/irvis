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

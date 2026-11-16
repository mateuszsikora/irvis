import {
  IrvisReader,
  type ByteSource,
  type PlayerViewState,
  type RecordingPlayer,
  type ThermalFrame,
  type ViewStateValues,
} from '@irvis/core';

/** Decode at most one frame at a time; obsolete seeks never deliver a frame. */
export async function openRecording(source: ByteSource): Promise<RecordingPlayer> {
  const reader = await IrvisReader.open(source);
  if (!reader.frames.length) throw new Error('Recording contains no complete frames.');
  const first = reader.frames[0]!.timestamp;
  let state: PlayerViewState = { position: 0, duration: reader.duration, paused: true, rate: 1 };
  const states = new Set<(s: PlayerViewState) => void>();
  const frames = new Set<(f: ThermalFrame) => void>();
  const views = new Set<(v: ViewStateValues) => void>();
  const errors = new Set<(e: unknown) => void>();
  let closed = false;
  let version = 0;
  let decoding = false;
  let pending = false;
  let lastIndex = -1;
  let anchor = performance.now();
  let anchorPosition = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const subscribe =
    <T>(set: Set<(value: T) => void>) =>
    (listener: (value: T) => void) => {
      if (!closed) set.add(listener);
      return () => {
        set.delete(listener);
      };
    };
  function publish(patch: Partial<PlayerViewState>) {
    state = { ...state, ...patch };
    for (const listener of states) listener(state);
  }
  function position() {
    return state.paused
      ? state.position
      : Math.min(state.duration, anchorPosition + (performance.now() - anchor) * state.rate);
  }
  async function deliver() {
    pending = true;
    if (decoding || closed) return;
    decoding = true;
    try {
      while (pending && !closed) {
        pending = false;
        const token = version;
        const timestamp = first + state.position;
        const index = reader.frameAt(timestamp);
        if (index === lastIndex) continue;
        const decoded = await reader.readFrame(index);
        if (closed || token !== version) continue;
        lastIndex = index;
        let values = reader.header.viewState;
        for (const change of reader.viewStates) {
          if (change.timestamp > timestamp) break;
          values = { ...values, ...change.values };
        }
        for (const listener of views) listener(values);
        for (const listener of frames) listener(decoded.frame);
      }
    } catch (error) {
      clearTimeout(timer);
      publish({ paused: true });
      for (const listener of errors) listener(error);
    } finally {
      decoding = false;
    }
  }
  function tick() {
    if (closed || state.paused) return;
    const next = position();
    publish({ position: next, paused: next >= state.duration });
    void deliver();
    if (!state.paused) timer = setTimeout(tick, 16);
  }
  return {
    reader,
    frames: { subscribe: subscribe(frames) },
    recordedViewState: { subscribe: subscribe(views) },
    errors: { subscribe: subscribe(errors) },
    viewState: { getSnapshot: () => state, subscribe: subscribe(states) },
    play() {
      if (closed || !state.paused) return;
      if (state.position >= state.duration) {
        version++;
        lastIndex = -1;
        publish({ position: 0 });
      }
      anchorPosition = state.position;
      anchor = performance.now();
      publish({ paused: false });
      tick();
    },
    pause() {
      if (closed) return;
      clearTimeout(timer);
      publish({ position: position(), paused: true });
    },
    seek(value) {
      if (!Number.isFinite(value)) throw new Error('Playback position must be finite.');
      if (closed) return;
      version++;
      lastIndex = -1;
      anchorPosition = Math.max(0, Math.min(state.duration, value));
      anchor = performance.now();
      publish({ position: anchorPosition });
      void deliver();
    },
    setRate(rate) {
      if (!Number.isFinite(rate) || rate <= 0)
        throw new Error('Playback rate must be positive and finite.');
      if (closed) return;
      anchorPosition = position();
      anchor = performance.now();
      publish({ position: anchorPosition, rate });
    },
    close() {
      closed = true;
      version++;
      clearTimeout(timer);
      frames.clear();
      states.clear();
      views.clear();
      errors.clear();
    },
  };
}

import { errorMessage } from './errors.ts';
import type { VideoMode, Yuv420Frame } from '@irvis/core';
import { analyse } from './analysis.ts';
import { copyFrame, metadata, processor, unsupported, type FrameMetadata } from './frame.ts';

type Request =
  | { type: 'frame'; frame: Yuv420Frame; mode: VideoMode; info: FrameMetadata }
  | { type: 'track'; track: MediaStreamTrack; mode: VideoMode }
  | { type: 'stop' };
export interface WorkerScope {
  onmessage: (event: MessageEvent<Request>) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}
export function installWorker(scope: WorkerScope): void {
  let stopped = false;
  let track: MediaStreamTrack | undefined;
  let reader: ReadableStreamDefaultReader<VideoFrame> | undefined;
  let task: Promise<void> = Promise.resolve();
  scope.postMessage({ type: 'ready', processor: Boolean(processor()) });
  function deliver(frame: Yuv420Frame, mode: VideoMode, info: FrameMetadata) {
    const result = analyse(frame, mode, info);
    scope.postMessage({ type: 'result', result }, [frame.data.buffer as ArrayBuffer]);
  }
  scope.onmessage = (event) => {
    const request = event.data;
    if (request.type === 'stop') {
      stopped = true;
      track?.stop();
      void reader?.cancel().catch(() => {});
      void task.finally(() => scope.postMessage({ type: 'stopped' }));
      return;
    }
    task = (async () => {
      if (request.type === 'frame') {
        deliver(request.frame, request.mode, request.info);
        return;
      }
      track = request.track;
      const Constructor = processor();
      if (!Constructor) throw new Error(unsupported);
      reader = new Constructor({ track: request.track, maxBufferSize: 1 }).readable.getReader();
      try {
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          try {
            const info = metadata(value);
            scope.postMessage({ type: 'metadata', info });
            const frame = await copyFrame(value, request.mode);
            if (!stopped) deliver(frame, request.mode, info);
          } finally {
            value.close();
          }
        }
        if (!stopped) scope.postMessage({ type: 'ended' });
      } finally {
        request.track.stop();
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        reader = undefined;
      }
    })().catch((error: unknown) => {
      track?.stop();
      if (!stopped) scope.postMessage({ type: 'error', message: errorMessage(error) });
    });
  };
}

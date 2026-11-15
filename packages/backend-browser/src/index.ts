import { errorMessage } from './errors.ts';
import type { VideoMode } from '@irvis/core';
import type { Analysis } from './analysis.ts';
import {
  constraints,
  copyFrame,
  metadata,
  processor,
  unsupported,
  type FrameMetadata,
} from './frame.ts';
export type { Analysis, FrameMetadata };
export { constraints, copyFrame, metadata };
export { rejection } from './frame.ts';
export { errorMessage };
export const deviceKey = 'irvis.browser.deviceId';
export interface Callbacks {
  metadata: (info: FrameMetadata) => void;
  result: (result: Analysis) => void;
  error: (message: string) => void;
}

/** Stop may be called even while permission is pending. */
export function startDiagnostics(
  mode: VideoMode,
  deviceId: string,
  callbacks: Callbacks,
): () => void {
  let stopped = false;
  let stream: MediaStream | undefined;
  let worker: Worker | undefined;
  let reader: ReadableStreamDefaultReader<VideoFrame> | undefined;
  let acknowledge: (() => void) | undefined;
  let transferred = false;
  let cancelHandshake: (() => void) | undefined;
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    clearTimeout(shutdownTimer);
    worker?.terminate();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    acknowledge?.();
    void reader?.cancel().catch(() => {});
    stream?.getTracks().forEach((track) => track.stop());
    cancelHandshake?.();
    if (transferred && worker) {
      shutdownTimer = setTimeout(terminate, 1000);
      try {
        worker.postMessage({ type: 'stop' });
      } catch {
        terminate();
      }
    } else terminate();
  };
  const fail = (error: unknown) => {
    if (!stopped) callbacks.error(errorMessage(error));
    stop();
  };
  void (async () => {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Camera access requires HTTPS or localhost.');
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const workerProcessor = await new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Diagnostics worker did not start.')), 5000);
      cancelHandshake = () => {
        clearTimeout(timer);
        resolve(false);
      };
      worker!.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error(event.message || 'Diagnostics worker failed.'));
      };
      worker!.onmessage = (event: MessageEvent<{ type: string; processor: boolean }>) => {
        if (event.data.type === 'ready') {
          clearTimeout(timer);
          resolve(event.data.processor);
        }
      };
    });
    cancelHandshake = undefined;
    if (stopped) return;
    const Constructor = processor();
    if (!Constructor && !workerProcessor) throw new Error(unsupported);
    worker.onerror = (event) => fail(event.message || 'Diagnostics worker failed.');
    worker.onmessage = (
      event: MessageEvent<
        | { type: 'result'; result: Analysis }
        | { type: 'metadata'; info: FrameMetadata }
        | { type: 'error'; message: string }
        | { type: 'ended' }
        | { type: 'stopped' }
      >,
    ) => {
      const message = event.data;
      if (message.type === 'stopped') {
        terminate();
        return;
      }
      if (stopped) return;
      if (message.type === 'result') {
        callbacks.result(message.result);
        acknowledge?.();
      } else if (message.type === 'metadata') callbacks.metadata(message.info);
      else fail(message.type === 'error' ? message.message : 'Camera stream ended.');
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints(mode, deviceId));
    if (stopped) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('No video track returned.');
    track.onended = () => fail('Camera stream ended.');
    try {
      localStorage.setItem(deviceKey, track.getSettings().deviceId ?? deviceId);
    } catch {
      /* Storage may be disabled. */
    }
    if (!Constructor) {
      worker.postMessage({ type: 'track', track, mode }, [track]);
      transferred = true;
      return;
    }
    reader = new Constructor({ track, maxBufferSize: 1 }).readable.getReader();
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) {
          if (!stopped) fail('Camera stream ended.');
          break;
        }
        try {
          const info = metadata(value);
          callbacks.metadata(info);
          const frame = await copyFrame(value, mode);
          if (stopped) break;
          const processed = new Promise<void>((resolve) => {
            acknowledge = resolve;
          });
          worker.postMessage({ type: 'frame', frame, info, mode }, [frame.data.buffer]);
          await processed;
        } finally {
          value.close();
        }
      }
    } finally {
      reader.releaseLock();
      reader = undefined;
    }
  })().catch(fail);
  return stop;
}

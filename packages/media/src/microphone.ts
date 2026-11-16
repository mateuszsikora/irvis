import type { ByteSink } from '@irvis/core';
/** Version 1 sidecar: MediaRecorder WebM/Opus, starting at the first recorded frame. */
export interface MicrophoneRecording {
  stop(): Promise<void>;
}
export async function startMicrophone(
  sink: ByteSink,
  onError: (error: unknown) => void,
): Promise<MicrophoneRecording> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1 },
      video: false,
    });
  } catch (error) {
    await sink.close();
    throw error;
  }
  let recorder: MediaRecorder;
  try {
    if (
      typeof MediaRecorder === 'undefined' ||
      !MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    )
      throw new Error('Microphone recording requires WebM/Opus support.');
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  } catch (value) {
    stream.getTracks().forEach((track) => track.stop());
    await sink.close();
    throw value;
  }
  let pending: Promise<void> = Promise.resolve();
  let queued = 0;
  let error: unknown;
  let stopping: Promise<void> | undefined;
  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  function fail(value: unknown) {
    error = value;
    stopTracks();
    if (recorder.state !== 'inactive') recorder.stop();
    onError(value);
  }
  recorder.onerror = () => fail(new Error('Microphone recording failed.'));
  recorder.ondataavailable = (event) => {
    if (!event.data.size || error) return;
    if (queued >= 2) {
      fail(new Error('Audio storage is too slow; recording stopped.'));
      return;
    }
    queued++;
    pending = pending
      .then(async () => {
        const bytes = await event.data.arrayBuffer();
        await sink.append(new Uint8Array(bytes));
        await sink.flush();
      })
      .catch(fail)
      .finally(() => {
        queued--;
      });
  };
  try {
    recorder.start(1000);
  } catch (value) {
    stopTracks();
    await sink.close();
    throw value;
  }
  return {
    stop() {
      stopping ??= (async () => {
        if (recorder.state !== 'inactive') recorder.stop();
        stopTracks();
        await stopped;
        await pending;
        await sink.close();
        if (error) throw error instanceof Error ? error : new Error('Microphone recording failed.');
      })();
      return stopping;
    },
  };
}

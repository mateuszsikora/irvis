import type { ByteSink } from '@irvis/core';
import workletUrl from './audio-worklet.ts?worker&url';
import { audioHeader, audioPacket } from './audio-sidecar.ts';
export interface MicrophoneRecording {
  stop(): Promise<void>;
}
export async function startMicrophone(
  sink: ByteSink,
  onError: (error: unknown) => void,
): Promise<MicrophoneRecording> {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode;
  let node: AudioWorkletNode;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1 },
      video: false,
    });
    context = new AudioContext();
    await context.audioWorklet.addModule(workletUrl);
    await context.resume();
    await sink.append(audioHeader(context.sampleRate));
    await sink.flush();
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, 'irvis-microphone', {
      channelCount: 1,
      channelCountMode: 'explicit',
    });
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    await context?.close();
    await sink.close();
    throw error;
  }
  const clock = context;
  const tracks = stream.getTracks();
  let pending = Promise.resolve();
  let failure: unknown;
  let stopping: Promise<void> | undefined;
  let acknowledgeStop: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    acknowledgeStop = resolve;
  });
  function fail(error: unknown) {
    if (failure) return;
    failure = error;
    tracks.forEach((track) => track.stop());
    onError(error);
  }
  for (const track of tracks)
    track.addEventListener('ended', () => {
      if (!stopping) fail(new Error('Microphone disconnected.'));
    });
  node.onprocessorerror = () => fail(new Error('Microphone processing failed.'));
  clock.onstatechange = () => {
    if (!stopping && clock.state !== 'running')
      fail(new Error('Microphone clock was interrupted.'));
  };
  node.port.onmessage = ({
    data,
  }: MessageEvent<{ frame: number; samples: Float32Array; stopped?: boolean; error?: string }>) => {
    if (data.stopped) {
      acknowledgeStop();
      return;
    }
    if (data.error) {
      fail(new Error(data.error));
      return;
    }
    if (failure) return;
    // Subtract delivery delay in audio-clock units, instead of timestamping message arrival.
    const timestamp =
      performance.now() + (data.frame / clock.sampleRate - clock.currentTime) * 1000;
    const bytes = audioPacket(timestamp, data.samples);
    pending = pending
      .then(async () => {
        if (failure) return;
        await sink.append(bytes);
        await sink.flush();
        node.port.postMessage('ack');
      })
      .catch(fail);
  };
  source.connect(node);
  node.connect(context.destination); // processor outputs silence; microphone is never monitored
  return {
    stop() {
      stopping ??= (async () => {
        node.port.postMessage('stop');
        tracks.forEach((track) => track.stop());
        const timeout = setTimeout(() => {
          fail(new Error('Microphone did not stop in time.'));
          acknowledgeStop();
        }, 1000);
        await stopped;
        clearTimeout(timeout);
        source.disconnect();
        node.disconnect();
        await clock.close();
        await pending;
        node.port.close();
        await sink.close();
        if (failure)
          throw failure instanceof Error ? failure : new Error('Microphone recording failed.');
      })();
      return stopping;
    },
  };
}

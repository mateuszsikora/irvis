import { alignAudio } from './audio-sidecar.ts';
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output } from 'mediabunny';
import { IrvisReader, type ByteSource, type ThermalFrame, type ViewStateValues } from '@irvis/core';

/** Render outside the live viewer, then encode sequentially with WebCodecs backpressure. */
export async function exportMp4(
  source: ByteSource,
  canvas: HTMLCanvasElement,
  render: (frame: ThermalFrame, view: ViewStateValues) => void,
  audio?: Blob,
): Promise<Uint8Array> {
  if (typeof VideoEncoder === 'undefined')
    throw new Error('MP4 export requires WebCodecs VideoEncoder.');
  const reader = await IrvisReader.open(source);
  if (!reader.frames.length) throw new Error('Recording contains no complete frames.');
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const video = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: 4_000_000,
    sizeChangeBehavior: 'contain',
  });
  output.addVideoTrack(video, { frameRate: reader.header.fps });
  const origin = reader.frames[0]!.timestamp;
  const durationMs = reader.frames.at(-1)!.timestamp - origin + 1000 / reader.header.fps;
  let audioBuffer: AudioBuffer | undefined;
  const audioSource = audio ? new AudioBufferSource({ codec: 'aac', bitrate: 128000 }) : null;
  if (audioSource && audio) {
    if (audio.type === 'application/x-irvis-audio') {
      const aligned = alignAudio(new Uint8Array(await audio.arrayBuffer()), origin, durationMs);
      const context = new OfflineAudioContext(1, Math.ceil(durationMs * 44.1), 44100);
      const buffer = context.createBuffer(1, aligned.samples.length, aligned.sampleRate);
      buffer.copyToChannel(aligned.samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start();
      audioBuffer = await context.startRendering();
    } else {
      // Read compatibility for the initial version 1 WebM sidecars.
      const context = new AudioContext({ sampleRate: 44100 });
      try {
        audioBuffer = await context.decodeAudioData(await audio.arrayBuffer());
      } finally {
        await context.close();
      }
    }
    output.addAudioTrack(audioSource);
  }
  let view = reader.header.viewState;
  let changeIndex = 0;
  try {
    await output.start();
    if (audioSource && audioBuffer) {
      await audioSource.add(audioBuffer);
      audioSource.close();
    }
    for (let i = 0; i < reader.frames.length; i++) {
      const { frame } = await reader.readFrame(i);
      while (
        changeIndex < reader.viewStates.length &&
        reader.viewStates[changeIndex]!.timestamp <= frame.timestamp
      ) {
        view = { ...view, ...reader.viewStates[changeIndex++]!.values };
      }
      render(frame, view);
      const duration =
        ((reader.frames[i + 1]?.timestamp ?? frame.timestamp + 1000 / reader.header.fps) -
          frame.timestamp) /
        1000;
      if (duration > 0) await video.add((frame.timestamp - origin) / 1000, duration);
    }
    video.close();
    await output.finalize();
    return new Uint8Array(output.target.buffer!);
  } catch (error) {
    await output.cancel();
    throw error;
  }
}

export async function saveRecordingFile(name: string, source: ByteSource): Promise<void> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{
        createWritable(): Promise<{
          write(bytes: Uint8Array): Promise<void>;
          close(): Promise<void>;
          abort(): Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;
  if (picker && navigator.userActivation?.isActive) {
    const file = await picker({ suggestedName: name });
    const writable = await file.createWritable();
    try {
      const size = await source.size();
      for (let offset = 0; offset < size; offset += 1024 * 1024)
        await writable.write(await source.read(offset, Math.min(1024 * 1024, size - offset)));
      await writable.close();
    } catch (error) {
      await writable.abort();
      throw error;
    }
  } else {
    const bytes = await source.read(0, await source.size());
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer]));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

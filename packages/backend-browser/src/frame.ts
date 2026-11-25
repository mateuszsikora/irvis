import type { VideoMode, Yuv420Frame } from '@irvis/core';

export const unsupported = 'use Chrome, Edge or Safari';
export interface ProcessorConstructor {
  new (options: { track: MediaStreamTrack; maxBufferSize: number }): {
    readable: ReadableStream<VideoFrame>;
  };
}
export function processor(): ProcessorConstructor | undefined {
  return (globalThis as unknown as { MediaStreamTrackProcessor?: ProcessorConstructor })
    .MediaStreamTrackProcessor;
}
export function constraints(mode: VideoMode, deviceId: string): MediaStreamConstraints {
  const video: MediaTrackConstraints & { resizeMode: ConstrainDOMString } = {
    width: { exact: mode.width },
    height: { exact: mode.height },
    frameRate: mode.fps,
    resizeMode: { exact: 'none' },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
  return { audio: false, video };
}
export function metadata(frame: VideoFrame) {
  const r = frame.visibleRect;
  return {
    format: frame.format,
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    visibleRect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
    colorSpace: frame.colorSpace.toJSON(),
    timestampUs: frame.timestamp,
  };
}
export type FrameMetadata = ReturnType<typeof metadata>;
export function rejection(frame: FrameMetadata, mode: VideoMode): string | null {
  if (frame.codedWidth !== mode.width || frame.codedHeight !== mode.height)
    return `Frame size mismatch: got ${frame.codedWidth}×${frame.codedHeight}, expected ${mode.width}×${mode.height}; ${mode.layout ? 'reconstruction cannot start' : 'the image cannot be shown'}.`;
  if (frame.format !== 'I420' && frame.format !== 'NV12')
    return mode.layout
      ? `Unsupported frame format: got ${frame.format ?? 'null'}; only I420 and NV12 can be reconstructed. RGB data cannot be recovered.`
      : `Unsupported frame format: got ${frame.format ?? 'null'}; only I420 and NV12 can be shown.`;
  return null;
}
export async function copyFrame(frame: VideoFrame, mode: VideoMode): Promise<Yuv420Frame> {
  const error = rejection(metadata(frame), mode);
  if (error) throw new Error(error);
  const options = { rect: { x: 0, y: 0, width: frame.codedWidth, height: frame.codedHeight } };
  const data = new Uint8Array(frame.allocationSize(options));
  const planes = await frame.copyTo(data, options);
  return {
    kind: 'yuv420',
    layout: frame.format === 'I420' ? 'i420' : 'nv12',
    width: frame.codedWidth,
    height: frame.codedHeight,
    timestamp: frame.timestamp / 1000,
    data,
    planes,
  };
}

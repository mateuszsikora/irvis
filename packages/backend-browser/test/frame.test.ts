import { describe, expect, it, vi } from 'vitest';
import { cameraProfiles } from '@irvis/core';
import { constraints, copyFrame, rejection, type FrameMetadata } from '@irvis/backend-browser';
const mode = cameraProfiles[0]!.videoModes.find((m) => m.layout)!;
const info: FrameMetadata = {
  format: 'NV12',
  codedWidth: mode.width,
  codedHeight: mode.height,
  visibleRect: null,
  colorSpace: {},
  timestampUs: 12000,
};
function fakeFrame(overrides: Partial<FrameMetadata> = {}) {
  const mock = {
    ...info,
    timestamp: info.timestampUs,
    colorSpace: { toJSON: () => ({}) },
    allocationSize: vi.fn(() => 24),
    copyTo: vi.fn(() =>
      Promise.resolve([
        { offset: 0, stride: 4 },
        { offset: 16, stride: 4 },
      ]),
    ),
    ...overrides,
  };
  return { frame: mock as unknown as VideoFrame, mock };
}
describe('browser capture', () => {
  it('requests profile dimensions without resizing and the selected device', () => {
    expect(constraints(mode, 'camera')).toEqual({
      audio: false,
      video: {
        width: { exact: mode.width },
        height: { exact: mode.height },
        frameRate: mode.fps,
        resizeMode: { exact: 'none' },
        deviceId: { exact: 'camera' },
      },
    });
  });
  it('rejects mismatched dimensions and RGB frames before copying bytes', async () => {
    for (const changes of [
      { codedWidth: 1 },
      { codedHeight: 1 },
      { format: 'RGBA' as const },
      { format: 'BGRA' as const },
    ]) {
      const { frame, mock } = fakeFrame(changes);
      await expect(copyFrame(frame, mode)).rejects.toThrow();
      expect(mock.copyTo).not.toHaveBeenCalled();
    }
    expect(rejection(info, mode)).toBeNull();
  });
  it('copies a frame of a mode without temperature data, which only has to be shown', async () => {
    const image = { ...cameraProfiles[0]!.videoModes.find((m) => !m.layout)!, width: 4, height: 4 };
    const { frame } = fakeFrame({ codedWidth: 4, codedHeight: 4 });
    expect((await copyFrame(frame, image)).layout).toBe('nv12');
    expect(rejection({ ...info, codedWidth: 4, codedHeight: 4, format: 'RGBA' }, image)).toBe(
      'Unsupported frame format: got RGBA; only I420 and NV12 can be shown.',
    );
    expect(rejection(info, image)).toBe(
      `Frame size mismatch: got ${mode.width}×${mode.height}, expected 4×4; the image cannot be shown.`,
    );
  });
  it('copies the full coded rectangle without requesting format conversion', async () => {
    const { frame, mock } = fakeFrame();
    const result = await copyFrame(frame, mode);
    const options = { rect: { x: 0, y: 0, width: mode.width, height: mode.height } };
    expect(mock.allocationSize).toHaveBeenCalledWith(options);
    expect(mock.copyTo).toHaveBeenCalledWith(expect.any(Uint8Array), options);
    expect(result.timestamp).toBe(12);
    expect(result.layout).toBe('nv12');
    expect(result.planes).toEqual([
      { offset: 0, stride: 4 },
      { offset: 16, stride: 4 },
    ]);
  });
});

// Browser exposure and transfer are mocked; real camera checks remain in the owner run.

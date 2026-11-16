import { describe, expect, it, vi } from 'vitest';
import { cameraProfiles, type ThermalFrame } from '@irvis/core';
import { FrameRenderer, type ViewSettings } from '../src/render.ts';
describe('FrameRenderer', () => {
  it('holds locked bounds across changing scenes and marks uncertain pixels', () => {
    const context = {
      putImageData: vi.fn<(image: ImageData, x: number, y: number) => void>(),
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.stubGlobal(
      'ImageData',
      class {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      },
    );
    const bounds = document.createElement('output');
    const renderer = new FrameRenderer(
      document.createElement('canvas'),
      document.createElement('canvas'),
      bounds,
      document.createElement('p'),
    );
    const frame: ThermalFrame = {
      width: 3,
      height: 1,
      timestamp: 0,
      raw: new Uint16Array([20, 40, 100]),
      conversion: { kind: 'linear', scale: 1, offset: 0 },
      uncertain: new Uint8Array([0, 0, 1]),
      cameraState: { origin: 'assumed', values: {} },
    };
    const settings: ViewSettings = {
      palette: 'iron',
      range: null,
      locked: false,
      rotation: 90,
      mirrorX: true,
      mirrorY: false,
      smooth: false,
      uncertain: true,
      gain: 'high',
    };
    const profile = cameraProfiles[0]!;
    renderer.draw({ kind: 'thermal', frame }, profile, profile.videoModes[0]!, settings);
    expect(renderer.range).toEqual({ minCelsius: 20, maxCelsius: 40 });
    expect(context.putImageData.mock.calls[0]![0].data.slice(8, 12)).toEqual(
      new Uint8ClampedArray([255, 0, 255, 255]),
    );
    renderer.draw(
      { kind: 'thermal', frame: { ...frame, raw: new Uint16Array([10, 60, 100]) } },
      profile,
      profile.videoModes[0]!,
      { ...settings, locked: true },
    );
    expect(renderer.range).toEqual({ minCelsius: 20, maxCelsius: 40 });
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(context.scale).toHaveBeenCalledWith(-1, 1);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { cameraProfiles, IrvisReader, memoryByteSource, type ThermalFrame } from '@irvis/core';
import { initialAnalysis } from '../src/measurements.ts';
import { FrameRenderer, type ViewSettings } from '../src/render.ts';
describe('FrameRenderer', () => {
  it('resets alarm hysteresis when the frame source changes', () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      const alarm = vi.fn();
      const renderer = new FrameRenderer(
        document.createElement('canvas'),
        document.createElement('canvas'),
        document.createElement('output'),
        document.createElement('p'),
        undefined,
        alarm,
      );
      const profile = cameraProfiles[0]!;
      const settings: ViewSettings = {
        palette: 'iron',
        range: null,
        locked: false,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
        smooth: false,
        uncertain: false,
        gain: 'high',
        alarmGeneration: 1,
        analysis: { ...initialAnalysis, alarm: true, threshold: 40.25 },
      };
      const frame: ThermalFrame = {
        width: 1,
        height: 1,
        timestamp: 0,
        raw: new Uint16Array([41]),
        conversion: { kind: 'linear', scale: 1, offset: 0 },
        cameraState: { origin: 'assumed', values: {} },
        uncertain: null,
      };
      renderer.draw({ kind: 'thermal', frame }, profile, profile.videoModes[0]!, settings);
      expect(alarm).toHaveBeenLastCalledWith(true);
      const belowThreshold = { ...frame, raw: new Uint16Array([40]) };
      renderer.draw(
        { kind: 'thermal', frame: belowThreshold },
        profile,
        profile.videoModes[0]!,
        settings,
      );
      expect(alarm).toHaveBeenLastCalledWith(true);
      renderer.draw({ kind: 'thermal', frame: belowThreshold }, profile, profile.videoModes[0]!, {
        ...settings,
        alarmGeneration: 2,
      });
      expect(alarm).toHaveBeenLastCalledWith(false);
    } finally {
      context.mockRestore();
    }
  });
  it('holds locked bounds across changing scenes and marks uncertain pixels', async () => {
    const context = {
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(12).fill(123) })),
      putImageData: vi.fn<(image: ImageData, x: number, y: number) => void>(),
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
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
    const readouts = document.createElement('output');
    const alarm = vi.fn();
    const analysisRenderer = new FrameRenderer(
      document.createElement('canvas'),
      document.createElement('canvas'),
      bounds,
      document.createElement('p'),
      readouts,
      alarm,
    );
    const correctedSettings: ViewSettings = {
      ...settings,
      captureMetadata: {
        profile: { id: 'imported', version: 2, name: 'Imported camera' },
        fps: 12,
        path: 'reconstructed',
      },
      analysis: {
        ...initialAnalysis,
        alarm: true,
        threshold: 45,
        isotherm: true,
        correction: { emissivity: 0.5, reflectedCelsius: 25, offsetKelvin: 10 },
        unit: 'F',
        tracking: { min: true, max: true, centre: false },
      },
    };
    const correctedFrame = {
      ...frame,
      cameraState: {
        origin: 'assumed' as const,
        values: { emissivity: 0.5, 'reflected-temperature': 25 },
      },
    };
    context.putImageData.mockClear();
    analysisRenderer.draw(
      { kind: 'thermal', frame: correctedFrame },
      profile,
      profile.videoModes[0]!,
      correctedSettings,
    );
    expect(readouts.textContent).toBe('min: 86.0 °F\nmax: 122.0 °F');
    expect(alarm).toHaveBeenLastCalledWith(true);
    expect(context.putImageData.mock.calls[0]![0].data.slice(4, 8)).toEqual(
      new Uint8ClampedArray([255, 0, 0, 255]),
    );
    analysisRenderer.draw(
      { kind: 'thermal', frame: correctedFrame },
      profile,
      profile.videoModes[0]!,
      { ...correctedSettings, analysis: { ...correctedSettings.analysis!, alarm: false } },
    );
    expect(alarm).toHaveBeenLastCalledWith(false);
    const photo = await analysisRenderer.capturePhoto();
    const reader = await IrvisReader.open(memoryByteSource(photo));
    const captured = (await reader.readFrame(0)).frame;
    expect(captured.width).toBe(1);
    expect(captured.height).toBe(3);
    expect([...captured.raw]).toEqual([100, 40, 20]);
    expect([...captured.uncertain!]).toEqual([1, 0, 0]);
    expect(reader.header.viewState['capturedOverlays']).toBe(true);
    expect(reader.header.profile.id).toBe('imported');
    expect(reader.header.fps).toBe(12);
    expect(reader.header.path).toBe('reconstructed');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});

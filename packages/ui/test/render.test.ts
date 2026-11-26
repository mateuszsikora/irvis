import { describe, expect, it, vi } from 'vitest';
import {
  cameraProfiles,
  findVideoMode,
  IrvisReader,
  memoryByteSource,
  simulateYUYVtoI420,
  type ThermalFrame,
} from '@irvis/core';
import { initialAnalysis } from '../src/measurements.ts';
import {
  CAMERA_CORRECTION_UNKNOWN,
  FrameRenderer,
  crossRect,
  placeLabel,
  type Rect,
  type ViewSettings,
} from '../src/render.ts';
describe('FrameRenderer', () => {
  it('retains exact raw bytes but excludes out-of-range readings in live and replay', () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      for (const [gain, temperature] of [
        ['low', 85],
        ['high', 170],
      ] as const) {
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
        const data = new Uint8Array(256 * 384 * 2);
        const raw = Math.round((temperature + 273.15) * 64);
        const view = new DataView(data.buffer);
        for (let i = 256 * 192 * 2; i < data.length; i += 2) view.setUint16(i, raw, true);
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
          analysis: {
            ...initialAnalysis,
            alarm: true,
            threshold: 80,
            correction: { emissivity: 1, reflectedCelsius: 20, offsetKelvin: 20 },
          },
        };
        renderer.draw(
          {
            kind: 'yuyv',
            width: 256,
            height: 384,
            timestamp: 0,
            data,
            cameraState: { origin: 'camera', values: { gain } },
          },
          profile,
          profile.videoModes[0]!,
          settings,
        );
        const recorded = renderer.recordingFrame()!;
        expect(recorded.frame.raw[0]).toBe(raw);
        expect(recorded.frame.uncertain?.every((value) => value === 1)).toBe(true);
        expect(recorded.options.path).toBe('exact');
        expect(alarm).toHaveBeenLastCalledWith(false);
        renderer.draw(
          { kind: 'thermal', frame: recorded.frame },
          profile,
          profile.videoModes[0]!,
          settings,
        );
        expect(alarm).toHaveBeenLastCalledWith(false);
        expect(renderer.recordingFrame()?.frame.uncertain).toEqual(recorded.frame.uncertain);
      }
    } finally {
      context.mockRestore();
    }
  });
  it("shows a mode without temperature data as the camera's colours, oriented, with no readings", () => {
    const putImageData = vi.fn();
    const drawImage = vi.fn();
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData,
      drawImage,
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal('ImageData', function (data: Uint8ClampedArray, width: number, height: number) {
      return { data, width, height };
    });
    try {
      const canvas = document.createElement('canvas');
      const bounds = document.createElement('output');
      const warning = document.createElement('p');
      const readouts = document.createElement('output');
      const alarm = vi.fn();
      const renderer = new FrameRenderer(
        canvas,
        document.createElement('canvas'),
        bounds,
        warning,
        readouts,
        alarm,
      );
      warning.textContent = 'old';
      readouts.textContent = 'old';
      const profile = cameraProfiles[0]!;
      const mode = findVideoMode(profile, 'image-4x2@30')!;
      // White, then black, both grey (U = V = 128).
      const data = Uint8Array.from(
        [235, 128, 235, 128, 16, 128, 16, 128].concat(new Array(8).fill(16)),
      );
      renderer.draw({ kind: 'yuyv', width: 4, height: 2, timestamp: 0, data }, profile, mode, {
        palette: 'iron',
        range: null,
        locked: false,
        rotation: 90,
        mirrorX: false,
        mirrorY: false,
        smooth: false,
        uncertain: false,
        gain: 'high',
        analysis: { ...initialAnalysis, alarm: true, threshold: -100 },
      });
      const image = putImageData.mock.calls[0]![0] as ImageData;
      expect([image.width, image.height]).toEqual([4, 2]);
      expect(Array.from(image.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
      expect(Array.from(image.data.slice(8, 12))).toEqual([0, 0, 0, 255]);
      expect([canvas.width, canvas.height]).toEqual([2, 4]);
      expect(drawImage).toHaveBeenCalledOnce();
      expect(bounds.textContent).toBe('No temperature data');
      expect(warning.textContent).toBe('');
      expect(readouts.textContent).toBe('');
      expect(alarm).toHaveBeenLastCalledWith(false);
      expect(renderer.recordingFrame()).toBeNull();
      expect(() => renderer.capturePhoto()).toThrow('No rendered thermal frame is available.');
      // The browser's 4:2:0 frame: white, then black, in both rows.
      const row = [235, 128, 235, 128, 16, 128, 16, 128];
      const yuyv = { kind: 'yuyv' as const, width: 4, height: 2, timestamp: 0 };
      renderer.draw(
        simulateYUYVtoI420({ ...yuyv, data: Uint8Array.from([...row, ...row]) }),
        profile,
        mode,
        {
          palette: 'iron',
          range: null,
          locked: false,
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
          smooth: false,
          uncertain: false,
          gain: 'high',
          analysis: initialAnalysis,
        },
      );
      const planar = Array.from((putImageData.mock.calls[1]![0] as ImageData).data);
      const white = [255, 255, 255, 255];
      const black = [0, 0, 0, 255];
      expect(planar).toEqual([
        ...white,
        ...white,
        ...black,
        ...black,
        ...white,
        ...white,
        ...black,
        ...black,
      ]);
      expect([canvas.width, canvas.height]).toEqual([4, 2]);
      expect(bounds.textContent).toBe('No temperature data');
    } finally {
      context.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it('refuses a camera-reported gain without a conversion despite the host assumption', () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      const warning = document.createElement('p');
      const bounds = document.createElement('output');
      const renderer = new FrameRenderer(
        document.createElement('canvas'),
        document.createElement('canvas'),
        bounds,
        warning,
      );
      const profile = cameraProfiles[0]!;
      renderer.draw(
        {
          kind: 'yuyv',
          width: 256,
          height: 384,
          timestamp: 0,
          data: new Uint8Array(256 * 384 * 2),
          cameraState: { origin: 'camera', values: { gain: 'unsupported' } },
        },
        profile,
        profile.videoModes[0]!,
        {
          palette: 'iron',
          range: null,
          locked: false,
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
          smooth: false,
          uncertain: false,
          gain: 'high',
        },
      );
      expect(bounds.textContent).toBe('Readings unavailable');
      expect(warning.textContent).toContain('No verified conversion');
    } finally {
      context.mockRestore();
    }
  });
  it('blocks missing or unknown camera gain without falling back to high', () => {
    for (const values of [{}, { gain: 'unknown' }]) {
      const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      try {
        const warning = document.createElement('p');
        const bounds = document.createElement('output');
        const renderer = new FrameRenderer(
          document.createElement('canvas'),
          document.createElement('canvas'),
          bounds,
          warning,
        );
        const profile = cameraProfiles[0]!;
        renderer.draw(
          {
            kind: 'yuyv',
            width: 256,
            height: 384,
            timestamp: 0,
            data: new Uint8Array(256 * 384 * 2),
            cameraState: { origin: 'camera', values },
          },
          profile,
          profile.videoModes[0]!,
          {
            palette: 'iron',
            range: null,
            locked: false,
            rotation: 0,
            mirrorX: false,
            mirrorY: false,
            smooth: false,
            uncertain: false,
            gain: 'high',
          },
        );
        expect(bounds.textContent).toBe('Readings unavailable');
        expect(warning.textContent).toContain('No verified conversion');
      } finally {
        context.mockRestore();
      }
    }
  });
  it('uses camera emissivity for relative correction of live exact frames', () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      const bounds = document.createElement('output');
      const renderer = new FrameRenderer(
        document.createElement('canvas'),
        document.createElement('canvas'),
        bounds,
        document.createElement('p'),
      );
      const profile = cameraProfiles[0]!;
      const data = new Uint8Array(256 * 384 * 2);
      const raw = 20000;
      for (let i = 256 * 192 * 2; i < data.length; i += 2) {
        data[i] = raw & 255;
        data[i + 1] = raw >> 8;
      }
      renderer.draw(
        {
          kind: 'yuyv',
          width: 256,
          height: 384,
          timestamp: 0,
          data,
          cameraState: {
            origin: 'camera',
            values: { gain: 'high', emissivity: 0.5, 'reflected-temperature': 20 },
          },
        },
        profile,
        profile.videoModes[0]!,
        {
          palette: 'iron',
          range: null,
          locked: false,
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
          smooth: false,
          uncertain: false,
          gain: 'high',
          analysis: {
            ...initialAnalysis,
            correction: { emissivity: 0.5, reflectedCelsius: 20, offsetKelvin: 0 },
          },
        },
      );
      expect(bounds.textContent).toBe('38.9 °C — 39.9 °C');
    } finally {
      context.mockRestore();
    }
  });
  it('keeps camera readings and recording when the camera correction is unknown', () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      const bounds = document.createElement('output');
      const warning = document.createElement('p');
      const renderer = new FrameRenderer(
        document.createElement('canvas'),
        document.createElement('canvas'),
        bounds,
        warning,
      );
      const profile = cameraProfiles[0]!;
      const data = new Uint8Array(256 * 384 * 2);
      const raw = 20000;
      for (let i = 256 * 192 * 2; i < data.length; i += 2) {
        data[i] = raw & 255;
        data[i + 1] = raw >> 8;
      }
      const settings = (analysis: ViewSettings['analysis']) =>
        ({
          palette: 'iron',
          range: null,
          locked: false,
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
          smooth: false,
          uncertain: false,
          gain: 'high',
          analysis,
        }) as ViewSettings;
      const host = { emissivity: 1, reflectedCelsius: 20, offsetKelvin: 20 };
      for (const [key, correction] of [
        ['emissivity', null],
        ['reflected-temperature', host],
      ] as const) {
        renderer.draw(
          {
            kind: 'yuyv',
            width: 256,
            height: 384,
            timestamp: 0,
            data,
            cameraState: {
              origin: 'camera',
              values: {
                gain: 'high',
                emissivity: 0.875,
                'reflected-temperature': 26.85,
                [key]: 'unknown',
              },
            },
          },
          profile,
          profile.videoModes[0]!,
          settings({ ...initialAnalysis, correction }),
        );
        // Unchanged camera readings: the +20 K Host offset is not applied.
        expect(bounds.textContent).toBe('38.9 °C — 39.9 °C');
        expect(warning.textContent).toBe(CAMERA_CORRECTION_UNKNOWN);
        const recorded = renderer.recordingFrame()!;
        expect(recorded.frame.cameraState.values[key]).toBe('unknown');
        expect(recorded.options.viewState?.['correction']).toEqual(correction);
        renderer.draw(
          { kind: 'thermal', frame: recorded.frame },
          profile,
          profile.videoModes[0]!,
          settings({ ...initialAnalysis, correction: host }),
        );
        expect(bounds.textContent).toBe('38.9 °C — 39.9 °C');
        expect(warning.textContent).toBe(CAMERA_CORRECTION_UNKNOWN);
        expect(renderer.recordingFrame()).not.toBeNull();
      }
    } finally {
      context.mockRestore();
    }
  });
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
      fillText: vi.fn<(text: string, x: number, y: number) => void>(),
      strokeText: vi.fn(),
      setTransform: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 4.5 })),
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
    // The overlay labels each marker with its temperature, not its name.
    expect(context.fillText.mock.calls.map(([label]) => label)).toEqual(['86.0 °F', '122.0 °F']);
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
describe('marker labels', () => {
  it('go right of the cross, then left, below or above, clear of crosses and labels', () => {
    const canvas = { width: 100, height: 50 };
    const taken: Rect[] = [];
    expect(placeLabel({ x: 40, y: 20 }, 35, canvas, taken)).toEqual({ x: 45, y: 23 });
    // A marker beside it takes the left side, the next one goes below.
    expect(placeLabel({ x: 41, y: 21 }, 35, canvas, taken)).toEqual({ x: 1, y: 24 });
    expect(placeLabel({ x: 40, y: 20 }, 35, canvas, taken)).toEqual({ x: 45, y: 34 });
    // Another marker's cross on the right sends the label left.
    expect(placeLabel({ x: 40, y: 20 }, 35, canvas, [crossRect({ x: 52, y: 20 })])).toEqual({
      x: 0,
      y: 23,
    });
    // At the right edge it starts on the left; at the top it goes below.
    expect(placeLabel({ x: 90, y: 40 }, 35, canvas, [])).toEqual({ x: 50, y: 43 });
    expect(placeLabel({ x: 0, y: 0 }, 35, canvas, [])).toEqual({ x: 5, y: 14 });
    // Too small for the label: it is pushed against the edge.
    expect(placeLabel({ x: 2, y: 2 }, 35, { width: 20, height: 5 }, [])).toEqual({ x: 0, y: 4 });
  });
});

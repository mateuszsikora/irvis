import {
  autoRange,
  decodeYuyvRaw,
  reconstructPlanar,
  renderPalette,
  toCelsiusArray,
  type CameraProfile,
  type RawFrame,
  type VideoMode,
  type TemperatureRange,
  type PaletteId,
} from '@irvis/core';

export interface ViewSettings {
  palette: PaletteId;
  range: TemperatureRange | null;
  locked: boolean;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  smooth: boolean;
  uncertain: boolean;
  gain: string;
}

/** Mutable frame state belongs to the canvas subscription, never React state. */
export class FrameRenderer {
  range: TemperatureRange = { minCelsius: 20, maxCelsius: 40 };
  private source: HTMLCanvasElement;
  private canvas: HTMLCanvasElement;
  private scale: HTMLCanvasElement;
  private bounds: HTMLElement;
  private warning: HTMLElement;
  constructor(
    canvas: HTMLCanvasElement,
    scale: HTMLCanvasElement,
    bounds: HTMLElement,
    warning: HTMLElement,
  ) {
    this.canvas = canvas;
    this.scale = scale;
    this.bounds = bounds;
    this.warning = warning;
    this.source = document.createElement('canvas');
  }
  draw(input: RawFrame, profile: CameraProfile, mode: VideoMode, settings: ViewSettings) {
    const conversion = profile.conversions.find((c) => c.gain === settings.gain)?.conversion;
    if (input.kind !== 'thermal' && (!conversion || !mode.layout)) {
      this.warning.textContent = 'No verified conversion for this mode. Readings unavailable.';
      this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.bounds.textContent = 'Readings unavailable';
      return;
    }
    const decoded =
      input.kind === 'thermal'
        ? input.frame
        : input.kind === 'yuyv'
          ? {
              width: input.width,
              height: mode.layout!.thermal.rows,
              raw: decodeYuyvRaw(input, mode.layout!.thermal),
              uncertain: null,
            }
          : reconstructPlanar(input, { thermal: mode.layout!.thermal });
    const celsius = toCelsiusArray(
      decoded.raw,
      input.kind === 'thermal' ? input.frame.conversion : conversion!,
    );
    const image = { ...decoded, celsius };
    const automatic = autoRange(image);
    if (settings.range) this.range = settings.range;
    else if (!settings.locked && automatic) this.range = automatic;
    const expected = profile.sensor.ranges.find((r) => r.gain === settings.gain);
    this.warning.textContent = !automatic
      ? 'No certain temperature readings.'
      : expected &&
          (automatic.minCelsius < expected.minCelsius || automatic.maxCelsius > expected.maxCelsius)
        ? 'Data look inconsistent with the declared camera mode. Check gain and factory settings.'
        : '';
    const rgba = renderPalette(celsius, this.range, settings.palette);
    if (settings.uncertain && decoded.uncertain)
      for (let i = 0; i < decoded.uncertain.length; i++) {
        if (decoded.uncertain[i]) rgba.set([255, 0, 255, 255], i * 4);
      }
    this.source.width = decoded.width;
    this.source.height = decoded.height;
    this.source
      .getContext('2d')
      ?.putImageData(new ImageData(rgba, decoded.width, decoded.height), 0, 0);
    const quarter = settings.rotation % 180 !== 0;
    this.canvas.width = quarter ? decoded.height : decoded.width;
    this.canvas.height = quarter ? decoded.width : decoded.height;
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = settings.smooth;
      ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
      ctx.rotate((settings.rotation * Math.PI) / 180);
      ctx.scale(settings.mirrorX ? -1 : 1, settings.mirrorY ? -1 : 1);
      ctx.drawImage(this.source, -decoded.width / 2, -decoded.height / 2);
    }
    this.canvas.style.imageRendering = settings.smooth ? 'auto' : 'pixelated';
    this.scale.width = 256;
    this.scale.height = 1;
    const values = Float64Array.from(
      { length: 256 },
      (_, i) => this.range.minCelsius + (i / 255) * (this.range.maxCelsius - this.range.minCelsius),
    );
    this.scale
      .getContext('2d')
      ?.putImageData(
        new ImageData(renderPalette(values, this.range, settings.palette), 256, 1),
        0,
        0,
      );
    this.bounds.textContent = `${this.range.minCelsius.toFixed(1)} °C — ${this.range.maxCelsius.toFixed(1)} °C`;
  }
}

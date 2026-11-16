import { orientPhoto } from './photos.ts';
import { analyze, geometry, type AnalysisSettings } from './measurements.ts';
import {
  autoRange,
  exportRenderedPng,
  type JsonValue,
  type ThermalFrame,
  type SnapshotOptions,
  correctFrame,
  temperatureCorrection,
  settingsFromCamera,
  evaluateAlarms,
  paintIsotherms,
  formatTemperature,
  type AlarmState,
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
  analysis?: AnalysisSettings;
  receivedAt?: number;
  captureMetadata?: Pick<SnapshotOptions, 'profile' | 'fps' | 'path'>;
  /** Identity of the frame source; a new source starts without alarm hysteresis. */
  alarmGeneration?: number;
}

/** Mutable frame state belongs to the canvas subscription, never React state. */
export class FrameRenderer {
  range: TemperatureRange = { minCelsius: 20, maxCelsius: 40 };
  private recorded: { frame: ThermalFrame; options: SnapshotOptions; receivedAt: number } | null =
    null;
  private photo: { frame: ThermalFrame; options: SnapshotOptions } | null = null;
  private readouts: HTMLElement | undefined;
  private onAlarm: ((active: boolean) => void) | undefined;
  private alarmGeneration: number | undefined;
  private alarmState: AlarmState | null = null;
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
    readouts?: HTMLElement,
    onAlarm?: (active: boolean) => void,
  ) {
    this.readouts = readouts;
    this.onAlarm = onAlarm;
    this.canvas = canvas;
    this.scale = scale;
    this.bounds = bounds;
    this.warning = warning;
    this.source = document.createElement('canvas');
  }
  draw(input: RawFrame, profile: CameraProfile, mode: VideoMode, settings: ViewSettings) {
    this.photo = null;
    this.recorded = null;
    if (settings.alarmGeneration !== this.alarmGeneration) {
      this.alarmState = null;
      this.alarmGeneration = settings.alarmGeneration;
    }
    const conversion = profile.conversions.find(
      (c) =>
        c.gain ===
        (input.kind === 'yuyv'
          ? (input.cameraState?.values['gain'] ??
            (input.cameraState?.origin === 'camera' ? 'unknown' : settings.gain))
          : settings.gain),
    )?.conversion;
    if (input.kind !== 'thermal' && (!conversion || !mode.layout)) {
      this.warning.textContent = 'No verified conversion for this mode. Readings unavailable.';
      this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.bounds.textContent = 'Readings unavailable';
      if (this.readouts) this.readouts.textContent = '';
      this.alarmState = null;
      this.onAlarm?.(false);
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
          : (input.reconstructed ?? reconstructPlanar(input, { thermal: mode.layout!.thermal }));
    let celsius = toCelsiusArray(
      decoded.raw,
      input.kind === 'thermal' ? input.frame.conversion : conversion!,
    );
    const analysis = settings.analysis;
    if (analysis) {
      if (input.kind === 'thermal')
        celsius = correctFrame(
          input.frame,
          analysis.correction ?? settingsFromCamera(input.frame.cameraState),
        );
      else if (analysis.correction)
        celsius = celsius.map(temperatureCorrection(analysis.correction));
    }
    const image = { ...decoded, celsius };
    const result = analysis ? analyze(image, analysis) : null;
    if (this.readouts) this.readouts.textContent = result?.text ?? '';
    this.alarmState = evaluateAlarms(
      celsius,
      decoded.uncertain,
      {
        highCelsius: analysis?.alarm ? analysis.threshold : null,
        lowCelsius: null,
        hysteresis: 0.5,
      },
      this.alarmState,
    );
    this.onAlarm?.(this.alarmState.high.active);
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
    if (analysis?.isotherm)
      paintIsotherms(rgba, celsius, decoded.uncertain, [
        { kind: 'above', celsius: analysis.threshold, color: [255, 0, 0] },
      ]);
    const selected = analysis?.objects.find((o) => o.id === analysis.selected && o.kind === 'Area');
    if (analysis?.highlight && selected) {
      const { area } = geometry(selected, image);
      const grey = renderPalette(celsius, this.range, 'white-hot');
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          if (x < area.x || x >= area.x + area.width || y < area.y || y >= area.y + area.height) {
            const i = (y * image.width + x) * 4;
            rgba.set(grey.subarray(i, i + 4), i);
          }
        }
    }
    if (settings.uncertain && decoded.uncertain)
      for (let i = 0; i < decoded.uncertain.length; i++) {
        if (decoded.uncertain[i]) rgba.set([255, 0, 255, 255], i * 4);
      }
    this.source.width = decoded.width;
    this.source.height = decoded.height;
    this.source
      .getContext('2d')
      ?.putImageData(new ImageData(rgba, decoded.width, decoded.height), 0, 0);
    const overlay = this.source.getContext('2d');
    if (overlay && analysis && result) {
      overlay.strokeStyle = 'white';
      overlay.fillStyle = 'white';
      overlay.lineWidth = 1;
      overlay.font = '8px sans-serif';
      for (const object of analysis.objects) {
        const { from, to, area } = geometry(object, image);
        overlay.strokeStyle = object.id === analysis.selected ? '#00ff80' : 'white';
        if (object.kind === 'Area') overlay.strokeRect(area.x, area.y, area.width, area.height);
        if (object.kind === 'Line') {
          overlay.beginPath();
          overlay.moveTo(from.x, from.y);
          overlay.lineTo(to.x, to.y);
          overlay.stroke();
        }
      }
      overlay.strokeStyle = 'white';
      for (const marker of result.markers) {
        overlay.beginPath();
        overlay.moveTo(marker.x - 3, marker.y);
        overlay.lineTo(marker.x + 3, marker.y);
        overlay.moveTo(marker.x, marker.y - 3);
        overlay.lineTo(marker.x, marker.y + 3);
        overlay.stroke();
        overlay.fillText(
          marker.label,
          Math.min(marker.x + 4, Math.max(0, image.width - 60)),
          Math.max(8, marker.y),
        );
      }
    }
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
    const thermal: ThermalFrame =
      input.kind === 'thermal'
        ? input.frame
        : {
            ...decoded,
            timestamp: input.timestamp,
            conversion: conversion!,
            cameraState:
              input.kind === 'yuyv' && input.cameraState
                ? input.cameraState
                : { origin: 'assumed', values: {} },
          };
    this.photo = {
      frame: structuredClone(
        orientPhoto(thermal, settings.rotation, settings.mirrorX, settings.mirrorY),
      ),
      options: {
        profile: settings.captureMetadata?.profile ?? {
          id: profile.id,
          version: profile.version,
          name: profile.name,
        },
        fps: settings.captureMetadata?.fps ?? mode.fps,
        path:
          settings.captureMetadata?.path ??
          (input.kind === 'yuv420' || thermal.uncertain ? 'reconstructed' : 'exact'),
        viewState: {
          palette: settings.palette,
          range: { ...this.range },
          correction: { ...(analysis?.correction ?? settingsFromCamera(thermal.cameraState)) },
          unit: analysis?.unit ?? 'C',
          capturedOverlays: true,
        },
      },
    };
    this.recorded = {
      receivedAt: settings.receivedAt ?? thermal.timestamp,
      frame: structuredClone(thermal),
      options: {
        ...this.photo.options,
        viewState: {
          ...this.photo.options.viewState,
          rotation: settings.rotation,
          mirrorX: settings.mirrorX,
          mirrorY: settings.mirrorY,
          analysis: JSON.parse(JSON.stringify(analysis ?? null)) as JsonValue,
        },
      },
    };
    this.bounds.textContent = `${formatTemperature(this.range.minCelsius, analysis?.unit ?? 'C')} — ${formatTemperature(this.range.maxCelsius, analysis?.unit ?? 'C')}`;
  }
  recordingFrame() {
    return this.recorded;
  }
  capturePhoto(): Promise<Uint8Array> {
    const photo = this.photo;
    const context = this.canvas.getContext('2d');
    if (!photo || !context) throw new Error('No rendered thermal frame is available.');
    const pixels = context.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    return exportRenderedPng(photo.frame, pixels, photo.options);
  }
}

import { orientPhoto } from './photos.ts';
import { analyze, geometry, type AnalysisSettings, type Marker } from './measurements.ts';
import { orientedPixel, type Orientation } from './pointer.ts';
import {
  autoRange,
  exportRenderedPng,
  type JsonValue,
  type ThermalFrame,
  type SnapshotOptions,
  correctFrame,
  temperatureCorrection,
  correctionFor,
  cameraCorrection,
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
  type CameraStateSnapshot,
  type RawFrame,
  type VideoMode,
  type TemperatureRange,
  type PaletteId,
  yuv420ToRgba,
  yuyvToRgba,
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

/** Shown while a frame's camera emissivity or reflected temperature is unknown. */
export const CAMERA_CORRECTION_UNKNOWN =
  'Camera correction could not be read. Readings are shown as the camera reported them; Host correction is not applied.';

/**
 * False when `cameraCorrection` rejects the state, e.g. when a failed USB read
 * left `emissivity` or `reflected-temperature` as `unknown`. Host correction
 * relative to such a state would guess the camera's correction.
 */
function cameraCorrectionKnown(state: CameraStateSnapshot): boolean {
  try {
    cameraCorrection(state);
    return true;
  } catch {
    return false;
  }
}

/** A rectangle in canvas pixels; `right` and `bottom` are exclusive. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** 8 px text reaches about 8 pixels above its baseline and 1 below. */
const LABEL_ASCENT = 8;
/** What a label at baseline `x`, `y` covers, with its 1-pixel black outline. */
function labelRect(x: number, y: number, width: number): Rect {
  return { left: x - 1, top: y - LABEL_ASCENT - 1, right: x + width + 1, bottom: y + 2 };
}
/** What a marker's 7-pixel cross covers. */
export function crossRect(marker: { x: number; y: number }): Rect {
  return { left: marker.x - 3, top: marker.y - 3, right: marker.x + 4, bottom: marker.y + 4 };
}
/**
 * Where a marker's label goes, as the start of its baseline: right of the cross,
 * else left of it, else below or above either side; the first spot inside the
 * canvas that covers nothing in `taken` (crosses and labels already placed).
 * With no free spot the first one inside the canvas is used, and when none is
 * inside the label is pushed against the canvas edge. Its rect joins `taken`.
 */
export function placeLabel(
  marker: { x: number; y: number },
  width: number,
  canvas: { width: number; height: number },
  taken: Rect[],
): { x: number; y: number } {
  const right = marker.x + 5,
    left = marker.x - 5 - width;
  // One label's height with its outline, so labels stack without overlapping.
  const step = LABEL_ASCENT + 3;
  const spots = [0, step, -step].flatMap((dy) =>
    [right, left].map((x) => ({ x, y: marker.y + 3 + dy })),
  );
  const inside = (s: { x: number; y: number }) =>
    s.x >= 0 && s.x + width <= canvas.width && s.y - LABEL_ASCENT >= 0 && s.y < canvas.height;
  const free = (s: { x: number; y: number }) => {
    const r = labelRect(s.x, s.y, width);
    return taken.every(
      (t) => r.left >= t.right || t.left >= r.right || r.top >= t.bottom || t.top >= r.bottom,
    );
  };
  const spot = spots.find((s) => inside(s) && free(s)) ??
    spots.find(inside) ?? {
      x: Math.max(0, Math.min(right, canvas.width - width)),
      y: Math.min(canvas.height - 1, Math.max(LABEL_ASCENT, marker.y + 3)),
    };
  taken.push(labelRect(spot.x, spot.y, width));
  return spot;
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
    if (input.kind !== 'thermal' && !mode.layout) {
      this.drawImage(input, settings);
      return;
    }
    const selectedConversion = profile.conversions.find(
      (c) =>
        c.gain ===
        (input.kind === 'yuyv'
          ? (input.cameraState?.values['gain'] ??
            (input.cameraState?.origin === 'camera' ? 'unknown' : settings.gain))
          : settings.gain),
    );
    const conversion = selectedConversion?.conversion;
    if (input.kind !== 'thermal' && (!conversion || !mode.layout)) {
      this.warning.textContent = 'No verified conversion for this mode. Readings unavailable.';
      this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.bounds.textContent = 'Readings unavailable';
      if (this.readouts) this.readouts.textContent = '';
      this.alarmState = null;
      this.onAlarm?.(false);
      return;
    }
    let decoded =
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
    let outsideRange = false;
    if (input.kind !== 'thermal' && selectedConversion) {
      const { minCelsius, maxCelsius } = selectedConversion;
      if (minCelsius !== undefined || maxCelsius !== undefined) {
        const uncertain = decoded.uncertain?.slice() ?? new Uint8Array(decoded.raw.length);
        for (let i = 0; i < celsius.length; i++) {
          const value = celsius[i]!;
          if (
            (minCelsius !== undefined && value < minCelsius) ||
            (maxCelsius !== undefined && value > maxCelsius)
          ) {
            uncertain[i] = 1;
            outsideRange = true;
          }
        }
        if (outsideRange) decoded = { ...decoded, uncertain };
      }
    }
    const frameState =
      input.kind === 'thermal'
        ? input.frame.cameraState
        : input.kind === 'yuyv'
          ? input.cameraState
          : undefined;
    // The camera's readings stay usable; only a correction relative to them is blocked.
    const correctionUnknown = frameState !== undefined && !cameraCorrectionKnown(frameState);
    const analysis = settings.analysis;
    if (analysis && !correctionUnknown) {
      if (input.kind === 'thermal')
        celsius = correctFrame(
          input.frame,
          analysis.correction ?? settingsFromCamera(input.frame.cameraState),
        );
      else if (analysis.correction)
        celsius = celsius.map(
          input.kind === 'yuyv' && input.cameraState
            ? correctionFor(analysis.correction, input.cameraState)
            : temperatureCorrection(analysis.correction),
        );
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
    const readingsWarning = !automatic
      ? 'No certain temperature readings.'
      : expected &&
          (automatic.minCelsius < expected.minCelsius || automatic.maxCelsius > expected.maxCelsius)
        ? 'Data look inconsistent with the declared camera mode. Check gain and factory settings.'
        : outsideRange
          ? 'Readings outside this sensor range are uncertain and excluded from measurements.'
          : '';
    this.warning.textContent = correctionUnknown
      ? [CAMERA_CORRECTION_UNKNOWN, readingsWarning].filter(Boolean).join(' ')
      : readingsWarning;
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
      for (const marker of result.markers) {
        // A marker of the selected object is green, like its shape.
        overlay.strokeStyle =
          marker.object !== undefined && marker.object === analysis.selected ? '#00ff80' : 'white';
        overlay.lineWidth = 1;
        overlay.beginPath();
        overlay.moveTo(marker.x - 3, marker.y);
        overlay.lineTo(marker.x + 3, marker.y);
        overlay.moveTo(marker.x, marker.y - 3);
        overlay.lineTo(marker.x, marker.y + 3);
        overlay.stroke();
      }
    }
    this.present(decoded.width, decoded.height, settings);
    if (result?.markers.length) this.drawLabels(result.markers, image, settings);
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
          (input.kind === 'yuv420' || (input.kind === 'thermal' && thermal.uncertain)
            ? 'reconstructed'
            : 'exact'),
        viewState: {
          palette: settings.palette,
          range: { ...this.range },
          // null: no Host correction and the camera's own is unknown, so nothing to restore.
          correction: analysis?.correction
            ? { ...analysis.correction }
            : correctionUnknown
              ? null
              : { ...settingsFromCamera(thermal.cameraState) },
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
  /**
   * A frame of a mode without temperature data: the camera's picture, oriented
   * as set, with no readings, alarm, photo or recording frame.
   */
  private drawImage(input: Exclude<RawFrame, { kind: 'thermal' }>, settings: ViewSettings) {
    const rgba = input.kind === 'yuyv' ? yuyvToRgba(input) : yuv420ToRgba(input);
    this.source.width = input.width;
    this.source.height = input.height;
    this.source
      .getContext('2d')
      ?.putImageData(new ImageData(rgba, input.width, input.height), 0, 0);
    this.present(input.width, input.height, settings);
    this.warning.textContent = '';
    this.bounds.textContent = 'No temperature data';
    if (this.readouts) this.readouts.textContent = '';
    this.alarmState = null;
    this.onAlarm?.(false);
  }
  /**
   * Writes each marker's temperature on the visible canvas after `present`, so
   * the text stays upright and readable at any rotation and mirroring; shapes
   * and crosses on the source canvas turn with the image.
   */
  private drawLabels(
    markers: Marker[],
    image: { width: number; height: number },
    orientation: Orientation,
  ) {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = '8px sans-serif';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'black';
    ctx.fillStyle = 'white';
    const at = markers.map((m) => orientedPixel(m, image, orientation));
    const taken = at.map(crossRect);
    const labelled = new Set<string>();
    markers.forEach((marker, i) => {
      // The same reading twice on one pixel (the frame's max is an area's max) gets one label.
      const key = `${marker.x},${marker.y},${marker.label}`;
      if (labelled.has(key)) return;
      labelled.add(key);
      const width = Math.ceil(ctx.measureText(marker.label).width);
      const { x, y } = placeLabel(at[i]!, width, this.canvas, taken);
      // Outlined in black so it reads on a hot and a cold background alike.
      ctx.strokeText(marker.label, x, y);
      ctx.fillText(marker.label, x, y);
    });
  }
  /** Draws the source canvas onto the visible one, rotated, mirrored and smoothed as set. */
  private present(width: number, height: number, settings: ViewSettings) {
    const quarter = settings.rotation % 180 !== 0;
    this.canvas.width = quarter ? height : width;
    this.canvas.height = quarter ? width : height;
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = settings.smooth;
      ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
      ctx.rotate((settings.rotation * Math.PI) / 180);
      ctx.scale(settings.mirrorX ? -1 : 1, settings.mirrorY ? -1 : 1);
      ctx.drawImage(this.source, -width / 2, -height / 2);
    }
    this.canvas.style.imageRendering = settings.smooth ? 'auto' : 'pixelated';
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

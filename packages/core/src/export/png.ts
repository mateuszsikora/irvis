import { celsiusImage, checkImage } from '../analysis/image.ts';
import { autoRange, renderPalette } from '../analysis/render.ts';
import type { TemperatureRange } from '../analysis/range.ts';
import type { PaletteId } from '../analysis/palettes.ts';
import { settingsFromCamera, type CorrectionSettings } from '../corrections/emissivity.ts';
import type { ThermalFrame } from '../frames.ts';
import { encodePng } from './png-container.ts';
import { exportSnapshot, type SnapshotOptions } from './snapshot.ts';

export interface PngOptions extends SnapshotOptions {
  /** Default iron. */
  readonly palette?: PaletteId;
  /** Default auto; falls back to 0–1 °C when no certain finite pixel exists. */
  readonly range?: TemperatureRange | 'auto';
  /** Default settingsFromCamera(frame.cameraState). */
  readonly correction?: CorrectionSettings;
}

/** Palette PNG with a complete one-frame .irvis in its private irVs chunk. */
export async function exportPng(frame: ThermalFrame, options: PngOptions): Promise<Uint8Array> {
  const correction = options.correction ?? settingsFromCamera(frame.cameraState);
  const image = celsiusImage(frame, correction);
  checkImage(image);
  const palette = options.palette ?? 'iron';
  const range =
    options.range === undefined || options.range === 'auto'
      ? (autoRange(image) ?? { minCelsius: 0, maxCelsius: 1 })
      : options.range;
  const rgba = renderPalette(image.celsius, range, palette);
  const snapshot = await exportSnapshot(frame, {
    ...options,
    viewState: { ...options.viewState, ...correction, palette, range: { ...range } },
  });
  return encodePng(image.width, image.height, rgba, snapshot);
}

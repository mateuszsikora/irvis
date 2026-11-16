import { PALETTES, rangeProblems, type ViewStateValues } from '@irvis/core';
import { photoCorrection } from './photos.ts';
import type { ViewSettings } from './render.ts';
import type { AnalysisSettings } from './measurements.ts';
/** File metadata is untrusted; restore only validated display values. */
export function recordedView(view: ViewStateValues, fallback: ViewSettings): ViewSettings {
  const config = structuredClone(fallback);
  const palette = PALETTES.find((p) => p.id === view['palette']);
  if (palette) config.palette = palette.id;
  const range = view['range'] as Record<string, unknown> | null;
  if (
    range &&
    typeof range === 'object' &&
    !Array.isArray(range) &&
    typeof range['minCelsius'] === 'number' &&
    typeof range['maxCelsius'] === 'number'
  ) {
    const bounds = { minCelsius: range['minCelsius'], maxCelsius: range['maxCelsius'] };
    if (!rangeProblems(bounds).length) config.range = bounds;
  }
  config.rotation = [0, 90, 180, 270].includes(Number(view['rotation']))
    ? Number(view['rotation'])
    : 0;
  config.mirrorX = view['mirrorX'] === true;
  config.mirrorY = view['mirrorY'] === true;
  const analysis = view['analysis'] as unknown as AnalysisSettings | undefined;
  if (
    analysis &&
    typeof analysis === 'object' &&
    Array.isArray(analysis.objects) &&
    analysis.objects.length < 10000 &&
    analysis.objects.every(
      (object) =>
        object &&
        ['Point', 'Line', 'Area'].includes(object.kind) &&
        [object.id, object.x, object.y, object.x2, object.y2].every(Number.isFinite),
    ) &&
    analysis.tracking &&
    ['min', 'max', 'centre'].every(
      (key) => typeof (analysis.tracking as unknown as Record<string, unknown>)[key] === 'boolean',
    ) &&
    Number.isFinite(analysis.threshold)
  ) {
    config.analysis = {
      ...analysis,
      objects: structuredClone(analysis.objects),
      alarm: false,
      highlight: analysis.highlight === true,
      isotherm: analysis.isotherm === true,
    };
  }
  config.analysis = {
    ...config.analysis!,
    correction: photoCorrection(view),
    unit: view['unit'] === 'F' || view['unit'] === 'K' ? view['unit'] : 'C',
    alarm: false,
  };
  return config;
}

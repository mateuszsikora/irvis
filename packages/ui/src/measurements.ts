import {
  formatTemperature,
  measureArea,
  measureFrame,
  measureLine,
  measurePoint,
  type CelsiusImage,
  type CorrectionSettings,
  type PixelPoint,
  type TemperatureUnit,
} from '@irvis/core';

export interface Measurement {
  id: number;
  kind: 'Point' | 'Line' | 'Area';
  x: number;
  y: number;
  x2: number;
  y2: number;
}
export interface AnalysisSettings {
  objects: Measurement[];
  tracking: { min: boolean; max: boolean; centre: boolean };
  selected: number | null;
  highlight: boolean;
  unit: TemperatureUnit;
  correction: CorrectionSettings | null;
  alarm: boolean;
  threshold: number;
  isotherm: boolean;
}
export const initialAnalysis: AnalysisSettings = {
  objects: [],
  tracking: { min: false, max: false, centre: false },
  selected: null,
  highlight: false,
  unit: 'C',
  correction: null,
  alarm: false,
  threshold: 40,
  isotherm: false,
};
/** Objects use percentages so they remain inside frames of different sizes. */
export function geometry(object: Measurement, image: { width: number; height: number }) {
  const point = (x: number, y: number) => ({
    x: Math.round((x / 100) * (image.width - 1)),
    y: Math.round((y / 100) * (image.height - 1)),
  });
  const from = point(object.x, object.y),
    to = point(object.x2, object.y2);
  return {
    from,
    to,
    area: {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x) + 1,
      height: Math.abs(to.y - from.y) + 1,
    },
  };
}
export function analyze(image: CelsiusImage, settings: AnalysisSettings) {
  const text: string[] = [];
  const markers: (PixelPoint & { label: string })[] = [];
  const format = (v: number) => formatTemperature(v, settings.unit);
  const stats = measureFrame(image);
  for (const key of ['min', 'max'] as const) {
    const reading = stats[key];
    if (settings.tracking[key]) {
      text.push(`${key}: ${format(reading?.celsius ?? NaN)}`);
      if (reading) markers.push({ ...reading, label: key });
    }
  }
  if (settings.tracking.centre) {
    const point = { x: Math.floor(image.width / 2), y: Math.floor(image.height / 2) };
    const reading = measurePoint(image, point);
    text.push(`centre: ${format(reading.centreCounted ? reading.mean : NaN)}`);
    if (reading.centreCounted) markers.push({ ...point, label: 'centre' });
  }
  for (const object of settings.objects) {
    const { from, to, area } = geometry(object, image);
    const label = `${object.kind} ${object.id}`;
    if (object.kind === 'Point') {
      const reading = measurePoint(image, from);
      text.push(`${label}: ${format(reading.centreCounted ? reading.mean : NaN)}`);
      if (reading.centreCounted) markers.push({ ...from, label });
    } else {
      const reading =
        object.kind === 'Line' ? measureLine(image, from, to).stats : measureArea(image, area);
      text.push(
        `${label}: min ${format(reading.min?.celsius ?? NaN)}, max ${format(reading.max?.celsius ?? NaN)}`,
      );
      if (reading.min) markers.push({ ...reading.min, label: `${label} min` });
      if (reading.max) markers.push({ ...reading.max, label: `${label} max` });
    }
  }
  return { text: text.join('\n'), markers };
}

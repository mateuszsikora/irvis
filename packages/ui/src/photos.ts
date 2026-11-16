import { correctionProblems, type CorrectionSettings, type ThermalFrame } from '@irvis/core';

export interface SavedPhoto {
  id: string;
  name: string;
  createdAt: number;
  bytes: Uint8Array;
}
/** The host chooses storage; the shared viewer never selects a persistence backend. */
export interface PhotoLibrary {
  list(): Promise<SavedPhoto[]>;
  save(photo: SavedPhoto): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Match thermal pixels to the displayed rotation and mirrors, without interpolation. */
export function orientPhoto(
  frame: ThermalFrame,
  rotation: number,
  mirrorX: boolean,
  mirrorY: boolean,
): ThermalFrame {
  const quarter = rotation % 180 !== 0;
  const width = quarter ? frame.height : frame.width;
  const height = quarter ? frame.width : frame.height;
  const raw = new Uint16Array(width * height);
  const uncertain = frame.uncertain ? new Uint8Array(raw.length) : null;
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++) {
      const mx = mirrorX ? frame.width - 1 - x : x;
      const my = mirrorY ? frame.height - 1 - y : y;
      const dx =
        rotation === 90
          ? frame.height - 1 - my
          : rotation === 180
            ? frame.width - 1 - mx
            : rotation === 270
              ? my
              : mx;
      const dy =
        rotation === 90
          ? mx
          : rotation === 180
            ? frame.height - 1 - my
            : rotation === 270
              ? frame.width - 1 - mx
              : my;
      const source = y * frame.width + x,
        target = dy * width + dx;
      raw[target] = frame.raw[source]!;
      if (uncertain) uncertain[target] = frame.uncertain![source]!;
    }
  return { ...frame, width, height, raw, uncertain };
}

/** Restore correction metadata, not captured editable objects. */
export function photoCorrection(view: unknown): CorrectionSettings | null {
  if (!view || typeof view !== 'object') return null;
  const candidate = 'correction' in view ? view.correction : view;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    !('emissivity' in candidate) ||
    !('reflectedCelsius' in candidate) ||
    !('offsetKelvin' in candidate)
  )
    return null;
  if (
    typeof candidate.emissivity !== 'number' ||
    typeof candidate.reflectedCelsius !== 'number' ||
    typeof candidate.offsetKelvin !== 'number'
  )
    return null;
  const correction = {
    emissivity: candidate.emissivity,
    reflectedCelsius: candidate.reflectedCelsius,
    offsetKelvin: candidate.offsetKelvin,
  };
  return correctionProblems(correction).length ? null : correction;
}

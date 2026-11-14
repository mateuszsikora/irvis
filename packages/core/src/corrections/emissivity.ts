// Emissivity, reflected temperature and offset. The formula and why:
// docs/decisions/architecture.md#emissivity-is-corrected-with-the-fourth-power-law-and-a-reflected-temperature
// Relative to the camera's own correction, so that it never applies twice:
// docs/decisions/architecture.md#the-software-correction-works-relative-to-what-the-camera-applied
import { toCelsius, toCelsiusArray } from '../cameras/conversion.ts';
import { EMISSIVITY_FIELD, REFLECTED_TEMPERATURE_FIELD } from '../cameras/fields.ts';
import type { CameraStateSnapshot, Conversion } from '../cameras/profile.ts';
import type { ThermalFrame } from '../frames.ts';

/** 0 °C in kelvin. */
export const KELVIN_OFFSET = 273.15;

/** What the user sets: the emissivity of the object, what it reflects, and an offset. */
export interface CorrectionSettings {
  /** Greater than 0 and at most 1; 1 is a black body, for which nothing is reflected. */
  readonly emissivity: number;
  /** °C of the surroundings the object reflects; ignored when `emissivity` is 1. */
  readonly reflectedCelsius: number;
  /** A difference in kelvin added to every reading after the emissivity correction. */
  readonly offsetKelvin: number;
}

/**
 * ε 1, R 20 °C, offset 0: no correction for a camera that applies nothing
 * itself. For a camera that applies its own emissivity, ε 1 undoes it; start
 * from `settingsFromCamera` instead.
 */
export const DEFAULT_CORRECTION: CorrectionSettings = {
  emissivity: 1,
  reflectedCelsius: 20,
  offsetKelvin: 0,
};

/** The emissivity correction a camera has already applied to its raw values. */
export interface CameraCorrection {
  readonly emissivity: number;
  readonly reflectedCelsius: number;
}

/** What `CorrectionSettings` may not hold; empty when they can be used. */
export function correctionProblems(settings: CorrectionSettings): string[] {
  const out: string[] = [];
  if (!(settings.emissivity > 0 && settings.emissivity <= 1)) {
    out.push('emissivity must be greater than 0 and at most 1');
  }
  if (!(settings.reflectedCelsius > -KELVIN_OFFSET && Number.isFinite(settings.reflectedCelsius))) {
    out.push('reflectedCelsius must be a finite number above -273.15');
  }
  if (!Number.isFinite(settings.offsetKelvin)) out.push('offsetKelvin must be a finite number');
  return out;
}

/**
 * The correction the camera applied, from the `emissivity` and
 * `reflected-temperature` values of a camera state (read from the camera,
 * declared by the user, or the profile's defaults), or null when the state
 * has neither and the camera applies none. Throws when the state has only
 * one of them or a value out of range, because readings corrected from it
 * would be wrong without a sign.
 */
export function cameraCorrection(state: CameraStateSnapshot): CameraCorrection | null {
  const emissivity = state.values[EMISSIVITY_FIELD];
  const reflected = state.values[REFLECTED_TEMPERATURE_FIELD];
  if (emissivity === undefined && reflected === undefined) return null;
  if (typeof emissivity !== 'number' || !(emissivity > 0 && emissivity <= 1)) {
    throw new Error(
      `camera state '${EMISSIVITY_FIELD}' must be a number greater than 0 and at most 1`,
    );
  }
  if (
    typeof reflected !== 'number' ||
    !(reflected > -KELVIN_OFFSET && Number.isFinite(reflected))
  ) {
    throw new Error(
      `camera state '${REFLECTED_TEMPERATURE_FIELD}' must be a finite number of °C above -273.15`,
    );
  }
  return { emissivity, reflectedCelsius: reflected };
}

/**
 * Settings that change no reading of frames taken in `state`: the emissivity
 * and reflected temperature the camera applied, copied exactly, or those of
 * `base` when it applies none; the offset of `base`. The starting point for
 * the user's settings.
 */
export function settingsFromCamera(
  state: CameraStateSnapshot,
  base: CorrectionSettings = DEFAULT_CORRECTION,
): CorrectionSettings {
  const camera = cameraCorrection(state);
  return camera ? { ...base, ...camera } : base;
}

function fourth(x: number): number {
  const square = x * x;
  return square * square;
}

/** A reading in °C to the corrected reading in °C. */
export type TemperatureCorrection = (celsius: number) => number;

/**
 * The correction from what the camera reports to what the user's settings
 * give, as a function of one reading in °C. With T in kelvin, the radiation
 * the sensor received is W = ε_c·T_c⁴ + (1 − ε_c)·R_c⁴ for the camera's
 * reading T_c, emissivity ε_c and reflected temperature R_c (ε_c = 1 when the
 * camera applies nothing), and the object's temperature is
 * T⁴ = (W − (1 − ε)·R⁴) / ε for the user's ε and R. The offset is added last.
 *
 * When the camera's ε and R are equal (`===`) to the user's, or both ε are 1,
 * the reading is returned plus the offset, without the fourth power and root,
 * so with offset 0 it keeps its bits. A value that differs in the last bit,
 * such as an R typed in °F and converted back, goes through the formula and
 * differs by about 1e-13 K. In every case a reading at or below 0 K, or NaN,
 * gives NaN, and so does one whose T⁴ comes out at or below 0 (an object
 * colder than its reflection allows): no temperature.
 */
export function temperatureCorrection(
  settings: CorrectionSettings,
  camera: CameraCorrection | null = null,
): TemperatureCorrection {
  const problems = correctionProblems(settings);
  if (problems.length > 0) throw new Error(`invalid correction: ${problems.join('; ')}`);
  const { emissivity, reflectedCelsius, offsetKelvin } = settings;
  const cameraEmissivity = camera?.emissivity ?? 1;
  const cameraReflected = camera?.reflectedCelsius ?? reflectedCelsius;
  if (
    cameraEmissivity === emissivity &&
    (emissivity === 1 || cameraReflected === reflectedCelsius)
  ) {
    return (celsius) => {
      if (!(celsius + KELVIN_OFFSET > 0)) return Number.NaN;
      return offsetKelvin === 0 ? celsius : celsius + offsetKelvin;
    };
  }
  // T⁴ = a·T_c⁴ + b.
  const a = cameraEmissivity / emissivity;
  const b =
    ((1 - cameraEmissivity) * fourth(cameraReflected + KELVIN_OFFSET) -
      (1 - emissivity) * fourth(reflectedCelsius + KELVIN_OFFSET)) /
    emissivity;
  return (celsius) => {
    const kelvin = celsius + KELVIN_OFFSET;
    if (!(kelvin > 0)) return Number.NaN;
    const power = a * fourth(kelvin) + b;
    if (!(power > 0)) return Number.NaN;
    return Math.sqrt(Math.sqrt(power)) - KELVIN_OFFSET + offsetKelvin;
  };
}

/** The correction for frames taken in `state`: `temperatureCorrection` relative to `cameraCorrection(state)`. */
export function correctionFor(
  settings: CorrectionSettings,
  state: CameraStateSnapshot,
): TemperatureCorrection {
  return temperatureCorrection(settings, cameraCorrection(state));
}

/** Corrected °C of one raw value. */
export function correctedCelsius(
  raw: number,
  conversion: Conversion,
  correction: TemperatureCorrection,
): number {
  return correction(toCelsius(raw, conversion));
}

/**
 * Corrected °C of every pixel of a frame, row-major, with the frame's
 * conversion and relative to its camera state. Uncertain pixels are corrected
 * like the others; the caller skips them through `frame.uncertain`.
 */
export function correctFrame(frame: ThermalFrame, settings: CorrectionSettings): Float64Array {
  const correction = correctionFor(settings, frame.cameraState);
  const out = toCelsiusArray(frame.raw, frame.conversion);
  for (let i = 0; i < out.length; i++) out[i] = correction(out[i] ?? Number.NaN);
  return out;
}

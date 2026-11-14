import { describe, expect, it } from 'vitest';
import type { CameraStateSnapshot, Conversion } from '../cameras/profile.ts';
import type { ThermalFrame } from '../frames.ts';
import {
  DEFAULT_CORRECTION,
  KELVIN_OFFSET,
  cameraCorrection,
  correctFrame,
  correctedCelsius,
  correctionFor,
  correctionProblems,
  settingsFromCamera,
  temperatureCorrection,
  type CorrectionSettings,
} from './emissivity.ts';

const conversion: Conversion = { kind: 'linear', scale: 1 / 64, offset: -273.15 };

function settings(changes: Partial<CorrectionSettings>): CorrectionSettings {
  return { ...DEFAULT_CORRECTION, ...changes };
}

/** What a camera that applies (ε, R) itself reports for an object at `celsius`, in float64 without the T⁴ shortcut. */
function cameraReading(celsius: number, emissivity: number, reflected: number): number {
  const t = celsius + KELVIN_OFFSET;
  const r = reflected + KELVIN_OFFSET;
  // What the sensor receives from the object, reported as a black body.
  const received = emissivity * t * t * t * t + (1 - emissivity) * r * r * r * r;
  // The camera then solves for the object with its own ε and R.
  const object = (received - (1 - emissivity) * r * r * r * r) / emissivity;
  return Math.sqrt(Math.sqrt(object)) - KELVIN_OFFSET;
}

/** What a sensor without any correction reports for an object at `celsius` that reflects `reflected`. */
function blackBodyReading(celsius: number, emissivity: number, reflected: number): number {
  const t = celsius + KELVIN_OFFSET;
  const r = reflected + KELVIN_OFFSET;
  return (
    Math.sqrt(Math.sqrt(emissivity * t * t * t * t + (1 - emissivity) * r * r * r * r)) -
    KELVIN_OFFSET
  );
}

describe('temperatureCorrection', () => {
  it('returns the reading unchanged with the default settings', () => {
    const correct = temperatureCorrection(DEFAULT_CORRECTION);
    for (const c of [-40, -0.015625, 0, -0, 21.34375, 36.6, 400, Number.NaN]) {
      expect(correct(c)).toBe(c);
    }
  });

  it('gives no temperature at or below 0 K on the path without the formula too', () => {
    const correct = temperatureCorrection(settings({ offsetKelvin: 1 }));
    expect(correct(-KELVIN_OFFSET)).toBeNaN();
    expect(correct(-300)).toBeNaN();
    expect(correct(-273)).toBeCloseTo(-272, 12);
  });

  it('corrects for another reflection at the same emissivity as the camera', () => {
    // a = 1, b = 0.1 · (293.15⁴ − 313.15⁴) / 0.9: the camera assumed 20 °C, the object reflects 40 °C.
    const camera = { emissivity: 0.9, reflectedCelsius: 20 };
    const correct = temperatureCorrection(
      settings({ emissivity: 0.9, reflectedCelsius: 40 }),
      camera,
    );
    const fromRaw = temperatureCorrection(settings({ emissivity: 0.9, reflectedCelsius: 40 }));
    for (const object of [10, 36.6, 80]) {
      const reported = cameraReading(object, 0.9, 20);
      expect(correct(reported)).toBeCloseTo(fromRaw(blackBodyReading(object, 0.9, 20)), 9);
    }
    expect(correct(60)).toBeLessThan(60);
  });

  it('recovers the object temperature from a black-body reading', () => {
    for (const [emissivity, reflected, object] of [
      [0.95, 20, 36.5],
      [0.9, 20, 60],
      [0.5, 10, 120],
      [0.2, 25, 300],
    ] as const) {
      const correct = temperatureCorrection(settings({ emissivity, reflectedCelsius: reflected }));
      expect(correct(blackBodyReading(object, emissivity, reflected))).toBeCloseTo(object, 9);
    }
  });

  it('raises a reading above its reflection and lowers one below it', () => {
    const correct = temperatureCorrection(settings({ emissivity: 0.9, reflectedCelsius: 20 }));
    expect(correct(40)).toBeGreaterThan(40);
    expect(correct(0)).toBeLessThan(0);
    expect(correct(20)).toBeCloseTo(20, 12);
  });

  it('computes known values with the fourth power and root', () => {
    // (333.15⁴ − 0.05 · 293.15⁴) / 0.95, fourth root, − 273.15: 61.7418 °C.
    const correct = temperatureCorrection(settings({ emissivity: 0.95, reflectedCelsius: 20 }));
    expect(correct(60)).toBeCloseTo(61.7418, 4);
    expect(correct(35)).toBeCloseTo(35.7311, 4);
  });

  it('adds the offset after the emissivity correction', () => {
    const plain = temperatureCorrection(settings({ emissivity: 0.9 }));
    const shifted = temperatureCorrection(settings({ emissivity: 0.9, offsetKelvin: -1.5 }));
    expect(shifted(50)).toBe(plain(50) - 1.5);
    expect(temperatureCorrection(settings({ offsetKelvin: 2 }))(30)).toBe(32);
  });

  it('gives no temperature at or below 0 K, or below what the reflection allows', () => {
    const correct = temperatureCorrection(settings({ emissivity: 0.1, reflectedCelsius: 100 }));
    expect(correct(-KELVIN_OFFSET)).toBeNaN();
    expect(correct(-300)).toBeNaN();
    expect(correct(Number.NaN)).toBeNaN();
    // 0.9 · 373.15⁴ / 0.1 is far above 273.15⁴ / 0.1.
    expect(correct(0)).toBeNaN();
  });

  it('rejects settings outside their ranges', () => {
    expect(
      correctionProblems({ emissivity: 0, reflectedCelsius: -273.15, offsetKelvin: Infinity }),
    ).toEqual([
      'emissivity must be greater than 0 and at most 1',
      'reflectedCelsius must be a finite number above -273.15',
      'offsetKelvin must be a finite number',
    ]);
    expect(correctionProblems(settings({ emissivity: 1.01 }))).toEqual([
      'emissivity must be greater than 0 and at most 1',
    ]);
    expect(correctionProblems(settings({ emissivity: Number.NaN }))).toHaveLength(1);
    expect(correctionProblems(settings({ reflectedCelsius: Infinity }))).toHaveLength(1);
    expect(() => temperatureCorrection(settings({ emissivity: 0 }))).toThrow(
      'invalid correction: emissivity must be greater than 0 and at most 1',
    );
  });
});

describe('camera correction', () => {
  const applied: CameraStateSnapshot = {
    origin: 'camera',
    values: { gain: 'high', emissivity: 0.95, 'reflected-temperature': 25 },
  };

  it('reads what the camera applied from its state', () => {
    expect(cameraCorrection(applied)).toEqual({ emissivity: 0.95, reflectedCelsius: 25 });
    expect(cameraCorrection({ origin: 'assumed', values: { gain: 'high' } })).toBeNull();
  });

  it('rejects a camera state with only one of the fields or a value out of range', () => {
    expect(() => cameraCorrection({ origin: 'declared', values: { emissivity: 0.9 } })).toThrow(
      "camera state 'reflected-temperature' must be a finite number of °C above -273.15",
    );
    expect(() =>
      cameraCorrection({ origin: 'declared', values: { 'reflected-temperature': 20 } }),
    ).toThrow("camera state 'emissivity' must be a number greater than 0 and at most 1");
    expect(() =>
      cameraCorrection({
        origin: 'camera',
        values: { emissivity: '0.9', 'reflected-temperature': 20 },
      }),
    ).toThrow("camera state 'emissivity' must be a number greater than 0 and at most 1");
  });

  it('starts the settings from what the camera applied', () => {
    expect(settingsFromCamera(applied)).toEqual({
      emissivity: 0.95,
      reflectedCelsius: 25,
      offsetKelvin: 0,
    });
    expect(settingsFromCamera(applied, settings({ emissivity: 0.5, offsetKelvin: 1 }))).toEqual({
      emissivity: 0.95,
      reflectedCelsius: 25,
      offsetKelvin: 1,
    });
    const none = { origin: 'assumed' as const, values: {} };
    expect(settingsFromCamera(none)).toBe(DEFAULT_CORRECTION);
    // The default settings undo a camera's own correction; settings from the camera do not.
    expect(correctionFor(DEFAULT_CORRECTION, applied)(36.6)).not.toBe(36.6);
    expect(correctionFor(settingsFromCamera(applied), applied)(36.6)).toBe(36.6);
  });

  it('changes nothing when the settings equal what the camera applied', () => {
    const correct = correctionFor(settings({ emissivity: 0.95, reflectedCelsius: 25 }), applied);
    for (const c of [-10, 0, 36.6, 250.015625]) expect(correct(c)).toBe(c);
  });

  it('never applies emissivity twice', () => {
    // Objects seen by a camera that applies ε = 0.95 and R = 25 °C itself.
    for (const object of [-20, 5, 36.6, 80, 250]) {
      const reported = cameraReading(object, 0.95, 25);
      const same = correctionFor(settings({ emissivity: 0.95, reflectedCelsius: 25 }), applied);
      expect(same(reported)).toBe(reported);
      expect(same(reported)).toBeCloseTo(object, 9);
      // Undoing the camera's correction gives what a sensor without it reports.
      const blackBody = correctionFor(settings({ emissivity: 1 }), applied);
      expect(blackBody(reported)).toBeCloseTo(blackBodyReading(object, 0.95, 25), 9);
      // Another ε corrected from the camera's reading equals that ε corrected from the
      // uncorrected reading.
      const fromCamera = correctionFor(
        settings({ emissivity: 0.8, reflectedCelsius: 15 }),
        applied,
      );
      const fromRaw = temperatureCorrection(settings({ emissivity: 0.8, reflectedCelsius: 15 }));
      expect(fromCamera(reported)).toBeCloseTo(fromRaw(blackBodyReading(object, 0.95, 25)), 9);
    }
  });
});

describe('correctFrame', () => {
  const raw = Uint16Array.from([0, 18_726, 19_000, 21_376, 65_535]);
  const frame = (cameraState: CameraStateSnapshot): ThermalFrame => ({
    width: 5,
    height: 1,
    timestamp: 0,
    raw,
    conversion,
    cameraState,
    uncertain: null,
  });

  it('converts and corrects every pixel relative to the frame camera state', () => {
    const corrected = correctFrame(
      frame({ origin: 'assumed', values: {} }),
      settings({ emissivity: 0.9, reflectedCelsius: 20, offsetKelvin: 0.5 }),
    );
    const correct = temperatureCorrection(
      settings({ emissivity: 0.9, reflectedCelsius: 20, offsetKelvin: 0.5 }),
    );
    expect(Array.from(corrected)).toEqual(Array.from(raw, (r) => correct(r * (1 / 64) - 273.15)));
    expect(corrected[0]).toBeNaN();
    expect(correctedCelsius(21_376, conversion, correct)).toBe(corrected[3]);
  });

  it('leaves the readings of a camera that applied the same settings unchanged', () => {
    const state: CameraStateSnapshot = {
      origin: 'camera',
      values: { emissivity: 0.9, 'reflected-temperature': 20 },
    };
    const corrected = correctFrame(frame(state), settings({ emissivity: 0.9 }));
    // Raw 0 is 0 K: no temperature, on this path as on the formula's.
    expect(Array.from(corrected)).toEqual(
      Array.from(raw, (r) => (r === 0 ? Number.NaN : r / 64 - 273.15)),
    );
  });
});

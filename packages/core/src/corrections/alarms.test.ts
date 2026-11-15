import { describe, expect, it } from 'vitest';
import { DEFAULT_ALARMS, alarmProblems, evaluateAlarms, type AlarmSettings } from './alarms.ts';

function alarms(changes: Partial<AlarmSettings>): AlarmSettings {
  return { ...DEFAULT_ALARMS, ...changes };
}

describe('evaluateAlarms', () => {
  const frame = Float64Array.from([20, 21, 64, 22, 18.5, 60]);

  it('turns on when a pixel reaches a threshold, bounds included', () => {
    const state = evaluateAlarms(frame, null, alarms({ highCelsius: 60, lowCelsius: 18.5 }));
    expect(state.high).toEqual({ active: true, pixels: 2, extreme: 64, index: 2 });
    expect(state.low).toEqual({ active: true, pixels: 1, extreme: 18.5, index: 4 });
    const quiet = evaluateAlarms(frame, null, alarms({ highCelsius: 64.5, lowCelsius: 18 }));
    expect(quiet.high).toEqual({ active: false, pixels: 0, extreme: 64, index: 2 });
    expect(quiet.low).toEqual({ active: false, pixels: 0, extreme: 18.5, index: 4 });
  });

  it('stays off when the settings turn it off', () => {
    const state = evaluateAlarms(frame, null, DEFAULT_ALARMS);
    expect(state.high.active).toBe(false);
    expect(state.high.pixels).toBe(0);
    expect(state.low.active).toBe(false);
    expect(state.high.extreme).toBe(64);
  });

  it('never turns on for uncertain pixels or pixels without a temperature', () => {
    const values = Float64Array.from([20, 400, Number.NaN, -50, 21]);
    const uncertain = Uint8Array.from([0, 1, 0, 1, 0]);
    const state = evaluateAlarms(values, uncertain, alarms({ highCelsius: 100, lowCelsius: 0 }));
    expect(state.high).toEqual({ active: false, pixels: 0, extreme: 21, index: 4 });
    expect(state.low).toEqual({ active: false, pixels: 0, extreme: 20, index: 0 });
    // A pixel without a temperature compares false with every threshold, so the mask decides.
    const empty = evaluateAlarms(
      Float64Array.from([Number.NaN, 500]),
      Uint8Array.from([0, 1]),
      alarms({ highCelsius: 0, lowCelsius: 1000 }),
    );
    expect(empty.high).toEqual({ active: false, pixels: 0, extreme: Number.NaN, index: -1 });
    expect(empty.low).toEqual({ active: false, pixels: 0, extreme: Number.NaN, index: -1 });
    // ±Infinity has no temperature either, as in the measurements of src/analysis/.
    const infinite = evaluateAlarms(
      Float64Array.from([20, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 30]),
      null,
      alarms({ highCelsius: 50, lowCelsius: 0 }),
    );
    expect(infinite.high).toEqual({ active: false, pixels: 0, extreme: 30, index: 3 });
    expect(infinite.low).toEqual({ active: false, pixels: 0, extreme: 20, index: 0 });
  });

  it('stays on within the hysteresis', () => {
    const settings = alarms({ highCelsius: 50, lowCelsius: 0, hysteresis: 0.5 });
    const on = evaluateAlarms(Float64Array.from([50.2, 0]), null, settings);
    expect(on.high.active && on.low.active).toBe(true);
    const near = evaluateAlarms(Float64Array.from([49.5, 0.5]), null, settings, on);
    expect(near.high).toEqual({ active: true, pixels: 0, extreme: 49.5, index: 0 });
    expect(near.low).toEqual({ active: true, pixels: 0, extreme: 0.5, index: 1 });
    const off = evaluateAlarms(Float64Array.from([49.4, 0.6]), null, settings, near);
    expect(off.high.active).toBe(false);
    expect(off.low.active).toBe(false);
    // Off again, the same readings do not switch it on: only the threshold does.
    expect(evaluateAlarms(Float64Array.from([49.5, 0.5]), null, settings, off).high.active).toBe(
      false,
    );
  });

  it('turns off when no pixel counts any more', () => {
    const settings = alarms({ highCelsius: 50, lowCelsius: 0 });
    const on = evaluateAlarms(Float64Array.from([60, -5]), null, settings);
    expect(on.high.active && on.low.active).toBe(true);
    const unknown = evaluateAlarms(
      Float64Array.from([60, -5]),
      Uint8Array.from([1, 1]),
      settings,
      on,
    );
    expect(unknown.high).toEqual({ active: false, pixels: 0, extreme: Number.NaN, index: -1 });
    expect(unknown.low).toEqual({ active: false, pixels: 0, extreme: Number.NaN, index: -1 });
  });

  it('rejects invalid settings and a mask of another size', () => {
    expect(
      alarmProblems({ highCelsius: Number.NaN, lowCelsius: Infinity, hysteresis: -1 }),
    ).toEqual([
      'highCelsius must be a finite number or null',
      'lowCelsius must be a finite number or null',
      'hysteresis must be a finite number of at least 0',
    ]);
    expect(() => evaluateAlarms(frame, null, alarms({ hysteresis: Number.NaN }))).toThrow(
      'invalid alarm settings: hysteresis must be a finite number of at least 0',
    );
    expect(() => evaluateAlarms(frame, new Uint8Array(5), DEFAULT_ALARMS)).toThrow(
      'uncertain mask has 5 values, expected 6',
    );
  });
});

// Threshold alarms on corrected temperatures. Uncertain pixels and pixels
// without a temperature never turn one on:
// docs/decisions/architecture.md#alarms-and-isotherms-skip-uncertain-pixels

/** Thresholds in °C of corrected readings; null disables that alarm. */
export interface AlarmSettings {
  /** Turns on when a pixel is at or above it. */
  readonly highCelsius: number | null;
  /** Turns on when a pixel is at or below it. */
  readonly lowCelsius: number | null;
  /**
   * Kelvin by which the hottest (coldest) pixel has to fall below (rise above)
   * the threshold before an alarm that is on turns off, so that noise around
   * the threshold does not switch it every frame. At least 0.
   */
  readonly hysteresis: number;
}

/** Both alarms off. */
export const DEFAULT_ALARMS: AlarmSettings = {
  highCelsius: null,
  lowCelsius: null,
  hysteresis: 0.5,
};

/** One alarm in one frame. */
export interface AlarmLevel {
  /** The alarm is on. */
  readonly active: boolean;
  /** Pixels at or beyond the threshold; 0 when the alarm is off in the settings. */
  readonly pixels: number;
  /** The hottest (for `high`) or coldest (for `low`) pixel that counts, in °C; NaN when none counts. */
  readonly extreme: number;
  /** Row-major index of the first pixel at `extreme`; −1 when none counts. */
  readonly index: number;
}

/** Both alarms in one frame. Pass it back as `previous` with the next frame. */
export interface AlarmState {
  readonly high: AlarmLevel;
  readonly low: AlarmLevel;
}

/** What `AlarmSettings` may not hold; empty when they can be used. */
export function alarmProblems(settings: AlarmSettings): string[] {
  const out: string[] = [];
  for (const [name, value] of [
    ['highCelsius', settings.highCelsius],
    ['lowCelsius', settings.lowCelsius],
  ] as const) {
    if (value !== null && !Number.isFinite(value)) {
      out.push(`${name} must be a finite number or null`);
    }
  }
  if (!(settings.hysteresis >= 0 && Number.isFinite(settings.hysteresis))) {
    out.push('hysteresis must be a finite number of at least 0');
  }
  return out;
}

/**
 * The alarms for one frame of corrected readings (`correctFrame`). Pixels
 * whose `uncertain` value is not 0, and readings that are NaN, are skipped.
 * An alarm turns on when at least one pixel reaches its threshold. An alarm
 * that was on in `previous` stays on until the extreme pixel is more than
 * `hysteresis` past the threshold on the other side, or no pixel counts.
 */
export function evaluateAlarms(
  celsius: Float64Array,
  uncertain: Uint8Array | null,
  settings: AlarmSettings,
  previous: AlarmState | null = null,
): AlarmState {
  const problems = alarmProblems(settings);
  if (problems.length > 0) throw new Error(`invalid alarm settings: ${problems.join('; ')}`);
  if (uncertain && uncertain.length !== celsius.length) {
    throw new Error(
      `uncertain mask has ${String(uncertain.length)} values, expected ${String(celsius.length)}`,
    );
  }
  const { highCelsius: high, lowCelsius: low, hysteresis } = settings;
  let hottest = Number.NaN;
  let hottestAt = -1;
  let coldest = Number.NaN;
  let coldestAt = -1;
  let above = 0;
  let below = 0;
  for (let i = 0; i < celsius.length; i++) {
    if (uncertain && uncertain[i] !== 0) continue;
    const value = celsius[i] ?? Number.NaN;
    if (Number.isNaN(value)) continue;
    if (hottestAt < 0 || value > hottest) {
      hottest = value;
      hottestAt = i;
    }
    if (coldestAt < 0 || value < coldest) {
      coldest = value;
      coldestAt = i;
    }
    if (high !== null && value >= high) above++;
    if (low !== null && value <= low) below++;
  }
  const highOn =
    high !== null &&
    (above > 0 ||
      (previous?.high.active === true && hottestAt >= 0 && hottest >= high - hysteresis));
  const lowOn =
    low !== null &&
    (below > 0 || (previous?.low.active === true && coldestAt >= 0 && coldest <= low + hysteresis));
  return {
    high: { active: highOn, pixels: above, extreme: hottest, index: hottestAt },
    low: { active: lowOn, pixels: below, extreme: coldest, index: coldestAt },
  };
}

// Temperature units. Readings stay in °C everywhere in core; these functions
// convert at the edge, for display and for values the user types. Only +, -,
// * and /, so every engine gives the same bits:
// docs/decisions/architecture.md#measurement-code-uses-only-correctly-rounded-arithmetic

/** `C`: degrees Celsius. `F`: degrees Fahrenheit. `K`: kelvin. */
export type TemperatureUnit = 'C' | 'F' | 'K';

/** Every unit, in the order a settings menu lists them. */
export const TEMPERATURE_UNITS: readonly TemperatureUnit[] = ['C', 'F', 'K'];

/** The symbol shown after a value: `°C`, `°F` or `K`. */
export function unitSymbol(unit: TemperatureUnit): string {
  return unit === 'K' ? 'K' : unit === 'C' ? '°C' : '°F';
}

/** A temperature in °C, in `unit`. °F = °C × 9 / 5 + 32; K = °C + 273.15. */
export function celsiusToUnit(celsius: number, unit: TemperatureUnit): number {
  return unit === 'K' ? celsius + 273.15 : unit === 'C' ? celsius : (celsius * 9) / 5 + 32;
}

/** A temperature in `unit`, in °C. °C = (°F − 32) × 5 / 9; °C = K − 273.15. */
export function unitToCelsius(value: number, unit: TemperatureUnit): number {
  return unit === 'K' ? value - 273.15 : unit === 'C' ? value : ((value - 32) * 5) / 9;
}

/** A temperature difference (an offset, a hysteresis) in kelvin, in `unit`: × 9 / 5 for °F. */
export function celsiusDeltaToUnit(delta: number, unit: TemperatureUnit): number {
  return unit !== 'F' ? delta : (delta * 9) / 5;
}

/** A temperature difference in `unit`, in kelvin: × 5 / 9 for °F. */
export function unitDeltaToCelsius(delta: number, unit: TemperatureUnit): number {
  return unit !== 'F' ? delta : (delta * 5) / 9;
}

/**
 * A temperature in °C as text in `unit`, with `digits` decimals (0 to 3,
 * default 1) and the unit's symbol: `36.6 °C`, `97.9 °F`. `toFixed` is exactly
 * specified, so the text is the same in every engine. A value that is not
 * finite, such as the NaN of a pixel without a temperature, is `–`.
 */
export function formatTemperature(celsius: number, unit: TemperatureUnit, digits = 1): string {
  if (!Number.isInteger(digits) || digits < 0 || digits > 3) {
    throw new Error(`digits must be an integer from 0 to 3, not ${String(digits)}`);
  }
  if (!Number.isFinite(celsius)) return '–';
  const text = celsiusToUnit(celsius, unit).toFixed(digits);
  // -0.04 rounds to "-0.0"; a reading of zero has no sign.
  const unsigned = /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
  return `${unsigned} ${unitSymbol(unit)}`;
}

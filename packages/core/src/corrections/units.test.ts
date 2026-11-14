import { describe, expect, it } from 'vitest';
import {
  TEMPERATURE_UNITS,
  celsiusDeltaToUnit,
  celsiusToUnit,
  formatTemperature,
  unitDeltaToCelsius,
  unitSymbol,
  unitToCelsius,
} from './units.ts';

describe('temperature units', () => {
  it('convert between °C and °F', () => {
    expect(TEMPERATURE_UNITS).toEqual(['C', 'F']);
    expect([-40, 0, 37, 100].map((c) => celsiusToUnit(c, 'F'))).toEqual([-40, 32, 98.6, 212]);
    expect([-40, 32, 98.6, 212].map((f) => unitToCelsius(f, 'F'))).toEqual([-40, 0, 37, 100]);
    expect(celsiusToUnit(21.3, 'C')).toBe(21.3);
    expect(unitToCelsius(21.3, 'C')).toBe(21.3);
  });

  it('convert differences without the 32° shift', () => {
    expect(celsiusDeltaToUnit(0.5, 'F')).toBe(0.9);
    expect(unitDeltaToCelsius(9, 'F')).toBe(5);
    expect(celsiusDeltaToUnit(-1.5, 'C')).toBe(-1.5);
    expect(unitDeltaToCelsius(-1.5, 'C')).toBe(-1.5);
  });

  it('format readings with their symbol', () => {
    expect(unitSymbol('C')).toBe('°C');
    expect(unitSymbol('F')).toBe('°F');
    expect(formatTemperature(36.64, 'C')).toBe('36.6 °C');
    expect(formatTemperature(37, 'F')).toBe('98.6 °F');
    expect(formatTemperature(-0.04, 'C')).toBe('0.0 °C');
    expect(formatTemperature(-0.4, 'C', 0)).toBe('0 °C');
    expect(formatTemperature(-12.346, 'C', 2)).toBe('-12.35 °C');
    expect(formatTemperature(Number.NaN, 'F')).toBe('–');
    expect(() => formatTemperature(20, 'C', 4)).toThrow(
      'digits must be an integer from 0 to 3, not 4',
    );
  });
});

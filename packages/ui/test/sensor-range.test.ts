import { describe, expect, it } from 'vitest';
import { SensorRangePolicy } from '../src/sensor-range.ts';

describe('SensorRangePolicy', () => {
  it('requires settling and consecutive threshold crossings in both directions', () => {
    for (const [gain, maximum, expected] of [
      ['high', 161, 'gain-low'],
      ['low', 149, 'gain-high'],
    ] as const) {
      const policy = new SensorRangePolicy();
      for (let i = 0; i < 199; i++) expect(policy.observe(gain, maximum)).toBeNull();
      expect(policy.observe(gain, maximum)).toBe(expected);
      expect(policy.observe(gain, maximum)).toBeNull();
    }
  });
  it('rejects isolated peaks, boundary readings and unknown state', () => {
    const policy = new SensorRangePolicy();
    for (let i = 0; i < 199; i++) policy.observe('high', 161);
    expect(policy.observe('high', 160)).toBeNull();
    for (let i = 0; i < 99; i++) expect(policy.observe('high', 161)).toBeNull();
    expect(policy.observe('unknown', 161)).toBeNull();
    for (let i = 0; i < 199; i++) expect(policy.observe('high', 161)).toBeNull();
    expect(policy.observe('high', NaN)).toBeNull();
    policy.reset();
    for (let i = 0; i < 200; i++) expect(policy.observe('low', 150)).toBeNull();
  });
});

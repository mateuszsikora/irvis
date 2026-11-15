import { describe, expect, it } from 'vitest';
import type { YuyvFrame } from '../../frames.ts';
import { decodeThermalFrame } from '../../yuyv.ts';
import { toCelsius } from '../conversion.ts';
import { findProfile, matchProfiles } from '../index.ts';
import { validateProfile } from '../validate.ts';
import { profile } from './profile.ts';

describe('infiray-p2pro profile', () => {
  it('is registered and valid', () => {
    expect(findProfile('infiray-p2pro')).toBe(profile);
    expect(validateProfile(profile)).toEqual([]);
  });

  it('matches the Realtek USB IDs', () => {
    expect(matchProfiles({ vendorId: 0x0bda, productId: 0x5830 })).toEqual([profile]);
    expect(matchProfiles({ vendorId: 0x0bda, productId: 0x5840 })).toEqual([profile]);
  });

  it('decodes a synthetic 256x384 frame to temperatures', () => {
    const mode = profile.videoModes.find((m) => m.id === 'yuyv-256x384');
    const conversion = profile.conversions[0]?.conversion;
    if (mode === undefined || conversion === undefined) throw new Error('profile changed');
    expect(mode.width * mode.height * 2).toBe(196608);
    // Image rows grey, thermal rows 22.5 °C everywhere except 35 °C in the centre.
    const data = new Uint8Array(196608).fill(128);
    const raw22 = Math.round((22.5 + 273.15) * 64);
    const raw35 = Math.round((35 + 273.15) * 64);
    for (let i = 0; i < 256 * 192; i++) {
      const value = i === 96 * 256 + 128 ? raw35 : raw22;
      data[256 * 192 * 2 + i * 2] = value & 0xff;
      data[256 * 192 * 2 + i * 2 + 1] = value >> 8;
    }
    const frame: YuyvFrame = { kind: 'yuyv', width: 256, height: 384, data, timestamp: 0 };
    const thermal = decodeThermalFrame(frame, mode, conversion, { origin: 'assumed', values: {} });
    expect(thermal.width).toBe(256);
    expect(thermal.height).toBe(192);
    expect(toCelsius(thermal.raw[0] ?? 0, conversion)).toBeCloseTo(22.5, 1);
    expect(toCelsius(thermal.raw[96 * 256 + 128] ?? 0, conversion)).toBeCloseTo(35, 1);
  });
});

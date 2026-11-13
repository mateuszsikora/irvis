import { describe, expect, it } from 'vitest';
import { testProfile } from '../../test/profiles.ts';
import { cameraProfiles, findProfile, matchProfiles, validateProfile } from './index.ts';

describe('camera registry', () => {
  it('holds only valid profiles', () => {
    for (const profile of cameraProfiles) {
      expect(validateProfile(profile), profile.id).toEqual([]);
    }
  });

  it('has unique profile ids', () => {
    const ids = cameraProfiles.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('findProfile', () => {
  it('finds a profile by id', () => {
    const profile = testProfile();
    expect(findProfile('test-camera', [profile])).toBe(profile);
    expect(findProfile('other', [profile])).toBeUndefined();
  });
});

describe('matchProfiles', () => {
  const usb = [{ vendorId: 0x0bda, productId: 0x5830 }];
  const t7 = testProfile({ id: 't7', identification: { usb, labelPattern: '^USB Camera$' } });
  const tc001 = testProfile({ id: 'tc001', identification: { usb, labelPattern: 'TC001' } });
  const other = testProfile({
    id: 'other',
    identification: { usb: [{ vendorId: 1, productId: 2 }] },
  });
  const all = [t7, tc001, other];

  it('matches by USB ID', () => {
    expect(matchProfiles({ vendorId: 1, productId: 2 }, all)).toEqual([other]);
  });

  it('narrows a shared USB ID by the label', () => {
    expect(matchProfiles({ ...usb[0], label: 'TOPDON TC001' }, all)).toEqual([tc001]);
  });

  it('leaves the choice to the user when the label does not decide', () => {
    expect(matchProfiles({ ...usb[0], label: 'Thermal' }, all)).toEqual([t7, tc001]);
  });

  it('matches by label alone when there are no USB IDs', () => {
    expect(matchProfiles({ label: 'usb camera' }, all)).toEqual([t7]);
  });

  it('matches nothing without USB IDs or a label', () => {
    expect(matchProfiles({}, all)).toEqual([]);
  });
});

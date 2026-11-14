import { describe, expect, it } from 'vitest';
import {
  buildLut,
  findPalette,
  PALETTE_IDS,
  PALETTES,
  paletteLut,
  stopsProblems,
  type PaletteStop,
} from './palettes.ts';

function luminance(lut: Uint8Array, i: number): number {
  return (
    0.2126 * (lut[i * 3] ?? 0) + 0.7152 * (lut[i * 3 + 1] ?? 0) + 0.0722 * (lut[i * 3 + 2] ?? 0)
  );
}

describe('palettes', () => {
  it('are the six of the feature list, each with 256 colours', () => {
    expect(PALETTE_IDS).toEqual([
      'iron',
      'white-hot',
      'black-hot',
      'rainbow',
      'red-hot',
      'cold-blue',
    ]);
    expect(PALETTES.map((p) => p.name)).toEqual([
      'Iron',
      'White Hot',
      'Black Hot',
      'Rainbow',
      'Red Hot',
      'Cold Blue',
    ]);
    for (const id of PALETTE_IDS) {
      expect(paletteLut(id)).toHaveLength(768);
      expect(stopsProblems(findPalette(id).stops)).toEqual([]);
    }
  });

  it('start and end at their first and last stop', () => {
    for (const palette of PALETTES) {
      const lut = paletteLut(palette.id);
      const first = palette.stops[0]?.color;
      const last = palette.stops[palette.stops.length - 1]?.color;
      expect(Array.from(lut.subarray(0, 3))).toEqual(first);
      expect(Array.from(lut.subarray(765, 768))).toEqual(last);
      for (const s of palette.stops) {
        expect(Array.from(lut.subarray(s.index * 3, s.index * 3 + 3))).toEqual(s.color);
      }
    }
  });

  it('make white hot a grey ramp and black hot its reverse', () => {
    const white = paletteLut('white-hot');
    const black = paletteLut('black-hot');
    for (let i = 0; i < 256; i++) {
      expect([white[i * 3], white[i * 3 + 1], white[i * 3 + 2]]).toEqual([i, i, i]);
      expect([black[i * 3], black[i * 3 + 1], black[i * 3 + 2]]).toEqual([
        255 - i,
        255 - i,
        255 - i,
      ]);
    }
  });

  it('get brighter towards hot, except black hot and rainbow', () => {
    for (const id of ['iron', 'white-hot', 'red-hot', 'cold-blue'] as const) {
      const lut = paletteLut(id);
      for (let i = 1; i < 256; i++)
        expect(luminance(lut, i)).toBeGreaterThanOrEqual(luminance(lut, i - 1));
    }
    const black = paletteLut('black-hot');
    for (let i = 1; i < 256; i++) expect(luminance(black, i)).toBeLessThan(luminance(black, i - 1));
  });

  it('are built with the same bytes every time', () => {
    // A hash of all six tables: a change to a stop or to the interpolation
    // changes it, so the parity test (#21) never meets an unexpected colour.
    let hash = 0x811c9dc5;
    for (const id of PALETTE_IDS) {
      for (const byte of paletteLut(id)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    }
    expect(hash.toString(16)).toBe('7c4558a4');
    expect(Array.from(paletteLut('iron').subarray(64 * 3, 64 * 3 + 3))).toEqual([80, 0, 136]);
  });

  it('return a copy that does not change the palette', () => {
    const lut = paletteLut('iron');
    lut.fill(1);
    expect(paletteLut('iron')[765]).toBe(255);
  });

  it('interpolate between stops and round halves up', () => {
    const lut = buildLut([
      { index: 0, color: [0, 0, 0] },
      { index: 2, color: [1, 255, 3] },
      { index: 255, color: [255, 255, 255] },
    ]);
    expect(Array.from(lut.subarray(0, 9))).toEqual([0, 0, 0, 1, 128, 2, 1, 255, 3]);
  });

  it('reject stops that do not cover 0 to 255 in rising order', () => {
    const ok: PaletteStop[] = [
      { index: 0, color: [0, 0, 0] },
      { index: 255, color: [1, 1, 1] },
    ];
    expect(stopsProblems(ok)).toEqual([]);
    expect(stopsProblems(ok.slice(0, 1))).toEqual(['a palette needs at least two stops']);
    expect(
      stopsProblems([
        { index: 1, color: [0, 0, 0] },
        { index: 254, color: [1, 1, 1] },
      ]),
    ).toEqual(['the first stop must be at index 0', 'the last stop must be at index 255']);
    expect(
      stopsProblems([
        { index: 0, color: [0, 0, 0] },
        { index: 100, color: [0, 0, 0] },
        { index: 100, color: [0, 0, 0] },
        { index: 255, color: [256, 0, 0] },
      ]),
    ).toEqual([
      'stop indexes must be integers that rise',
      'every stop color must be three integers from 0 to 255',
    ]);
    expect(() => buildLut(ok.slice(0, 1))).toThrow(
      'invalid palette stops: a palette needs at least two stops',
    );
    expect(() => findPalette('sepia' as 'iron')).toThrow("unknown palette 'sepia'");
    expect(() => paletteLut('sepia' as 'iron')).toThrow("unknown palette 'sepia'");
  });
});

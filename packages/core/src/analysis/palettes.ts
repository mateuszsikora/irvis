// The six palettes as 256-entry RGB lookup tables, built from colour stops
// with integer arithmetic and Math.round, so every engine builds the same
// bytes: docs/decisions/architecture.md#palettes-are-256-colour-ramps-defined-by-stops

/** The palettes, in the order the viewer lists them. */
export const PALETTE_IDS = [
  'iron',
  'white-hot',
  'black-hot',
  'rainbow',
  'red-hot',
  'cold-blue',
] as const;

/** One of `PALETTE_IDS`. */
export type PaletteId = (typeof PALETTE_IDS)[number];

/** Entries in every palette: index 0 is the coldest colour, 255 the hottest. */
export const PALETTE_SIZE = 256;

/** A colour at an index of the palette; the entries between two stops are interpolated. */
export interface PaletteStop {
  /** Integer from 0 to 255. The first stop is at 0, the last at 255. */
  readonly index: number;
  /** Red, green and blue, each an integer from 0 to 255. */
  readonly color: readonly [number, number, number];
}

/** A palette: its id, the name the viewer shows and the stops it is built from. */
export interface Palette {
  readonly id: PaletteId;
  readonly name: string;
  readonly stops: readonly PaletteStop[];
}

function stop(index: number, r: number, g: number, b: number): PaletteStop {
  return Object.freeze({ index, color: Object.freeze([r, g, b] as const) });
}

// The stops are irvis's own; TODO(owner): compare them with the vendor app's
// palettes in the screenshots of #11.
const DEFINITIONS: readonly Palette[] = [
  {
    id: 'iron',
    name: 'Iron',
    stops: [
      stop(0, 0, 0, 0),
      stop(40, 32, 0, 112),
      stop(88, 128, 0, 160),
      stop(136, 208, 40, 72),
      stop(176, 240, 112, 0),
      stop(216, 255, 192, 0),
      stop(255, 255, 255, 255),
    ],
  },
  { id: 'white-hot', name: 'White Hot', stops: [stop(0, 0, 0, 0), stop(255, 255, 255, 255)] },
  { id: 'black-hot', name: 'Black Hot', stops: [stop(0, 255, 255, 255), stop(255, 0, 0, 0)] },
  {
    id: 'rainbow',
    name: 'Rainbow',
    stops: [
      stop(0, 0, 0, 96),
      stop(40, 0, 0, 255),
      stop(88, 0, 200, 255),
      stop(128, 0, 224, 0),
      stop(168, 255, 240, 0),
      stop(212, 255, 96, 0),
      stop(255, 255, 0, 0),
    ],
  },
  {
    id: 'red-hot',
    name: 'Red Hot',
    stops: [
      stop(0, 0, 0, 0),
      stop(96, 200, 0, 0),
      stop(176, 255, 160, 0),
      stop(255, 255, 255, 255),
    ],
  },
  {
    id: 'cold-blue',
    name: 'Cold Blue',
    stops: [
      stop(0, 0, 0, 0),
      stop(96, 0, 32, 160),
      stop(176, 0, 160, 255),
      stop(255, 255, 255, 255),
    ],
  },
];

/** Every palette, in the order of `PALETTE_IDS`. Frozen. */
export const PALETTES: readonly Palette[] = Object.freeze(
  DEFINITIONS.map((p) => Object.freeze({ ...p, stops: Object.freeze([...p.stops]) })),
);

/**
 * The 256 × 3 bytes of a palette from its stops: between two stops each
 * channel goes linearly from one colour to the other, rounded to the nearest
 * integer (halves up). Throws on stops that do not start at 0, end at 255
 * and rise, or that hold a colour outside 0 to 255.
 */
export function buildLut(stops: readonly PaletteStop[]): Uint8Array<ArrayBuffer> {
  const problems = stopsProblems(stops);
  if (problems.length > 0) throw new Error(`invalid palette stops: ${problems.join('; ')}`);
  const lut = new Uint8Array(PALETTE_SIZE * 3);
  for (let s = 0; s + 1 < stops.length; s++) {
    const a = stops[s];
    const b = stops[s + 1];
    if (!a || !b) continue;
    const span = b.index - a.index;
    for (let i = a.index; i <= b.index; i++) {
      for (let c = 0; c < 3; c++) {
        const from = a.color[c] ?? 0;
        const to = b.color[c] ?? 0;
        lut[i * 3 + c] = Math.round(from + ((to - from) * (i - a.index)) / span);
      }
    }
  }
  return lut;
}

/** What `buildLut` rejects in a list of stops; empty when it can be used. */
export function stopsProblems(stops: readonly PaletteStop[]): string[] {
  const out: string[] = [];
  if (stops.length < 2) return ['a palette needs at least two stops'];
  if (!stops.every((s) => typeof s === 'object' && s !== null)) {
    return ['every stop must be an object with an index and a color'];
  }
  if (stops[0]?.index !== 0) out.push('the first stop must be at index 0');
  if (stops[stops.length - 1]?.index !== PALETTE_SIZE - 1) {
    out.push('the last stop must be at index 255');
  }
  for (let s = 1; s < stops.length; s++) {
    const a = stops[s - 1]?.index ?? 0;
    const b = stops[s]?.index ?? 0;
    if (!Number.isInteger(b) || b <= a) {
      out.push('stop indexes must be integers that rise');
      break;
    }
  }
  // Untyped input (a palette from a file) may hold holes or stops without a colour.
  const colors = stops.map((s): unknown => (s as Partial<PaletteStop> | undefined)?.color);
  if (
    !colors.every(
      (c) =>
        Array.isArray(c) &&
        c.length === 3 &&
        c.every((v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255),
    )
  ) {
    out.push('every stop color must be three integers from 0 to 255');
  }
  return out;
}

const LUTS: ReadonlyMap<PaletteId, Uint8Array<ArrayBuffer>> = new Map(
  PALETTES.map((p) => [p.id, buildLut(p.stops)]),
);

/** The palette with this id. Throws for an unknown id. */
export function findPalette(id: PaletteId): Palette {
  const palette = PALETTES.find((p) => p.id === id);
  if (!palette) throw new Error(`unknown palette '${String(id)}'`);
  return palette;
}

/** The table `renderPalette` uses for this palette; core keeps it, so do not change it. */
export function lutOf(id: PaletteId): Uint8Array<ArrayBuffer> {
  const lut = LUTS.get(id);
  if (!lut) throw new Error(`unknown palette '${String(id)}'`);
  return lut;
}

/**
 * A copy of a palette's table: 256 × 3 bytes, red, green and blue of index 0
 * (coldest) to 255 (hottest), for a scale bar.
 */
export function paletteLut(id: PaletteId): Uint8Array<ArrayBuffer> {
  return lutOf(id).slice();
}

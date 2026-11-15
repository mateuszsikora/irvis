// Palettes, rendering and measurements on corrected readings:
// docs/features/core-technical.md#interfaces
export { celsiusImage, checkImage, type CelsiusImage, type PixelReading } from './image.ts';
export * from './measurements.ts';
export {
  buildLut,
  findPalette,
  PALETTE_IDS,
  PALETTE_SIZE,
  PALETTES,
  paletteLut,
  stopsProblems,
  type Palette,
  type PaletteId,
  type PaletteStop,
} from './palettes.ts';
export * from './range.ts';
export * from './render.ts';

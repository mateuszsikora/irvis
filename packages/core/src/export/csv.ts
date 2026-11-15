import { checkImage, type CelsiusImage } from '../analysis/image.ts';

/** One row per pixel, zero-based coordinates, Celsius, explicit uncertainty. */
export function exportCsv(image: CelsiusImage): string {
  checkImage(image);
  const rows = ['x,y,celsius,uncertain'];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = y * image.width + x;
      const value = image.celsius[i] ?? Number.NaN;
      rows.push(
        `${String(x)},${String(y)},${Number.isFinite(value) ? String(value) : ''},${image.uncertain?.[i] ? '1' : '0'}`,
      );
    }
  }
  return rows.join('\r\n') + '\r\n';
}

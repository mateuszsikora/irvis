import { describe, expect, it } from 'vitest';
import { geometry, type Measurement } from '../src/measurements.ts';
import {
  findHandle,
  handlePixel,
  imagePixel,
  moveHandle,
  orientedPixel,
  toPercent,
} from '../src/pointer.ts';

const image = { width: 4, height: 2 };
const upright = { rotation: 0, mirrorX: false, mirrorY: false };

describe('pointer placement', () => {
  it('maps a position on the contained, oriented canvas to the unrotated pixel', () => {
    // 4 × 2 image in a 100 × 100 box: 25 px per pixel, 25 px bars above and below.
    const box = { left: 10, top: 20, width: 100, height: 100 };
    expect(imagePixel({ x: 10 + 80, y: 20 + 25 + 30 }, box, image, upright)).toEqual({
      x: 3,
      y: 1,
      scale: 25,
    });
    expect(imagePixel({ x: 50, y: 30 }, box, image, upright)).toBeNull();
    expect(imagePixel({ x: 50, y: 30 }, box, image, upright, true)).toMatchObject({ x: 1, y: 0 });
    // Rotated 90° the canvas is 2 × 4; its top-right corner shows pixel (0, 0).
    const tall = { left: 0, top: 0, width: 20, height: 40 };
    expect(imagePixel({ x: 19, y: 1 }, tall, image, { ...upright, rotation: 90 })).toMatchObject({
      x: 0,
      y: 0,
    });
    expect(imagePixel({ x: 1, y: 39 }, tall, image, { ...upright, rotation: 270 })).toMatchObject({
      x: 0,
      y: 0,
    });
    const wide = { left: 0, top: 0, width: 40, height: 20 };
    expect(imagePixel({ x: 39, y: 1 }, wide, image, { ...upright, mirrorX: true })).toMatchObject({
      x: 0,
      y: 0,
    });
    expect(imagePixel({ x: 1, y: 1 }, wide, image, { ...upright, rotation: 180 })).toMatchObject({
      x: 3,
      y: 1,
    });
  });
  it('finds every pixel again under each rotation and mirroring', () => {
    const small = { width: 5, height: 3 };
    for (const rotation of [0, 90, 180, 270])
      for (const mirrorX of [false, true])
        for (const mirrorY of [false, true]) {
          const orientation = { rotation, mirrorX, mirrorY };
          const quarter = rotation % 180 !== 0;
          const canvas = { width: quarter ? 3 : 5, height: quarter ? 5 : 3 };
          const seen = new Set<string>();
          for (let y = 0; y < small.height; y++)
            for (let x = 0; x < small.width; x++) {
              const at = orientedPixel({ x, y }, small, orientation);
              expect(at.x).toBeGreaterThanOrEqual(0);
              expect(at.x).toBeLessThan(canvas.width);
              expect(at.y).toBeGreaterThanOrEqual(0);
              expect(at.y).toBeLessThan(canvas.height);
              seen.add(`${at.x},${at.y}`);
              // The centre of that canvas pixel, drawn 1:1, maps back to the pixel.
              const box = { left: 0, top: 0, ...canvas };
              expect(imagePixel({ x: at.x + 0.5, y: at.y + 0.5 }, box, small, orientation)).toEqual(
                { x, y, scale: 1 },
              );
            }
          expect(seen.size).toBe(15);
        }
    // Turned 90° clockwise, the top-left pixel is on the canvas's top-right.
    expect(orientedPixel({ x: 0, y: 0 }, small, { ...upright, rotation: 90 })).toEqual({
      x: 2,
      y: 0,
    });
  });
  it('stores percentages that geometry turns back into the same pixel', () => {
    for (const size of [1, 2, 192, 256, 1000])
      for (let pixel = 0; pixel < size; pixel++) {
        const point: Measurement = {
          id: 1,
          kind: 'Point',
          x: toPercent(pixel, size),
          y: 0,
          x2: 0,
          y2: 0,
        };
        expect(geometry(point, { width: size, height: 1 }).from.x).toBe(pixel);
      }
  });
  it('grabs the nearest handle, preferring the selected object, and moves only it', () => {
    const big = { width: 101, height: 101 };
    const objects: Measurement[] = [
      { id: 1, kind: 'Point', x: 50, y: 50, x2: 0, y2: 0 },
      { id: 2, kind: 'Area', x: 10, y: 10, x2: 50, y2: 50 },
      { id: 3, kind: 'Line', x: 0, y: 0, x2: 90, y2: 90 },
    ];
    expect(findHandle(objects, null, big, { x: 51, y: 50 }, 3)).toEqual({
      id: 2,
      keys: ['x2', 'y2'],
    });
    expect(findHandle(objects, 1, big, { x: 51, y: 50 }, 3)).toEqual({ id: 1, keys: ['x', 'y'] });
    expect(findHandle(objects, null, big, { x: 49, y: 12 }, 3)).toEqual({
      id: 2,
      keys: ['x2', 'y'],
    });
    expect(findHandle(objects, null, big, { x: 89, y: 89 }, 3)).toEqual({
      id: 3,
      keys: ['x2', 'y2'],
    });
    expect(findHandle(objects, null, big, { x: 30, y: 30 }, 3)).toBeNull();
    expect(handlePixel(objects[1]!, { id: 2, keys: ['x2', 'y'] }, big)).toEqual({ x: 50, y: 10 });
    expect(moveHandle(objects, { id: 2, keys: ['x', 'y2'] }, big, { x: 5, y: 70 })).toEqual([
      objects[0],
      { id: 2, kind: 'Area', x: 5, y: 10, x2: 50, y2: 70 },
      objects[2],
    ]);
  });
});

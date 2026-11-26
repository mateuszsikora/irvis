import { geometry, type Measurement } from './measurements.ts';

export interface Orientation {
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
}
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface ImagePixel {
  x: number;
  y: number;
  /** Screen pixels per image pixel, to turn a screen distance into image pixels. */
  scale: number;
}

/**
 * Maps a pointer position to a pixel of the unrotated image. The canvas shows
 * the image rotated and mirrored as `FrameRenderer.present` draws it, scaled
 * into its box with `object-fit: contain`. Outside the picture this returns
 * null, unless `clamp` pulls the position onto its nearest edge pixel.
 */
export function imagePixel(
  client: { x: number; y: number },
  box: Box,
  image: { width: number; height: number },
  orientation: Orientation,
  clamp = false,
): ImagePixel | null {
  const quarter = orientation.rotation % 180 !== 0;
  const width = quarter ? image.height : image.width;
  const height = quarter ? image.width : image.height;
  const scale = Math.min(box.width / width, box.height / height);
  if (!(scale > 0)) return null;
  const px = (client.x - box.left - (box.width - width * scale) / 2) / scale;
  const py = (client.y - box.top - (box.height - height * scale) / 2) / scale;
  if (!clamp && (px < 0 || py < 0 || px >= width || py >= height)) return null;
  // Undo translate → rotate → scale (mirror) of the presented canvas.
  const angle = (orientation.rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(angle)),
    sin = Math.round(Math.sin(angle));
  const dx = px - width / 2,
    dy = py - height / 2;
  let x = dx * cos + dy * sin,
    y = -dx * sin + dy * cos;
  if (orientation.mirrorX) x = -x;
  if (orientation.mirrorY) y = -y;
  const pixel = (value: number, size: number) =>
    Math.min(size - 1, Math.max(0, Math.floor(value + size / 2)));
  return { x: pixel(x, image.width), y: pixel(y, image.height), scale };
}

/**
 * Where pixel `pixel` of the unrotated image lands on the presented canvas:
 * the forward transform of `FrameRenderer.present`, the inverse of `imagePixel`.
 */
export function orientedPixel(
  pixel: { x: number; y: number },
  image: { width: number; height: number },
  orientation: Orientation,
): { x: number; y: number } {
  const quarter = orientation.rotation % 180 !== 0;
  const width = quarter ? image.height : image.width;
  const height = quarter ? image.width : image.height;
  const angle = (orientation.rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(angle)),
    sin = Math.round(Math.sin(angle));
  // The pixel's centre, mirrored, rotated, then moved to the canvas centre.
  let dx = pixel.x + 0.5 - image.width / 2,
    dy = pixel.y + 0.5 - image.height / 2;
  if (orientation.mirrorX) dx = -dx;
  if (orientation.mirrorY) dy = -dy;
  return {
    x: Math.floor(dx * cos - dy * sin + width / 2),
    y: Math.floor(dx * sin + dy * cos + height / 2),
  };
}

/** The percentage that `geometry` turns back into the same pixel. */
export function toPercent(pixel: number, size: number) {
  return size > 1 ? Math.round((pixel / (size - 1)) * 10000) / 100 : 0;
}

/** A draggable spot of an object: a point, a line end or an area corner. */
export interface Handle {
  id: number;
  keys: ['x' | 'x2', 'y' | 'y2'];
}

/** Screen pixels a pointer must move before a press becomes a drag. */
export const DRAG_PIXELS = 3;

/** The pixel a handle sits on. */
export function handlePixel(
  object: Measurement,
  handle: Handle,
  image: { width: number; height: number },
): { x: number; y: number } {
  const { from, to } = geometry(object, image);
  return {
    x: handle.keys[0] === 'x' ? from.x : to.x,
    y: handle.keys[1] === 'y' ? from.y : to.y,
  };
}

/**
 * The handle nearest to `at` within `radius` image pixels; on a tie the
 * selected object's, then the newer object's.
 */
export function findHandle(
  objects: Measurement[],
  selected: number | null,
  image: { width: number; height: number },
  at: { x: number; y: number },
  radius: number,
): Handle | null {
  const ordered = [...objects]
    .reverse()
    .sort((a, b) => +(b.id === selected) - +(a.id === selected));
  let best: Handle | null = null;
  let distance = radius;
  for (const object of ordered) {
    const { from, to } = geometry(object, image);
    const handles: [Handle['keys'], { x: number; y: number }][] =
      object.kind === 'Point'
        ? [[['x', 'y'], from]]
        : object.kind === 'Line'
          ? [
              [['x', 'y'], from],
              [['x2', 'y2'], to],
            ]
          : [
              [['x', 'y'], from],
              [['x2', 'y2'], to],
              [['x2', 'y'], { x: to.x, y: from.y }],
              [['x', 'y2'], { x: from.x, y: to.y }],
            ];
    for (const [keys, spot] of handles) {
      const d = Math.hypot(spot.x - at.x, spot.y - at.y);
      if (d <= distance && (!best || d < distance)) {
        best = { id: object.id, keys };
        distance = d;
      }
    }
  }
  return best;
}

/** Moves one handle of one object onto the pixel `at`. */
export function moveHandle(
  objects: Measurement[],
  handle: Handle,
  image: { width: number; height: number },
  at: { x: number; y: number },
): Measurement[] {
  const [kx, ky] = handle.keys;
  return objects.map((o) =>
    o.id === handle.id
      ? { ...o, [kx]: toPercent(at.x, image.width), [ky]: toPercent(at.y, image.height) }
      : o,
  );
}

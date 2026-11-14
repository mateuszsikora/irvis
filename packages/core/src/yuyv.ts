// Decoders for packed YUYV frames: the raw values of the thermal rows and the
// Y, U and V bytes of the image rows. Layouts come from the camera profile:
// docs/features/core-technical.md#interfaces
import type { CameraStateSnapshot, Conversion, RowRange, VideoMode } from './cameras/profile.ts';
import type { ThermalFrame, YuyvFrame } from './frames.ts';

/** The bytes of image rows in a YUYV frame, split into planes. */
export interface YuyvImage {
  /** Pixels per row. */
  readonly width: number;
  /** Rows. */
  readonly height: number;
  /** One luma byte per pixel, width × height, row-major. */
  readonly y: Uint8Array;
  /** One U byte per pair of pixels, width / 2 × height. */
  readonly u: Uint8Array;
  /** One V byte per pair of pixels, width / 2 × height. */
  readonly v: Uint8Array;
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** Throws unless the frame's size and byte count are those of packed YUYV. */
export function checkYuyvFrame(frame: YuyvFrame): void {
  const { width, height, data } = frame;
  if (!isPositiveInt(width) || width % 2 !== 0) {
    throw new Error(`YUYV frame width ${String(width)} is not a positive even integer`);
  }
  if (!isPositiveInt(height)) {
    throw new Error(`YUYV frame height ${String(height)} is not a positive integer`);
  }
  const expected = width * height * 2;
  if (data.length !== expected) {
    throw new Error(
      `YUYV frame has ${String(data.length)} bytes, expected ${String(expected)} for ${String(width)}×${String(height)}`,
    );
  }
}

function checkRows(frame: YuyvFrame, range: RowRange): void {
  const { firstRow, rows } = range;
  if (!isPositiveInt(rows)) {
    throw new Error(`rows must be a positive integer, not ${String(rows)}`);
  }
  if (!Number.isInteger(firstRow) || firstRow < 0 || firstRow + rows > frame.height) {
    throw new Error(
      `rows ${String(firstRow)} to ${String(firstRow + rows - 1)} are not inside the ${String(frame.height)}-row frame`,
    );
  }
}

/**
 * The raw 16-bit values packed into rows of a YUYV frame: each pixel is two
 * bytes, low byte first (`[Y0 U Y1 V]` = `[p0.lo p0.hi p1.lo p1.hi]`), so
 * raw = lo | hi << 8. Returns width × rows values, row-major.
 */
export function decodeYuyvRaw(frame: YuyvFrame, range: RowRange): Uint16Array {
  checkYuyvFrame(frame);
  checkRows(frame, range);
  const { width, data } = frame;
  const count = width * range.rows;
  const start = range.firstRow * width * 2;
  const view = new DataView(data.buffer, data.byteOffset + start, count * 2);
  const raw = new Uint16Array(count);
  for (let i = 0; i < count; i++) raw[i] = view.getUint16(i * 2, true);
  return raw;
}

/** The Y, U and V bytes of rows of a YUYV frame, as the camera sent them. */
export function decodeYuyvImage(frame: YuyvFrame, range: RowRange): YuyvImage {
  checkYuyvFrame(frame);
  checkRows(frame, range);
  const { width, data } = frame;
  const pixels = width * range.rows;
  const y = new Uint8Array(pixels);
  const u = new Uint8Array(pixels / 2);
  const v = new Uint8Array(pixels / 2);
  const start = range.firstRow * width * 2;
  for (let pair = 0; pair < pixels / 2; pair++) {
    const at = start + pair * 4;
    y[pair * 2] = data[at] ?? 0;
    u[pair] = data[at + 1] ?? 0;
    y[pair * 2 + 1] = data[at + 2] ?? 0;
    v[pair] = data[at + 3] ?? 0;
  }
  return { width, height: range.rows, y, u, v };
}

/**
 * The ThermalFrame in a YUYV frame of a video mode: the raw values of the
 * mode's thermal rows, with the conversion and the camera state that apply.
 * Throws when the frame does not have the mode's size or the mode carries no
 * temperature data.
 */
export function decodeThermalFrame(
  frame: YuyvFrame,
  mode: VideoMode,
  conversion: Conversion,
  cameraState: CameraStateSnapshot,
): ThermalFrame {
  if (mode.layout === null) {
    throw new Error(`video mode '${mode.id}' carries no temperature data`);
  }
  if (frame.width !== mode.width || frame.height !== mode.height) {
    throw new Error(
      `frame is ${String(frame.width)}×${String(frame.height)}, video mode '${mode.id}' is ${String(mode.width)}×${String(mode.height)}`,
    );
  }
  const { thermal } = mode.layout;
  return {
    width: mode.width,
    height: thermal.rows,
    timestamp: frame.timestamp,
    raw: decodeYuyvRaw(frame, thermal),
    conversion,
    cameraState,
    uncertain: null,
  };
}

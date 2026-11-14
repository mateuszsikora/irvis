// Synthetic thermal scenes for the .irvis tests and the benchmark. Not real
// camera data: the fixtures issue (#16) adds real frames. Deterministic, so a
// failing test fails the same way every time.
import type { CameraStateSnapshot, Conversion } from '../src/cameras/profile.ts';
import type { ThermalFrame } from '../src/frames.ts';

/** The P2 Pro's high-gain conversion: raw in 1/64 K. */
export const CONVERSION: Conversion = { kind: 'linear', scale: 1 / 64, offset: -273.15 };
export const ASSUMED: CameraStateSnapshot = { origin: 'assumed', values: {} };

/** The raw value of a temperature under CONVERSION. */
export function rawOf(celsius: number): number {
  return Math.round((celsius + 273.15) * 64);
}

/** mulberry32: a small seeded generator of numbers in [0, 1). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An approximately normal value with mean 0 and deviation 1 (the sum of 12 uniform values). */
export function gaussian(next: () => number): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += next();
  return sum - 6;
}

function clamp16(value: number): number {
  return Math.min(0xffff, Math.max(0, Math.round(value)));
}

export interface SceneOptions {
  readonly width?: number;
  readonly height?: number;
  readonly frames?: number;
  /** Sensor noise, raw units. Default 2.5 (about 0.04 K). */
  readonly sigma?: number;
  readonly seed?: number;
  /** Frame period in ms. Default 40 (25 fps). */
  readonly periodMs?: number;
}

export interface Scene {
  readonly width: number;
  readonly height: number;
  readonly frames: Uint16Array[];
  readonly timestamps: number[];
}

/** A room at about 22 °C with a gradient and a mug at 60 °C. */
function background(width: number, height: number): Float64Array {
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - width * 0.3) / (width * 0.08);
      const dy = (y - height * 0.6) / (height * 0.12);
      const mug = dx * dx + dy * dy < 1 ? 38 : 0;
      out[y * width + x] = rawOf(21 + (2 * x) / width + (1 * y) / height + mug);
    }
  }
  return out;
}

function build(
  options: SceneOptions,
  draw: (base: Float64Array, frame: number, width: number, height: number) => Float64Array,
): Scene {
  const width = options.width ?? 256;
  const height = options.height ?? 192;
  const count = options.frames ?? 50;
  const sigma = options.sigma ?? 2.5;
  const next = random(options.seed ?? 1);
  const base = background(width, height);
  const frames: Uint16Array[] = [];
  const timestamps: number[] = [];
  for (let f = 0; f < count; f++) {
    const clean = draw(base, f, width, height);
    const raw = new Uint16Array(width * height);
    for (let i = 0; i < raw.length; i++) raw[i] = clamp16((clean[i] ?? 0) + sigma * gaussian(next));
    frames.push(raw);
    timestamps.push(1000 + f * (options.periodMs ?? 40));
  }
  return { width, height, frames, timestamps };
}

/** Nothing moves; only the sensor noise changes. */
export function staticScene(options: SceneOptions = {}): Scene {
  return build(options, (base) => base);
}

/** A hand at 34 °C moving across the room, about one frame width in 2 s. */
export function movingHandScene(options: SceneOptions = {}): Scene {
  return build(options, (base, f, width, height) => {
    const out = base.slice();
    const cx = (((f * width) / 50) % (width * 1.4)) - width * 0.2;
    const cy = height * 0.45 + height * 0.1 * Math.sin(f / 7);
    const rx = width * 0.12;
    const ry = height * 0.3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d < 1) out[y * width + x] = rawOf(34 - 1.5 * d);
      }
    }
    return out;
  });
}

/** A soldering iron tip at 320 °C appears in frame `at` and stays. */
export function hotTipScene(at: number, options: SceneOptions = {}): Scene {
  return build(options, (base, f, width, height) => {
    const out = base.slice();
    if (f >= at) {
      for (let y = height >> 1; y < (height >> 1) + 3; y++) {
        for (let x = width >> 1; x < (width >> 1) + 3; x++) out[y * width + x] = rawOf(320);
      }
    }
    return out;
  });
}

/** The static scene with a stuck-low pixel, a stuck-high pixel and a pixel that flips between them. */
export function deadPixelScene(options: SceneOptions = {}): Scene {
  const scene = staticScene(options);
  scene.frames.forEach((raw, f) => {
    raw[0] = 0;
    raw[scene.width + 3] = 0xffff;
    raw[raw.length - 1] = f % 2 === 0 ? 0 : 0xffff;
  });
  return scene;
}

/**
 * The static scene with a NUC: from frame `at` the picture freezes for
 * `frozen` frames, then comes back with every value `jump` raw units higher.
 */
export function nucScene(
  at: number,
  frozen: number,
  jump: number,
  options: SceneOptions = {},
): Scene {
  const scene = staticScene(options);
  for (let f = at; f < scene.frames.length; f++) {
    if (f < at + frozen) {
      scene.frames[f] = (scene.frames[at - 1] ?? new Uint16Array(0)).slice();
    } else {
      const raw = scene.frames[f] ?? new Uint16Array(0);
      for (let i = 0; i < raw.length; i++) raw[i] = clamp16((raw[i] ?? 0) + jump);
    }
  }
  return scene;
}

/** A ThermalFrame of a scene's frame. */
export function thermalFrame(
  scene: Scene,
  f: number,
  overrides: Partial<ThermalFrame> = {},
): ThermalFrame {
  return {
    width: scene.width,
    height: scene.height,
    timestamp: scene.timestamps[f] ?? 0,
    raw: scene.frames[f] ?? new Uint16Array(scene.width * scene.height),
    conversion: CONVERSION,
    cameraState: ASSUMED,
    uncertain: null,
    ...overrides,
  };
}

/** The largest |a − b| over two equally long arrays. */
export function maxError(a: Uint16Array, b: Uint16Array): number {
  if (a.length !== b.length)
    throw new Error(`lengths differ: ${String(a.length)} and ${String(b.length)}`);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return max;
}

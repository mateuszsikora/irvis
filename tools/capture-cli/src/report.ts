// `report`: reads a capture directory and measures what the M1 spike asks:
// frame size, frame rate and jitter, temperatures, the upper half, noise and
// automatic NUC events. Every number and heuristic:
// docs/features/capture-cli-technical.md#report
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  type Conversion,
  type RowRange,
  type VideoMode,
  type YuyvFrame,
  decodeYuyvImage,
  decodeYuyvRaw,
  findProfile,
  toCelsius,
} from '@irvis/core';
import { CliError } from './errors.ts';
import { type Framecrc, REQUESTED_PIXEL_FORMAT, parseFramecrc } from './ffmpeg.ts';
import { pgm, png, stretch } from './image.ts';
import { type CaptureMeta, PACKETS_FILE, readMeta } from './meta.ts';
import {
  type HistogramBin,
  type Summary,
  histogram,
  median,
  quantile,
  spearman,
  summarize,
} from './stats.ts';

/** Frames sampled for the upper-half statistics. */
export const UPPER_SAMPLES = 50;
/** An interval longer than this many nominal frame periods counts as late. */
export const LATE_FACTOR = 1.5;
/** A frame whose spatial spread is below this fraction of the median looks like a closed shutter. */
export const FLAT_FRACTION = 0.25;
/** A frame-to-frame step of the mean above this many kelvin, and ... */
export const STEP_MIN_KELVIN = 0.5;
/** ... above this many times the median step, is a step event. */
export const STEP_FACTOR = 10;
/** U and V within 128 ± this count as neutral (no colour). */
export const NEUTRAL_UV = 2;
/** The fewest event-free frames the noise estimate needs. */
export const NOISE_MIN_FRAMES = 25;

/** Gives the bytes of frame i of a capture. */
export interface FrameSource {
  readonly count: number;
  read(index: number): Promise<Uint8Array>;
}

export function directorySource(dir: string, meta: CaptureMeta): FrameSource {
  return {
    count: meta.frames.length,
    async read(index) {
      const entry = meta.frames[index];
      if (entry === undefined) throw new CliError(`frame ${String(index)} is not in meta.json`);
      return new Uint8Array(gunzipSync(await readFile(join(dir, entry.file))));
    },
  };
}

export interface NucEvent {
  /** `frozen`: the raw values repeat exactly. `flat`: the image is nearly uniform. `step`: the mean jumps. */
  readonly kind: 'frozen' | 'flat' | 'step';
  readonly frame: number;
  readonly timeMs: number;
  /** Frames the event lasts. */
  readonly frames: number;
  /** Change of the frame mean across the event, in kelvin; null at the end of the capture. */
  readonly stepKelvin: number | null;
}

export interface CaptureReport {
  readonly label: string | null;
  readonly device: CaptureMeta['device'];
  readonly mode: CaptureMeta['mode'];
  readonly ffmpegVersion: string | null;
  readonly macos: string | null;
  readonly frames: number;
  readonly frameSize: {
    readonly expected: number;
    /** Packet size → count, from the framecrc list; null when it is missing. */
    readonly packetSizes: Readonly<Record<string, number>> | null;
    readonly trailingBytes: number;
    readonly exact: boolean;
  };
  /** The pixel format AVFoundation delivered (meta.json), null when unknown. */
  readonly pixelFormat: string | null;
  readonly timing: {
    readonly firstFrameMs: number | null;
    readonly seconds: number;
    readonly fpsArrival: number;
    readonly arrivalIntervalMs: Summary & { readonly p99: number };
    readonly lateArrivals: number;
    readonly fpsPts: number | null;
    readonly ptsIntervalMs: (Summary & { readonly p99: number }) | null;
    /** Frames missing by pts: intervals of about k nominal periods count k − 1. */
    readonly missingByPts: number | null;
  };
  readonly temperatures: {
    readonly previewFrame: number;
    readonly minCelsius: number;
    readonly maxCelsius: number;
    readonly centreCelsius: number;
    readonly histogram: readonly HistogramBin[];
    readonly series: {
      readonly minCelsius: number;
      readonly maxCelsius: number;
      readonly centre: Summary;
    };
    readonly plausible: boolean;
    readonly referenceCelsius: number | null;
    readonly referenceDiff: number | null;
  } | null;
  readonly upper: {
    readonly samples: number;
    readonly y: { readonly min: number; readonly max: number };
    readonly u: Summary;
    readonly v: Summary;
    /** Share of U and V bytes within 128 ± NEUTRAL_UV. */
    readonly neutralShare: number;
    /** Spearman correlation of Y with the raw value of the same pixel, per sampled frame. */
    readonly spearman: {
      readonly median: number;
      readonly min: number;
      readonly max: number;
    } | null;
  };
  readonly noise: {
    readonly frames: number;
    readonly firstFrame: number;
    /** Median over pixels of the temporal standard deviation, in millikelvin. */
    readonly medianMk: number;
    readonly meanMk: number;
    /** The same after removing each frame's mean offset (global drift and flicker). */
    readonly medianDetrendedMk: number;
  } | null;
  readonly nucEvents: readonly NucEvent[];
}

function withP99(values: ArrayLike<number>): Summary & { p99: number } {
  return { ...summarize(values), p99: quantile(values, 0.99) };
}

function diffs(values: readonly number[]): number[] {
  return values.slice(1).map((v, i) => v - (values[i] ?? 0));
}

function centreRaw(raw: Uint16Array, width: number, height: number): number {
  const x = width / 2;
  const y = height / 2;
  const at = (cx: number, cy: number): number => raw[cy * width + cx] ?? 0;
  return (at(x - 1, y - 1) + at(x, y - 1) + at(x - 1, y) + at(x, y)) / 4;
}

function sameValues(a: Uint16Array, b: Uint16Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function yuyv(width: number, height: number, data: Uint8Array): YuyvFrame {
  return { kind: 'yuyv', width, height, data, timestamp: 0 };
}

/** Groups consecutive true indices into [first, last] runs. */
function runs(flags: readonly boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  flags.forEach((flag, i) => {
    if (flag && start < 0) start = i;
    if (!flag && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, flags.length - 1]);
  return out;
}

export interface AnalyseOptions {
  /** Frame for the previews and the single-frame temperatures; the middle frame by default. */
  readonly previewFrame?: number;
}

export interface Previews {
  readonly image: { readonly width: number; readonly height: number; readonly y: Uint8Array };
  readonly thermal: {
    readonly width: number;
    readonly height: number;
    readonly raw: Uint16Array;
  } | null;
}

/** Measures a capture. Reads every frame twice: once for the per-frame values, once for the noise. */
export async function analyse(
  meta: CaptureMeta,
  packets: Framecrc | null,
  source: FrameSource,
  options: AnalyseOptions = {},
): Promise<{ report: CaptureReport; previews: Previews | null }> {
  const profile = findProfile(meta.profile);
  const mode: VideoMode | undefined = profile?.videoModes.find((m) => m.id === meta.mode.id);
  if (profile === undefined || mode === undefined) {
    throw new CliError(`unknown profile '${meta.profile}' or video mode '${meta.mode.id}'`);
  }
  const { width, height } = mode;
  const n = source.count;
  const nominalMs = 1000 / mode.fps;
  const thermalRange: RowRange | null = mode.layout?.thermal ?? null;
  const imageRange: RowRange = mode.layout?.image ?? { firstRow: 0, rows: height };
  const conversion: Conversion | null = thermalRange
    ? (profile.conversions[0]?.conversion ?? null)
    : null;
  const previewFrame = Math.min(Math.max(0, options.previewFrame ?? Math.floor(n / 2)), n - 1);

  // Pass 1: per-frame values.
  const mean: number[] = [];
  const spread: number[] = [];
  const minRaw: number[] = [];
  const maxRaw: number[] = [];
  const centre: number[] = [];
  const frozen: boolean[] = [];
  const rhos: number[] = [];
  let neutral = 0;
  let uvCount = 0;
  let yMin = 255;
  let yMax = 0;
  const uAll: number[] = [];
  const vAll: number[] = [];
  const step = Math.max(1, Math.floor(n / UPPER_SAMPLES));
  let previous: Uint16Array | null = null;
  let previews: Previews | null = null;
  let samples = 0;

  for (let i = 0; i < n; i++) {
    const frame = yuyv(width, height, await source.read(i));
    const raw = thermalRange ? decodeYuyvRaw(frame, thermalRange) : null;
    if (raw) {
      const s = summarize(raw);
      mean.push(s.mean);
      spread.push(s.sd);
      minRaw.push(s.min);
      maxRaw.push(s.max);
      centre.push(centreRaw(raw, width, thermalRange?.rows ?? 0));
      frozen.push(previous !== null && sameValues(previous, raw));
      previous = raw;
    }
    const sampled = i % step === 0 && samples < UPPER_SAMPLES;
    if (sampled || i === previewFrame) {
      const image = decodeYuyvImage(frame, imageRange);
      if (sampled) {
        samples++;
        for (const y of image.y) {
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
        }
        for (let k = 0; k < image.u.length; k++) {
          const u = image.u[k] ?? 0;
          const v = image.v[k] ?? 0;
          uAll.push(u);
          vAll.push(v);
          if (Math.abs(u - 128) <= NEUTRAL_UV) neutral++;
          if (Math.abs(v - 128) <= NEUTRAL_UV) neutral++;
          uvCount += 2;
        }
        if (raw && raw.length === image.y.length) rhos.push(spearman(image.y, raw));
      }
      if (i === previewFrame) {
        previews = {
          image: { width, height: image.height, y: image.y },
          thermal: raw ? { width, height: thermalRange?.rows ?? 0, raw } : null,
        };
      }
    }
  }

  const arrival = meta.frames.map((f) => f.arrivalMs);
  const arrivalIntervals = diffs(arrival);
  const spanMs = (arrival[arrival.length - 1] ?? 0) - (arrival[0] ?? 0);

  let fpsPts: number | null = null;
  let ptsIntervalMs: (Summary & { p99: number }) | null = null;
  let missingByPts: number | null = null;
  if (packets?.timeBase && packets.packets.length > 1) {
    const [num, den] = packets.timeBase;
    const ptsMs = packets.packets.map((p) => (p.pts * num * 1000) / den);
    const intervals = diffs(ptsMs);
    ptsIntervalMs = withP99(intervals);
    const ptsSpan = (ptsMs[ptsMs.length - 1] ?? 0) - (ptsMs[0] ?? 0);
    fpsPts = ptsSpan > 0 ? ((ptsMs.length - 1) * 1000) / ptsSpan : null;
    missingByPts = intervals.reduce((m, d) => m + Math.max(0, Math.round(d / nominalMs) - 1), 0);
  }

  let packetSizes: Record<string, number> | null = null;
  if (packets) {
    packetSizes = {};
    for (const p of packets.packets)
      packetSizes[String(p.size)] = (packetSizes[String(p.size)] ?? 0) + 1;
  }
  const exact =
    n > 0 &&
    meta.trailingBytes === 0 &&
    (packets === null ||
      (packets.packets.length === n && packets.packets.every((p) => p.size === meta.frameBytes)));

  // NUC events.
  const events: NucEvent[] = [];
  const kPerRaw = conversion ? kelvinPerRaw(conversion, median(mean)) : 0;
  if (thermalRange) {
    const timeOf = (i: number): number => arrival[i] ?? 0;
    const meanAfter = (last: number, first: number): number | null =>
      last + 1 < n ? ((mean[last + 1] ?? 0) - (mean[first] ?? 0)) * kPerRaw : null;
    for (const [s, e] of runs(frozen)) {
      events.push({
        kind: 'frozen',
        frame: s - 1,
        timeMs: timeOf(s - 1),
        frames: e - s + 2,
        stepKelvin: meanAfter(e, s - 1),
      });
    }
    const typicalSpread = median(spread);
    const flat = spread.map((sd) => sd < typicalSpread * FLAT_FRACTION);
    for (const [s, e] of runs(flat)) {
      events.push({
        kind: 'flat',
        frame: s,
        timeMs: timeOf(s),
        frames: e - s + 1,
        stepKelvin: s > 0 ? meanAfter(e, s - 1) : null,
      });
    }
    const steps = diffs(mean).map(Math.abs);
    const typicalStep = median(steps);
    const covered = new Set<number>();
    for (const ev of events) for (let k = ev.frame; k <= ev.frame + ev.frames; k++) covered.add(k);
    steps.forEach((d, k) => {
      const i = k + 1;
      if (covered.has(i)) return;
      if (d * kPerRaw > STEP_MIN_KELVIN && d > typicalStep * STEP_FACTOR) {
        events.push({
          kind: 'step',
          frame: i,
          timeMs: timeOf(i),
          frames: 1,
          stepKelvin: ((mean[i] ?? 0) - (mean[i - 1] ?? 0)) * kPerRaw,
        });
      }
    });
    events.sort((a, b) => a.frame - b.frame);
  }

  // Pass 2: noise over the longest stretch without events.
  let noise: CaptureReport['noise'] = null;
  if (thermalRange && conversion) {
    const bad = new Array<boolean>(n).fill(false);
    for (const ev of events) {
      for (let k = Math.max(0, ev.frame); k <= Math.min(n - 1, ev.frame + ev.frames); k++)
        bad[k] = true;
    }
    let best: [number, number] | null = null;
    for (const [s, e] of runs(bad.map((b) => !b))) {
      if (best === null || e - s > best[1] - best[0]) best = [s, e];
    }
    if (best && best[1] - best[0] + 1 >= NOISE_MIN_FRAMES) {
      noise = await temporalNoise(source, width, height, thermalRange, best, mean, kPerRaw);
    }
  }

  let temperatures: CaptureReport['temperatures'] = null;
  if (conversion && previews?.thermal) {
    const raw = previews.thermal.raw;
    const celsius = Float64Array.from(raw, (r) => toCelsius(r, conversion));
    const s = summarize(celsius);
    const binWidth = Math.max(1, Math.ceil((s.max - s.min) / 30));
    const centreSeries = centre.map((r) => toCelsius(r, conversion));
    const centreSummary = summarize(centreSeries);
    const medianMean = toCelsius(median(mean), conversion);
    const ref = meta.referenceCelsius;
    temperatures = {
      previewFrame,
      minCelsius: s.min,
      maxCelsius: s.max,
      centreCelsius: toCelsius(centre[previewFrame] ?? 0, conversion),
      histogram: histogram(celsius, binWidth),
      series: {
        minCelsius: toCelsius(summarize(minRaw).min, conversion),
        maxCelsius: toCelsius(summarize(maxRaw).max, conversion),
        centre: centreSummary,
      },
      plausible: medianMean > -40 && medianMean < 200 && median(spread) > 0,
      referenceCelsius: ref,
      referenceDiff: ref === null ? null : centreSummary.mean - ref,
    };
  }

  const rhoFinite = rhos.filter(Number.isFinite);
  const report: CaptureReport = {
    label: meta.label,
    device: meta.device,
    mode: meta.mode,
    ffmpegVersion: meta.ffmpeg.version,
    macos: meta.system.macos,
    frames: n,
    frameSize: { expected: meta.frameBytes, packetSizes, trailingBytes: meta.trailingBytes, exact },
    pixelFormat: meta.pixelFormat,
    timing: {
      firstFrameMs: meta.timing.firstFrameMs,
      seconds: spanMs / 1000,
      fpsArrival: spanMs > 0 ? ((n - 1) * 1000) / spanMs : Number.NaN,
      arrivalIntervalMs: withP99(arrivalIntervals),
      lateArrivals: arrivalIntervals.filter((d) => d > nominalMs * LATE_FACTOR).length,
      fpsPts,
      ptsIntervalMs,
      missingByPts,
    },
    temperatures,
    upper: {
      samples,
      y: { min: yMin, max: yMax },
      u: summarize(uAll),
      v: summarize(vAll),
      neutralShare: uvCount > 0 ? neutral / uvCount : Number.NaN,
      spearman:
        rhoFinite.length > 0
          ? {
              median: median(rhoFinite),
              min: summarize(rhoFinite).min,
              max: summarize(rhoFinite).max,
            }
          : null,
    },
    noise,
    nucEvents: events,
  };
  return { report, previews };
}

/** Kelvin per raw unit around a raw value: the slope of the conversion there. */
function kelvinPerRaw(conversion: Conversion, raw: number): number {
  const r = Math.round(raw);
  return toCelsius(r + 1, conversion) - toCelsius(r, conversion);
}

async function temporalNoise(
  source: FrameSource,
  width: number,
  height: number,
  range: RowRange,
  [first, last]: [number, number],
  frameMeans: readonly number[],
  kPerRaw: number,
): Promise<NonNullable<CaptureReport['noise']>> {
  const pixels = width * range.rows;
  const sum = new Float64Array(pixels);
  const sumSq = new Float64Array(pixels);
  const sumD = new Float64Array(pixels);
  const sumSqD = new Float64Array(pixels);
  const count = last - first + 1;
  let meanOfMeans = 0;
  for (let i = first; i <= last; i++) meanOfMeans += frameMeans[i] ?? 0;
  meanOfMeans /= count;
  for (let i = first; i <= last; i++) {
    const raw = decodeYuyvRaw(yuyv(width, height, await source.read(i)), range);
    const offset = (frameMeans[i] ?? 0) - meanOfMeans;
    for (let p = 0; p < pixels; p++) {
      const v = raw[p] ?? 0;
      sum[p] = (sum[p] ?? 0) + v;
      sumSq[p] = (sumSq[p] ?? 0) + v * v;
      const d = v - offset;
      sumD[p] = (sumD[p] ?? 0) + d;
      sumSqD[p] = (sumSqD[p] ?? 0) + d * d;
    }
  }
  const sd = new Float64Array(pixels);
  const sdD = new Float64Array(pixels);
  for (let p = 0; p < pixels; p++) {
    const m = (sum[p] ?? 0) / count;
    sd[p] = Math.sqrt(Math.max(0, (sumSq[p] ?? 0) / count - m * m));
    const md = (sumD[p] ?? 0) / count;
    sdD[p] = Math.sqrt(Math.max(0, (sumSqD[p] ?? 0) / count - md * md));
  }
  const mk = 1000 * kPerRaw;
  return {
    frames: count,
    firstFrame: first,
    medianMk: median(sd) * mk,
    meanMk: summarize(sd).mean * mk,
    medianDetrendedMk: median(sdD) * mk,
  };
}

const fmt = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : v.toFixed(digits);
const signed = (v: number, digits = 2): string =>
  `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
const yesNo = (v: boolean): string => (v ? 'yes' : 'no');

/** The pixel format line of a capture's block. */
export function pixelFormatText(format: string | null): string {
  if (format === null) return 'unknown (ffmpeg.log does not say)';
  if (format === REQUESTED_PIXEL_FORMAT) return `${format}, as requested`;
  return `${format}, not ${REQUESTED_PIXEL_FORMAT}: the bytes are not in the camera's order, so the values below are wrong`;
}

/** Whether the upper half is greyscale and how its brightness follows the raw values. */
export function upperVerdict(upper: CaptureReport['upper']): string {
  const colour =
    upper.neutralShare >= 0.99
      ? 'greyscale (U and V within 128 ± 2)'
      : 'colour: U and V vary, so probably a palette';
  const rho = upper.spearman?.median;
  if (rho === undefined || !Number.isFinite(rho)) return colour;
  const order =
    rho >= 0.9
      ? 'brightness rises with temperature'
      : rho <= -0.9
        ? 'brightness falls with temperature'
        : 'brightness is not a monotonic function of temperature';
  return `${colour}; ${order}`;
}

/** The Markdown block for one capture, to paste into the issue. */
export function formatReport(r: CaptureReport, name: string): string {
  const lines: string[] = [];
  const t = r.timing;
  lines.push(`#### ${r.label ?? name} (\`${name}\`)`, '');
  lines.push(
    `- Device: [${String(r.device.index)}] ${r.device.name ?? 'unknown'}; mode \`${r.mode.id}\`; ffmpeg ${r.ffmpegVersion ?? 'unknown'}; macOS ${r.macos ?? 'unknown'}`,
  );
  const sizes =
    r.frameSize.packetSizes === null
      ? 'no packet list'
      : Object.entries(r.frameSize.packetSizes)
          .map(([size, count]) => `${size} B × ${String(count)}`)
          .join(', ');
  lines.push(`- Pixel format: ${pixelFormatText(r.pixelFormat)}`);
  lines.push(
    `- Frames: ${String(r.frames)} in ${fmt(t.seconds, 2)} s; every frame ${String(r.frameSize.expected)} B: ${yesNo(r.frameSize.exact)} (packets: ${sizes}; trailing bytes: ${String(r.frameSize.trailingBytes)})`,
  );
  lines.push(`- Time to first frame: ${fmt(t.firstFrameMs, 0)} ms after ffmpeg started`);
  lines.push(
    `- Frame rate by arrival: ${fmt(t.fpsArrival, 2)} fps; interval mean ${fmt(t.arrivalIntervalMs.mean)} ms, sd ${fmt(t.arrivalIntervalMs.sd)} ms, p99 ${fmt(t.arrivalIntervalMs.p99)} ms, max ${fmt(t.arrivalIntervalMs.max)} ms; late (> ${fmt((1000 / r.mode.fps) * LATE_FACTOR, 0)} ms): ${String(t.lateArrivals)}`,
  );
  if (t.ptsIntervalMs) {
    lines.push(
      `- Frame rate by pts: ${fmt(t.fpsPts, 2)} fps; interval sd ${fmt(t.ptsIntervalMs.sd, 2)} ms, max ${fmt(t.ptsIntervalMs.max)} ms; missing frames: ${String(t.missingByPts ?? 0)}`,
    );
  }
  const temp = r.temperatures;
  if (temp) {
    lines.push(
      `- Lower half looks like temperature data: ${yesNo(temp.plausible)}`,
      `- Frame ${String(temp.previewFrame)}: min ${fmt(temp.minCelsius)} °C, max ${fmt(temp.maxCelsius)} °C, centre ${fmt(temp.centreCelsius)} °C`,
      `- Whole capture: min ${fmt(temp.series.minCelsius)} °C, max ${fmt(temp.series.maxCelsius)} °C; centre mean ${fmt(temp.series.centre.mean, 2)} °C, sd ${fmt(temp.series.centre.sd, 3)} K`,
    );
    if (temp.referenceCelsius !== null && temp.referenceDiff !== null) {
      lines.push(
        `- Android app centre reading: ${fmt(temp.referenceCelsius)} °C; difference ${signed(temp.referenceDiff, 1)} K; within ±2 °C: ${yesNo(Math.abs(temp.referenceDiff) <= 2)}`,
      );
    }
  } else {
    lines.push('- Lower half: this mode carries no temperature data');
  }
  const up = r.upper;
  lines.push(
    `- Upper half (${String(up.samples)} frames): ${upperVerdict(up)}; Y ${String(up.y.min)}–${String(up.y.max)}; U mean ${fmt(up.u.mean)} (${fmt(up.u.min, 0)}–${fmt(up.u.max, 0)}), V mean ${fmt(up.v.mean)} (${fmt(up.v.min, 0)}–${fmt(up.v.max, 0)}); U/V within 128 ± ${String(NEUTRAL_UV)}: ${fmt(up.neutralShare * 100)} %` +
      (up.spearman
        ? `; Spearman(Y, raw) median ${fmt(up.spearman.median, 3)} (${fmt(up.spearman.min, 3)} to ${fmt(up.spearman.max, 3)})`
        : ''),
  );
  if (r.noise) {
    lines.push(
      `- Noise (a NETD estimate only for a static scene): median ${fmt(r.noise.medianMk, 0)} mK, mean ${fmt(r.noise.meanMk, 0)} mK, ${fmt(r.noise.medianDetrendedMk, 0)} mK without the frame mean; frames ${String(r.noise.firstFrame)}–${String(r.noise.firstFrame + r.noise.frames - 1)}`,
    );
  } else if (r.temperatures) {
    lines.push(`- Noise: fewer than ${String(NOISE_MIN_FRAMES)} frames without events`);
  }
  if (r.temperatures) {
    if (r.nucEvents.length === 0) lines.push('- NUC events: none detected');
    else {
      lines.push(`- NUC events: ${String(r.nucEvents.length)}`);
      for (const ev of r.nucEvents.slice(0, 20)) {
        lines.push(
          `  - ${fmt(ev.timeMs / 1000, 2)} s (frame ${String(ev.frame)}): ${ev.kind}, ${String(ev.frames)} frame(s), mean step ${ev.stepKelvin === null ? 'n/a' : `${signed(ev.stepKelvin)} K`}`,
        );
      }
      if (r.nucEvents.length > 20) lines.push(`  - and ${String(r.nucEvents.length - 20)} more`);
    }
  }
  if (temp && temp.histogram.length > 0) {
    const most = Math.max(...temp.histogram.map((b) => b.count));
    lines.push('', `Histogram of frame ${String(temp.previewFrame)} (°C):`, '', '```');
    for (const bin of temp.histogram) {
      const bar = '#'.repeat(Math.round((bin.count / most) * 40));
      lines.push(
        `${fmt(bin.from, 0).padStart(5)} to ${fmt(bin.to, 0).padStart(5)} ${String(bin.count).padStart(6)} ${bar}`,
      );
    }
    lines.push('```');
  }
  return `${lines.join('\n')}\n`;
}

export async function readPackets(dir: string): Promise<Framecrc | null> {
  try {
    return parseFramecrc(await readFile(join(dir, PACKETS_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/** Reads a capture directory, writes report.md, report.json and the previews into it. */
export async function reportCapture(
  dir: string,
  name: string,
  options: AnalyseOptions = {},
): Promise<{ report: CaptureReport; markdown: string }> {
  const meta = await readMeta(dir);
  if (meta.frames.length === 0) {
    throw new CliError(`${dir} has no frames; see ${join(dir, 'ffmpeg.log')}`);
  }
  const { report, previews } = await analyse(
    meta,
    await readPackets(dir),
    directorySource(dir, meta),
    options,
  );
  const markdown = formatReport(report, name);
  await writeFile(join(dir, 'report.md'), markdown);
  await writeFile(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (previews) {
    const { image, thermal } = previews;
    await writeFile(join(dir, 'preview-image.pgm'), pgm(image.width, image.height, image.y));
    await writeFile(join(dir, 'preview-image.png'), png(image.width, image.height, image.y));
    if (thermal) {
      await writeFile(
        join(dir, 'preview-thermal.pgm'),
        pgm(thermal.width, thermal.height, thermal.raw),
      );
      await writeFile(
        join(dir, 'preview-thermal.png'),
        png(thermal.width, thermal.height, stretch(thermal.raw)),
      );
    }
  }
  return { report, markdown };
}

/** Answers to the acceptance questions of the M1 spike, over every capture of a session. */
export function formatSummary(reports: readonly { name: string; report: CaptureReport }[]): string {
  const thermal = reports.filter((r) => r.report.temperatures !== null);
  const lines = ['### Summary', ''];
  lines.push(
    '| Capture | Mode | Frames | Exact size | fps (arrival) | First frame | Centre | Android | Difference |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const { name, report: r } of reports) {
    const t = r.temperatures;
    lines.push(
      `| ${r.label ?? name} | ${r.mode.id} | ${String(r.frames)} | ${yesNo(r.frameSize.exact)} | ${fmt(r.timing.fpsArrival, 2)} | ${fmt(r.timing.firstFrameMs, 0)} ms | ${t ? `${fmt(t.series.centre.mean)} °C` : 'n/a'} | ${t?.referenceCelsius == null ? 'n/a' : `${fmt(t.referenceCelsius)} °C`} | ${t?.referenceDiff == null ? 'n/a' : `${signed(t.referenceDiff, 1)} K`} |`,
    );
  }
  const allExact = reports.every((r) => r.report.frameSize.exact);
  const swapped = reports.filter(
    (r) => r.report.pixelFormat !== null && r.report.pixelFormat !== REQUESTED_PIXEL_FORMAT,
  );
  const works =
    thermal.length > 0 &&
    thermal.every((r) => r.report.frameSize.exact && r.report.temperatures?.plausible);
  const formats = [...new Set(reports.map((r) => r.report.pixelFormat ?? 'unknown'))].join(', ');
  // With another byte order the lower half cannot look like temperatures, but
  // that says nothing about whether the mode needs a command.
  const answer384 =
    thermal.length === 0
      ? 'not captured'
      : swapped.some((r) => r.report.temperatures !== null)
        ? `unknown: AVFoundation delivered ${formats}, not ${REQUESTED_PIXEL_FORMAT}, so the bytes were not in the camera's order`
        : yesNo(works);
  const compared = thermal.filter((r) => r.report.temperatures?.referenceDiff != null);
  const within = compared.filter(
    (r) => Math.abs(r.report.temperatures?.referenceDiff ?? Infinity) <= 2,
  );
  const first = thermal[0]?.report.upper;
  lines.push(
    '',
    `- Every frame has the expected size: ${yesNo(allExact)}`,
    `- Pixel format AVFoundation delivered: ${formats}`,
    `- The 384 mode delivers temperature data without any command: ${answer384}`,
    `- Upper half: ${first ? upperVerdict(first) : 'not captured'}`,
    `- Agreement with the Android app within ±2 °C: ${compared.length === 0 ? 'no readings entered' : `${String(within.length)} of ${String(compared.length)}`}`,
  );
  return `${lines.join('\n')}\n`;
}

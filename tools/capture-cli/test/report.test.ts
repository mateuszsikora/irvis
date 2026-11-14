import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reportCommand, setReference } from '../src/commands.ts';
import { reportCapture } from '../src/report.ts';
import { writeSyntheticCapture } from './synthetic.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'capture-cli-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('report', () => {
  it('measures a synthetic 384 capture', async () => {
    await writeSyntheticCapture(dir, {
      frames: 100,
      mode: '384',
      frozen: [45, 5],
      stepKelvin: 0.3,
      referenceCelsius: 34,
    });
    const { report, markdown } = await reportCapture(dir, 'hand');

    expect(report.frames).toBe(100);
    expect(report.frameSize.exact).toBe(true);
    expect(report.frameSize.packetSizes).toEqual({ '196608': 100 });
    expect(report.timing.fpsArrival).toBeCloseTo(25, 6);
    expect(report.timing.fpsPts).toBeCloseTo(25, 6);
    expect(report.timing.lateArrivals).toBe(0);
    expect(report.timing.missingByPts).toBe(0);

    const t = report.temperatures;
    expect(t?.plausible).toBe(true);
    expect(t?.previewFrame).toBe(50);
    expect(t?.minCelsius).toBeCloseTo(22.5, 0);
    expect(t?.maxCelsius).toBeCloseTo(35.1, 0);
    expect(t?.centreCelsius).toBeCloseTo(35, 0);
    expect(t?.referenceDiff).toBeCloseTo(1.2, 0);

    expect(report.upper.neutralShare).toBe(1);
    expect(report.upper.spearman?.median).toBeGreaterThan(0.9);

    expect(report.nucEvents).toHaveLength(1);
    const [event] = report.nucEvents;
    expect(event?.kind).toBe('frozen');
    expect(event?.frame).toBe(44);
    expect(event?.frames).toBe(6);
    expect(event?.stepKelvin).toBeCloseTo(0.3, 1);

    // Uniform integer noise from −4 to 4: sd 2.58 raw units, 40 mK.
    expect(report.noise?.frames).toBe(49);
    expect(report.noise?.medianMk).toBeGreaterThan(35);
    expect(report.noise?.medianMk).toBeLessThan(46);

    expect(markdown).toContain('every frame 196608 B: yes');
    expect(markdown).toContain(
      'greyscale (U and V within 128 ± 2); brightness rises with temperature',
    );
    expect(markdown).toContain('within ±2 °C: yes');
    expect(markdown).toContain('frozen, 6 frame(s)');
    for (const file of ['report.md', 'report.json', 'preview-image.png', 'preview-thermal.pgm']) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
  });

  it('finds a flat run as a NUC event', async () => {
    await writeSyntheticCapture(dir, { frames: 60, mode: '384', flat: [20, 5] });
    const { report } = await reportCapture(dir, 'flat');
    expect(report.nucEvents.map((e) => [e.kind, e.frame, e.frames])).toEqual([['flat', 20, 5]]);
    expect(report.noise?.frames).toBe(34);
  });

  it('finds a step of the mean as a NUC event', async () => {
    await writeSyntheticCapture(dir, { frames: 60, mode: '384', stepAt: 30, stepKelvin: 1 });
    const { report } = await reportCapture(dir, 'step');
    expect(report.nucEvents).toHaveLength(1);
    const [event] = report.nucEvents;
    expect(event?.kind).toBe('step');
    expect(event?.frame).toBe(30);
    expect(event?.stepKelvin).toBeCloseTo(1, 1);
  });

  it('flags packets of the wrong size', async () => {
    await writeSyntheticCapture(dir, { frames: 30, mode: '384', packetSize: 196616 });
    const { report, markdown } = await reportCapture(dir, 'room');
    expect(report.frameSize.exact).toBe(false);
    expect(markdown).toContain('every frame 196608 B: no (packets: 196616 B × 30');
  });

  it('reports a mode without temperature data', async () => {
    await writeSyntheticCapture(dir, { frames: 10, mode: '192', noPackets: true });
    const { report, markdown } = await reportCapture(dir, 'mode-192');
    expect(report.temperatures).toBeNull();
    expect(report.noise).toBeNull();
    expect(report.frameSize.packetSizes).toBeNull();
    expect(markdown).toContain('this mode carries no temperature data');
    expect(existsSync(join(dir, 'preview-thermal.png'))).toBe(false);
  });

  it('summarises a session directory', async () => {
    await writeSyntheticCapture(join(dir, 'hand'), { frames: 30, mode: '384' });
    await writeSyntheticCapture(join(dir, 'mode-192'), { frames: 5, mode: '192' });
    await setReference(join(dir, 'hand'), 30);
    const markdown = await reportCommand(dir, undefined);
    expect(markdown).toContain('### Summary');
    expect(markdown).toContain('- Every frame has the expected size: yes');
    expect(markdown).toContain('- The 384 mode delivers temperature data without any command: yes');
    expect(markdown).toContain('- Agreement with the Android app within ±2 °C: 0 of 1');
    expect(await readFile(join(dir, 'report.md'), 'utf8')).toBe(markdown);
  });

  it('does not answer the 384 question when AVFoundation changed the format', async () => {
    await writeSyntheticCapture(join(dir, 'room'), {
      frames: 30,
      mode: '384',
      pixelFormat: 'uyvy422',
    });
    await mkdir(join(dir, 'broken'));
    await writeFile(join(dir, 'broken', 'meta.json'), '{ not json');
    const markdown = await reportCommand(dir, undefined);
    expect(markdown).toContain('- Pixel format AVFoundation delivered: uyvy422');
    expect(markdown).toContain(
      "- The 384 mode delivers temperature data without any command: unknown: AVFoundation delivered uyvy422, not yuyv422, so the bytes were not in the camera's order",
    );
    expect(markdown).toContain('- Pixel format: uyvy422, not yuyv422');
    expect(markdown).toContain(`No report: ${join(dir, 'broken', 'meta.json')} is not valid JSON:`);
  });
});

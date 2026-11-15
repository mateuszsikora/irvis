import { cpus } from 'node:os';
import {
  compareFrames,
  reconstructPlanar,
  simulateYUYVtoI420,
} from '../../src/reconstruction/index.ts';
import { scene } from '../reconstruction-scenes.ts';
const options = { thermal: { firstRow: 192, rows: 192 }, image: { firstRow: 0, rows: 192 } };
const cpu = cpus()[0]?.model ?? 'unknown';
console.log(
  JSON.stringify({
    cpu,
    node: process.version,
    dimensions: '256x192',
    timingTargetHardware: 'Apple M1/M2',
    timingComparable: /Apple M[12]\b/.test(cpu),
    warmups: 3,
    timedRuns: 3,
  }),
);
const warmup = simulateYUYVtoI420(scene('hand').frame);
for (let i = 0; i < 3; i++) reconstructPlanar(warmup, options);
for (const name of ['background', 'hand', 'tip', 'checkerboard', 'random']) {
  for (let seed = 1; seed <= (name === 'random' ? 20 : 1); seed++)
    for (const blur of [false, true])
      for (const garbage of [false, true]) {
        const s = scene(name, 256, 192, seed, blur, garbage),
          planar = simulateYUYVtoI420(s.frame);
        const times: number[] = [];
        let result = reconstructPlanar(planar, options);
        for (let repeat = 0; repeat < 3; repeat++) {
          const start = performance.now();
          result = reconstructPlanar(planar, options);
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        const metrics = compareFrames(
          s.raw,
          result.raw,
          planar,
          options.thermal,
          1 / 64,
          times[1]!,
        );
        const targets = {
          time: metrics.milliseconds <= 30,
          flat: metrics.flatRegionMatch === null ? null : metrics.flatRegionMatch >= 0.999,
          p99: metrics.p99AbsoluteError <= 0.5,
        };
        console.log(
          JSON.stringify({
            scene: s.name,
            hintEnabled: result.hint.enabled,
            rSquared: result.hint.rSquared,
            ...metrics,
            targets,
            verdict: Object.values(targets).every((v) => v === true) ? 'PASS' : 'FAIL',
          }),
        );
      }
}

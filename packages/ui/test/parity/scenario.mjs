import {
  IrvisReader,
  memoryByteSource,
  celsiusImage,
  DEFAULT_CORRECTION,
  measureFrame,
  measurePoint,
  measureLine,
  measureArea,
  histogram,
} from '@irvis/core';
import { openRecording } from '@irvis/backend-replay';
import { analyze, initialAnalysis } from '../../src/measurements.ts';

// Encode every number as IEEE-754 binary64, including -0 and non-finite values.
// Explicit endianness makes the JSON independent of host byte order.
export function exactJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number') {
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, item, false);
      return {
        f64: Array.from(new Uint8Array(view.buffer), (b) => b.toString(16).padStart(2, '0')).join(
          '',
        ),
      };
    }
    if (ArrayBuffer.isView(item)) return Array.from(item);
    return item;
  });
}

export async function scenario(bytes) {
  const source = memoryByteSource(new Uint8Array(bytes));
  const reader = await IrvisReader.open(source);
  const player = await openRecording(source);
  const frames = [];
  const results = [];
  try {
    // Forward and backward seeks exercise player delivery rather than just the codec.
    const order = [...reader.frames.keys(), 0, reader.frameCount - 1];
    for (const index of order) {
      const frame = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('Replay delivery timed out'));
        }, 10000);
        const offFrame = player.frames.subscribe((frame) => {
          cleanup();
          resolve(frame);
        });
        const offError = player.errors.subscribe((error) => {
          cleanup();
          reject(error);
        });
        function cleanup() {
          clearTimeout(timer);
          offFrame();
          offError();
        }
        player.seek(reader.frames[index].timestamp - reader.frames[0].timestamp);
      });
      frames.push(frame);
      const readings = [
        DEFAULT_CORRECTION,
        { emissivity: 0.73, reflectedCelsius: 18, offsetKelvin: 1.25 },
      ].map((correction) => {
        const image = celsiusImage(frame, correction);
        return {
          celsius: image.celsius,
          frame: measureFrame(image),
          point: measurePoint(image, { x: 128, y: 96 }),
          edge: measurePoint(image, { x: 0, y: 0 }),
          line: measureLine(image, { x: 0, y: 191 }, { x: 255, y: 0 }),
          area: measureArea(image, { x: 41, y: 23, width: 117, height: 89 }),
          histogram: histogram(image, { minCelsius: 15, maxCelsius: 40 }, 32),
        };
      });
      const image = celsiusImage(frame, DEFAULT_CORRECTION);
      const ui = Object.fromEntries(
        ['C', 'F', 'K'].map((unit) => [
          unit,
          analyze(image, {
            ...initialAnalysis,
            unit,
            tracking: { min: true, max: true, centre: true },
          }).text,
        ]),
      );
      results.push({ index, exact: exactJson({ frame, readings }), ui });
    }
    return { results, frames };
  } finally {
    player.close();
  }
}

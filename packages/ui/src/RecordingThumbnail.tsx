import { useEffect, useRef, useState } from 'react';
import {
  IrvisReader,
  toCelsiusArray,
  autoRange,
  renderPalette,
  type ByteSource,
} from '@irvis/core';
export function RecordingThumbnail({ source }: { source: ByteSource }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const reader = await IrvisReader.open(source);
        if (!reader.frames.length) throw new Error('No complete frames');
        const { frame } = await reader.readFrame(0);
        if (!alive || !canvas.current) return;
        const celsius = toCelsiusArray(frame.raw, frame.conversion);
        const range = autoRange({ ...frame, celsius }) ?? { minCelsius: 20, maxCelsius: 40 };
        canvas.current.width = frame.width;
        canvas.current.height = frame.height;
        canvas.current
          .getContext('2d')
          ?.putImageData(
            new ImageData(renderPalette(celsius, range, 'iron'), frame.width, frame.height),
            0,
            0,
          );
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [source]);
  return (
    <>
      <canvas ref={canvas} aria-label="Recording preview" className="recording-thumbnail" />
      {error && <span>Preview unavailable: {error}. Try opening the recording.</span>}
    </>
  );
}

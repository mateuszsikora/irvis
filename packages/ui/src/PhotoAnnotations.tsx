import { useEffect, useRef, useState } from 'react';
import { fileByteSource, saveRecordingFile } from '@irvis/media';
import type { SavedPhoto } from './photos.ts';
type Mark = { color: string; size: number; points: { x: number; y: number }[]; text: string };
export function PhotoAnnotations({ photo }: { photo: SavedPhoto }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const original = useRef<HTMLImageElement | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [redo, setRedo] = useState<Mark[]>([]);
  const [color, setColor] = useState('#ff0000');
  const [size, setSize] = useState(3);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const drawing = useRef(false);
  useEffect(() => {
    let active = true;
    const url = URL.createObjectURL(new Blob([photo.bytes.slice().buffer], { type: 'image/png' }));
    const img = new Image();
    img.onload = () => {
      if (!active || !canvas.current) return;
      original.current = img;
      canvas.current.width = img.naturalWidth;
      canvas.current.height = img.naturalHeight;
      setMarks([]);
      setRedo([]);
    };
    img.onerror = () => {
      if (active) setError('Photo preview could not be loaded.');
    };
    img.src = url;
    return () => {
      active = false;
      URL.revokeObjectURL(url);
      original.current = null;
    };
  }, [photo]);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    const image = original.current;
    if (!context || !image) return;
    context.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
    context.drawImage(image, 0, 0);
    for (const mark of marks) {
      context.strokeStyle = mark.color;
      context.fillStyle = mark.color;
      context.lineWidth = mark.size;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      const first = mark.points[0]!;
      if (mark.text) {
        context.font = `${mark.size * 4}px sans-serif`;
        context.fillText(mark.text, first.x, first.y);
      } else {
        context.beginPath();
        context.moveTo(first.x, first.y);
        for (const point of mark.points) context.lineTo(point.x, point.y);
        context.stroke();
      }
    }
  }, [marks]);
  return (
    <section aria-label="Photo annotations">
      <h4>Annotate {photo.name}</h4>
      <p>
        Export creates a separate flattened PNG without temperature data. Keep the original for
        temperature analysis.
      </p>
      <label>
        Annotation colour
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <label>
        Annotation size
        <input
          type="range"
          min="1"
          max="12"
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        />
      </label>
      <label>
        Annotation text (empty to draw)
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <canvas
        ref={canvas}
        aria-label="Annotation canvas"
        style={{ maxWidth: '100%', touchAction: 'none' }}
        onPointerDown={(e) => {
          const c = e.currentTarget;
          const r = c.getBoundingClientRect();
          const point = {
            x: ((e.clientX - r.left) * c.width) / r.width,
            y: ((e.clientY - r.top) * c.height) / r.height,
          };
          c.setPointerCapture(e.pointerId);
          drawing.current = !text;
          setMarks((items) => [...items, { color, size, text, points: [point] }]);
          setRedo([]);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const c = e.currentTarget;
          const r = c.getBoundingClientRect();
          const point = {
            x: ((e.clientX - r.left) * c.width) / r.width,
            y: ((e.clientY - r.top) * c.height) / r.height,
          };
          setMarks((items) =>
            items.map((mark, i) =>
              i === items.length - 1 ? { ...mark, points: [...mark.points, point] } : mark,
            ),
          );
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <button
        disabled={!marks.length}
        onClick={() => {
          setRedo((items) => [...items, marks.at(-1)!]);
          setMarks((items) => items.slice(0, -1));
        }}
      >
        Undo annotation
      </button>
      <button
        disabled={!redo.length}
        onClick={() => {
          setMarks((items) => [...items, redo.at(-1)!]);
          setRedo((items) => items.slice(0, -1));
        }}
      >
        Redo annotation
      </button>
      <button
        onClick={() => {
          canvas.current?.toBlob((blob) => {
            if (blob)
              void saveRecordingFile(
                photo.name.replace(/\.png$/, '-annotated-flat.png'),
                fileByteSource(blob),
              ).catch((e) => setError(String(e)));
          }, 'image/png');
        }}
      >
        Export flattened PNG
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

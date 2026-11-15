import { useEffect, useRef, useState } from 'react';
import type { VideoMode } from '@irvis/core';
import type { Analysis } from '@irvis/backend-browser';
import { compare, desktopBridge, type ReferenceFrame } from '@irvis/backend-electron';

function save(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(value, (_key, v: unknown) =>
          ArrayBuffer.isView(v) && !(v instanceof DataView) ? Array.from(v as Uint8Array) : v,
        ),
      ],
      { type: 'application/json' },
    ),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Comparison({
  profileId,
  mode,
  live,
}: {
  profileId: string;
  mode: VideoMode;
  live: Analysis | undefined;
}) {
  const bridge = desktopBridge();
  const [device, setDevice] = useState(0);
  const [variant, setVariant] = useState('simulation');
  const [scale, setScale] = useState(1 / 64);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Reference capture is stopped.');
  const [pair, setPair] = useState<ReturnType<typeof compare>>();
  const latest = useRef<{ value: Analysis; at: number } | undefined>(undefined);
  const reference = useRef<ReferenceFrame | undefined>(undefined);
  const samples = useRef<unknown[]>([]);
  const generation = useRef(0);
  useEffect(() => {
    latest.current = live ? { value: live, at: Date.now() } : undefined;
  }, [live]);
  useEffect(() => {
    const unsubscribe = bridge?.subscribe(
      (frame) => {
        try {
          const browser = latest.current;
          if (variant === 'live' && (!browser || Math.abs(frame.receivedAt - browser.at) > 500)) {
            setStatus(
              'Waiting for a browser frame received within 500 ms. Start browser diagnostics too.',
            );
            return;
          }
          const next = compare(
            frame,
            mode,
            scale,
            variant === 'live' ? browser!.value.frame : undefined,
          );
          reference.current = frame;
          setPair(next);
          if (samples.current.length < 100)
            samples.current.push({
              variant: next.variant,
              metrics: next.metrics,
              referenceStatistics: next.referenceStatistics,
              referenceReceivedAt: frame.receivedAt,
              browserReceivedAt: variant === 'live' ? browser!.at : null,
              referenceTimestamp: frame.timestamp,
              browserTimestamp: variant === 'live' ? browser!.value.frame.timestamp : null,
              browserStatistics: variant === 'live' ? browser!.value.statistics : null,
            });
          setStatus('Comparison captured. Live pairs are unsynchronized; use a static scene.');
        } catch (error) {
          setStatus(String(error));
        }
      },
      (message) => {
        setStatus(message);
        setRunning(false);
      },
    );
    return () => {
      generation.current++;
      unsubscribe?.();
      void bridge?.stop();
    };
  }, [bridge, mode, scale, variant]);
  async function start() {
    const token = ++generation.current;
    samples.current = [];
    setPair(undefined);
    reference.current = undefined;
    setRunning(true);
    try {
      await bridge?.start({ profileId, modeId: mode.id, device });
      if (token !== generation.current) await bridge?.stop();
    } catch (error) {
      setStatus(String(error));
      setRunning(false);
    }
  }
  if (!bridge) return null;
  const report = () => ({
    version: 1,
    userAgent: navigator.userAgent,
    profileId,
    modeId: mode.id,
    kelvinsPerRaw: scale,
    variant,
    status,
    samples: samples.current,
    pairing:
      'Latest received browser frame, maximum arrival gap 500 ms; not exposure synchronized.',
    verdict: 'pending hardware review',
    sampleLimit: 100,
  });
  return (
    <section>
      <h2>Desktop comparison — M3</h2>
      <p>
        For live comparison, start browser diagnostics on the same camera and mode first. Stop
        reference capture before changing the profile mode. Keep the scene static.
      </p>
      <label>
        ffmpeg device index{' '}
        <input
          type="number"
          min="0"
          disabled={running}
          value={device}
          onChange={(e) => {
            setPair(undefined);
            samples.current = [];
            setDevice(Number(e.target.value));
          }}
        />
      </label>{' '}
      <label>
        Comparison{' '}
        <select
          disabled={running}
          value={variant}
          onChange={(e) => {
            setPair(undefined);
            samples.current = [];
            setVariant(e.target.value);
          }}
        >
          <option value="simulation">Simulation</option>
          <option value="live">Live static scene</option>
        </select>
      </label>{' '}
      <label>
        Kelvins per raw unit (confirm camera gain){' '}
        <input
          type="number"
          min="0.000001"
          step="any"
          disabled={running}
          value={scale}
          onChange={(e) => {
            setPair(undefined);
            samples.current = [];
            setScale(Number(e.target.value));
          }}
        />
      </label>{' '}
      <button
        disabled={running || !Number.isFinite(scale) || scale <= 0}
        onClick={() => {
          void start();
        }}
      >
        Start reference
      </button>{' '}
      <button
        disabled={!running}
        onClick={() => {
          generation.current++;
          void bridge.stop();
          setRunning(false);
          setStatus('Stopped.');
        }}
      >
        Stop reference
      </button>
      <p role="status">{status}</p>
      {pair && <pre aria-label="Comparison metrics">{JSON.stringify(pair.metrics, null, 2)}</pre>}
      <button disabled={!pair} onClick={() => save('report.json', report())}>
        Download comparison report
      </button>{' '}
      <button
        disabled={!pair}
        onClick={() => save('frame-pair.json', { ...report(), reference: reference.current, pair })}
      >
        Download frame pair
      </button>
    </section>
  );
}

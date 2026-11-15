import { useEffect, useRef, useState } from 'react';
import { cameraProfiles, type CameraProfile } from '@irvis/core';
import {
  deviceKey,
  errorMessage,
  startDiagnostics,
  type Analysis,
  type FrameMetadata,
} from '@irvis/backend-browser';

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, name === 'm3-planar.json' ? undefined : 2)], {
      type: 'application/json',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function savedDevice() {
  try {
    return localStorage.getItem(deviceKey) ?? '';
  } catch {
    return '';
  }
}
export function Diagnostics({
  profiles = cameraProfiles,
}: {
  profiles?: readonly CameraProfile[];
}) {
  const [device, setDevice] = useState(savedDevice);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selection, setSelection] = useState(0);
  const choices = profiles.flatMap((profile) =>
    (profile.videoModes ?? []).filter((mode) => mode.layout).map((mode) => ({ profile, mode })),
  );
  const selected = choices[selection];
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('Choose a camera, then start diagnostics.');
  const [info, setInfo] = useState<FrameMetadata>();
  const [result, setResult] = useState<Analysis>();
  const [fps, setFps] = useState(0);
  const [session, setSession] = useState({
    frames: 0,
    first: 0,
    last: 0,
    startedAt: '',
    profileId: '',
    modeId: '',
  });
  const stop = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stop.current?.(), []);
  async function refresh() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'videoinput'));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }
  function start() {
    if (!selected) return;
    stop.current?.();
    setResult(undefined);
    setInfo(undefined);
    setFps(0);
    setRunning(true);
    setMessage('Waiting for camera permission and frames.');
    const currentSession = {
      frames: 0,
      first: 0,
      last: 0,
      startedAt: new Date().toISOString(),
      profileId: selected.profile.id,
      modeId: selected.mode.id,
    };
    setSession(currentSession);
    stop.current = startDiagnostics(selected.mode, device, {
      metadata: setInfo,
      error: (error) => {
        setMessage(error);
        setRunning(false);
      },
      result: (next) => {
        const s = currentSession;
        if (s.frames === 0) {
          s.first = next.frame.timestamp;
          void refresh();
        }
        s.frames++;
        s.last = next.frame.timestamp;
        setFps(s.last > s.first ? ((s.frames - 1) * 1000) / (s.last - s.first) : 0);
        setSession({ ...s });
        setResult(next);
        setMessage('Reconstruction is experimental; accuracy is not verified.');
      },
    });
  }
  const report = () => ({
    version: 1,
    userAgent: navigator.userAgent,
    ...session,
    processedFps: fps,
    metadata: info,
    status: message,
    statistics: result?.statistics,
    reconstructionMs: result?.reconstructionMs,
    reference: 'none; compare static-scene statistics with capture-cli',
  });
  return (
    <section aria-labelledby="diagnostics-title">
      <h2 id="diagnostics-title">Browser diagnostics — M3</h2>
      <p>
        Use a static scene and run capture-cli alongside this page. No exact reference is available
        here.
      </p>
      <label>
        Profile mode{' '}
        <select
          disabled={running}
          value={selection}
          onChange={(e) => setSelection(Number(e.target.value))}
        >
          {choices.map(({ profile, mode }, i) => (
            <option key={`${profile.id}/${mode.id}`} value={i}>
              {profile.name} — {mode.id} ({mode.fps} fps)
            </option>
          ))}
        </select>
      </label>{' '}
      <button
        disabled={running}
        onClick={() => {
          void refresh();
        }}
      >
        Refresh cameras
      </button>{' '}
      <label>
        Camera{' '}
        <select
          disabled={running}
          value={device}
          onChange={(e) => {
            setDevice(e.target.value);
            try {
              localStorage.setItem(deviceKey, e.target.value);
            } catch {
              /* Storage may be disabled. */
            }
          }}
        >
          <option value="">Default camera</option>
          {device && !devices.some((d) => d.deviceId === device) && (
            <option value={device}>Saved camera</option>
          )}
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Camera ${i + 1}`}
            </option>
          ))}
        </select>
      </label>{' '}
      <button disabled={running || !selected} onClick={start}>
        Start diagnostics
      </button>{' '}
      <button
        disabled={!running}
        onClick={() => {
          stop.current?.();
          setRunning(false);
          setMessage('Stopped.');
        }}
      >
        Stop
      </button>
      <p role="status">{selected ? message : 'No thermal profile mode is available.'}</p>
      <p>
        Processed fps: {fps.toFixed(2)}; frames: {session.frames}
      </p>
      {info && <pre aria-label="Frame diagnostics">{JSON.stringify(info, null, 2)}</pre>}
      {result && (
        <pre aria-label="Reconstruction statistics">
          {JSON.stringify(
            {
              ...result.statistics,
              highByteHistogram: undefined,
              reconstructionMs: result.reconstructionMs,
            },
            null,
            2,
          )}
        </pre>
      )}
      <button disabled={!session.startedAt} onClick={() => download('m3-report.json', report())}>
        Download report
      </button>{' '}
      <button
        disabled={!result}
        onClick={() => {
          if (result)
            download('m3-planar.json', {
              ...report(),
              metadata: result.info,
              frame: { ...result.frame, data: Array.from(result.frame.data) },
            });
        }}
      >
        Download planar frame
      </button>
    </section>
  );
}

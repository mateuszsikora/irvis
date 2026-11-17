import { useEffect, useRef, useState } from 'react';
import {
  decodeYuyvRaw,
  toCelsius,
  type CameraProfile,
  type CameraStateSnapshot,
  type CameraSession,
  type VideoMode,
} from '@irvis/core';
import { SensorRangePolicy } from './sensor-range.ts';

export function CameraControls({
  profile,
  browser,
  command,
  cameraState,
  resetHostCorrection,
  frames,
  mode,
}: {
  profile: CameraProfile;
  browser: boolean;
  cameraState?: CameraStateSnapshot | undefined;
  resetHostCorrection?: (() => void) | undefined;
  frames?: CameraSession['frames'] | undefined;
  mode?: VideoMode | undefined;
  command?: ((id: string, value?: number) => Promise<void>) | undefined;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [automatic, setAutomatic] = useState(false);
  const policy = useRef(new SensorRangePolicy());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!automatic || browser || !command || !frames || !mode?.layout) return;
    let active = true;
    const unsubscribe = frames.subscribe((frame) => {
      if (!active || pending.current || frame.kind !== 'yuyv') return;
      const gain = frame.cameraState?.values['gain'];
      const conversion = profile.conversions.find((c) => c.gain === gain)?.conversion;
      if (typeof gain !== 'string' || !conversion) {
        policy.current.reset();
        return;
      }
      const raw = decodeYuyvRaw(frame, mode.layout!.thermal);
      let maximum = -Infinity;
      for (const value of raw) maximum = Math.max(maximum, toCelsius(value, conversion));
      const next = policy.current.observe(gain, maximum);
      if (next) void send(next, undefined, true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [automatic, browser, command, frames, mode, profile]);
  async function send(id: string, value?: number, keepAutomatic = false) {
    if (!command || browser || pending.current) return;
    pending.current = true;
    setBusy(true);
    setStatus('Waiting for camera confirmation…');
    if (id.startsWith('gain-') && !keepAutomatic) setAutomatic(false);
    try {
      if (id === 'reset-correction') {
        for (const [setting, requested] of [
          ['set-emissivity', 1],
          ['set-ambient-temperature', 298 - 273.15],
          ['set-reflected-temperature', 298 - 273.15],
        ] as const) {
          if (!alive.current) return;
          await command(setting, requested);
        }
        if (!alive.current) return;
        resetHostCorrection?.();
        setValues((old) => ({
          ...old,
          'set-emissivity': '1',
          'set-ambient-temperature': '24.85',
          'set-reflected-temperature': '24.85',
        }));
      } else await command(id, value);
      if (!alive.current) return;
      if (keepAutomatic) setAutomatic(true);
      setStatus('Camera command confirmed.');
    } catch (error) {
      setAutomatic(false);
      setStatus(String(error));
    } finally {
      policy.current.reset();
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="settings-disclosure">
      <summary>Camera commands</summary>
      <div className="command-controls" aria-busy={busy}>
        <p className="setting-help">
          Camera gain: {String(cameraState?.values['gain'] ?? 'unknown')}
        </p>
        {profile.commands.map((c) => {
          const parameter = c.parameter;
          const text =
            values[c.id] ?? (parameter ? String(Number(parameter.default.toFixed(5))) : '');
          const value = Number(text);
          const raw = parameter ? cameraState?.values[parameter.readback] : undefined;
          const invalid =
            !!parameter &&
            (text.trim() === '' ||
              !Number.isFinite(value) ||
              value < parameter.min ||
              value > parameter.max);
          return (
            <div key={c.id}>
              {parameter && (
                <label>
                  {c.label} {parameter.unit && '(' + parameter.unit + ')'}
                  <input
                    type="number"
                    min={parameter.min}
                    max={parameter.max}
                    step="any"
                    value={text}
                    disabled={browser || !command || busy}
                    onChange={(event) =>
                      setValues((old) => ({ ...old, [c.id]: event.target.value }))
                    }
                  />
                  <span className="setting-help">
                    Camera value:{' '}
                    {typeof raw === 'number' && parameter
                      ? Number(((raw - parameter.offset) / parameter.scale).toFixed(5))
                      : 'unknown'}
                    . Requested value resolution: {parameter.step} {parameter.unit}.
                  </span>
                </label>
              )}
              <button
                disabled={
                  browser || !command || busy || invalid || (automatic && c.id.startsWith('gain-'))
                }
                onClick={() => void send(c.id, parameter ? value : undefined)}
              >
                {parameter ? 'Apply ' + c.label.toLowerCase() : c.label}
              </button>
            </div>
          );
        })}
        {!profile.commands.some((c) => c.id === 'nuc') && (
          <>
            <button disabled>Manual NUC</button>
            <p className="setting-help">Manual NUC unavailable: no verified camera command.</p>
          </>
        )}
        {profile.id === 'infiray-p2pro' && (
          <>
            <p className="setting-help">Sensor range control: {automatic ? 'Auto' : 'Manual'}</p>
            <button
              disabled={browser || !command || !frames || !mode?.layout || busy || automatic}
              aria-pressed={automatic}
              onClick={() => void send('gain-high', undefined, true)}
            >
              Auto sensor range
            </button>
            <button
              disabled={browser || !command || busy || !automatic}
              aria-pressed={!automatic}
              onClick={() => {
                setAutomatic(false);
                policy.current.reset();
              }}
            >
              Manual sensor range
            </button>
            {mode && !mode.layout && (
              <p className="setting-help">Auto requires a video mode with temperature data.</p>
            )}
            <p className="setting-help">
              Low temperature range uses High gain; High temperature range uses Low gain. Auto
              starts in High gain and switches after 100 consecutive frames above 160 °C or below
              150 °C, with 100 settling frames after each command. It preserves your atmospheric
              transmittance. Stop or a command error ends Auto.
            </p>
            <p className="setting-help">
              High-gain readings above 160 °C and low-gain readings below 90 °C are marked uncertain
              and excluded from measurements. These limits follow the vendor display; they are not a
              calibration guarantee.
            </p>
            <fieldset disabled>
              <legend>Camera correction</legend>
              {['Distance', 'Temperature adjustment'].map((label) => (
                <button key={label}>{label}</button>
              ))}
            </fieldset>
            <button
              disabled={browser || !command || busy || !resetHostCorrection}
              onClick={() => void send('reset-correction')}
            >
              Reset camera correction
            </button>
            <p className="setting-help">
              Reset sets camera emissivity to 1, reflected and ambient temperatures to 24.85 °C (298
              K), and clears Host correction after all three writes are confirmed. It leaves
              transmittance and gain unchanged. A failed reset may leave some settings changed.
              Distance is unavailable pending hardware verification. Temperature adjustment is a
              software offset in Host correction, as in the Android app.
            </p>
            <p className="setting-help">
              Gain and correction settings are applied in the camera. On the tested TOOLTOP T7, they
              survive reopening the connection but reset when USB power is removed.
            </p>
          </>
        )}
        {browser ? (
          <p className="setting-help">
            available in the desktop app ·{' '}
            <a href="https://github.com/mateuszsikora/irvis/releases">Download desktop app</a>
          </p>
        ) : !command ? (
          <p className="setting-help">Camera commands are unavailable in this backend.</p>
        ) : null}
        <p role="status">{status}</p>
      </div>
    </details>
  );
}

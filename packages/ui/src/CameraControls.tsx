import { useRef, useState } from 'react';
import type { CameraProfile } from '@irvis/core';

export function CameraControls({
  profile,
  browser,
  command,
}: {
  profile: CameraProfile;
  browser: boolean;
  command?: ((id: string) => Promise<void>) | undefined;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  async function send(id: string) {
    if (!command || browser || pending.current) return;
    pending.current = true;
    setBusy(true);
    setStatus('Waiting for camera confirmation…');
    try {
      await command(id);
      setStatus('Camera command confirmed.');
    } catch (error) {
      setStatus(String(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="settings-disclosure">
      <summary>Camera commands</summary>
      <div className="command-controls" aria-busy={busy}>
        {profile.commands.map((c) => (
          <button key={c.id} disabled={browser || !command || busy} onClick={() => void send(c.id)}>
            {c.label}
          </button>
        ))}
        {!profile.commands.some((c) => c.id === 'nuc') && (
          <>
            <button disabled>Manual NUC</button>
            <p className="setting-help">Manual NUC unavailable: no verified camera command.</p>
          </>
        )}
        {profile.id === 'infiray-p2pro' && (
          <>
            <button disabled>Auto/Manual sensor range</button>
            <p className="setting-help">
              Auto/Manual sensor range unavailable: vendor Low/High mapping is unverified. Sensor
              gain is separate from the display range.
            </p>
            <p className="setting-help">
              Low gain has no verified temperature conversion. Readings and new recording frames are
              unavailable until high gain is restored.
            </p>
            <fieldset disabled>
              <legend>Camera correction</legend>
              {[
                'Emissivity',
                'Distance',
                'Reflected temperature',
                'Ambient temperature',
                'Atmospheric transmittance',
                'Temperature adjustment',
                'Reset camera correction',
              ].map((label) => (
                <button key={label}>{label}</button>
              ))}
            </fieldset>
            <p className="setting-help">
              Camera correction unavailable: units, persistence and interaction with software
              correction are unverified. Analysis settings apply software correction only.
            </p>
            <p className="setting-help">
              Gain is sent to the camera. Persistence after reconnect or power loss is unverified.
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

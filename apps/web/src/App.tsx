import { createPhotoLibrary } from './photo-library.ts';
import { cameraProfiles, type CameraProfile } from '@irvis/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewer, type PhotoLibrary } from '@irvis/ui';
import { createReplayBackend } from '@irvis/backend-replay';
import { liveBackend } from './viewer-backend.ts';
import './viewer.css';
import brandMark from './brand/mark.svg';
import brandWordmark from './brand/wordmark.svg';
import { Diagnostics } from './Diagnostics.tsx';

export interface AppProps {
  readonly profiles?: readonly CameraProfile[];
}
export function App({ profiles = cameraProfiles }: AppProps) {
  const photoLibrary = useMemo(
    () => (typeof indexedDB === 'undefined' ? undefined : createPhotoLibrary()),
    [],
  );
  const [source, setSource] = useState('demo');
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '');
  const profile = profiles.find((p) => p.id === profileId);
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <h1 className="brand-title">
            <picture aria-hidden="true">
              <source media="(max-width: 480px)" srcSet={brandMark} />
              <img src={brandWordmark} alt="" width="168" height="64" />
            </picture>
            <span className="visually-hidden">irvis</span>
          </h1>
          <span className="brand-description">Thermal studio</span>
        </div>
        <div className="app-source">
          <label className="select-field">
            <span>Source</span>
            <select
              aria-label="Source"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
              }}
            >
              <option value="demo">Demo</option>
              <option value="live">Live camera</option>
            </select>
          </label>
          <label className="select-field profile-select">
            <span>Camera profile</span>
            <select
              aria-label="Camera profile"
              value={profileId}
              onChange={(e) => {
                setProfileId(e.target.value);
              }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {profiles.length === 0 && <p>No camera is supported yet.</p>}
      {profile?.videoModes && (
        <SourceViewer
          key={`${source}-${profile.id}`}
          source={source}
          profile={profile}
          photoLibrary={photoLibrary}
        />
      )}
      <details className="diagnostics">
        <summary>
          Capture diagnostics <span>Advanced</span>
        </summary>
        <Diagnostics profiles={profiles} />
      </details>
    </main>
  );
}

/** Error state belongs to one mounted source/profile, including pending opens. */
function SourceViewer({
  source,
  profile,
  photoLibrary,
}: {
  source: string;
  profile: CameraProfile;
  photoLibrary: PhotoLibrary | undefined;
}) {
  const [error, setError] = useState('');
  const acceptsErrors = useRef(true);
  useEffect(() => {
    acceptsErrors.current = true;
    return () => {
      acceptsErrors.current = false;
    };
  }, []);
  const backend = useMemo(
    () =>
      source === 'demo'
        ? createReplayBackend()
        : liveBackend((message) => {
            if (acceptsErrors.current) setError(message);
          }),
    [source],
  );
  return (
    <Viewer
      backend={backend}
      profile={profile}
      captureError={error}
      {...(photoLibrary ? { photoLibrary } : {})}
    />
  );
}

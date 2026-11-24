import { desktopBridge, createDesktopRecordingStorage } from '@irvis/backend-electron';
import { createBrowserRecordingStorage, type RecordingStorage } from '@irvis/media';
import { createPhotoLibrary } from './photo-library.ts';
import { cameraProfiles, type CameraDevice, type CameraProfile } from '@irvis/core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, Viewer, type PhotoLibrary } from '@irvis/ui';
import { openRecording, createReplayBackend } from '@irvis/backend-replay';
import { liveBackend, listLiveCameras } from './viewer-backend.ts';
import './viewer.css';
import brandMark from './brand/mark.svg';
import brandWordmark from './brand/wordmark.svg';
import { Diagnostics } from './Diagnostics.tsx';

export interface AppProps {
  readonly profiles?: readonly CameraProfile[];
}
const DEMO = 'demo';
/** The replay backend's only device. */
const DEMO_DEVICE = 'demo';
const CAMERA = 'camera:';
const MISSING = 'missing';
/**
 * The chosen camera in the latest list. AVFoundation and V4L2 ids are list
 * positions that shift when a device comes or goes, so the id counts only with
 * the same label; otherwise the camera is found by its label if that is unique.
 * Two cameras with the same name cannot be told apart this way.
 */
function findCamera(list: readonly CameraDevice[], chosen: CameraDevice) {
  const same = list.find((c) => c.id === chosen.id && c.label === chosen.label);
  if (same) return same;
  if (!chosen.label) return undefined;
  const named = list.filter((c) => c.label === chosen.label);
  return named.length === 1 ? named[0] : undefined;
}
export function App({ profiles = cameraProfiles }: AppProps) {
  const photoLibrary = useMemo(
    () => (typeof indexedDB === 'undefined' ? undefined : createPhotoLibrary()),
    [],
  );
  const recordingStorage = useMemo(() => {
    const bridge = desktopBridge();
    return bridge?.recordingStorage
      ? createDesktopRecordingStorage(bridge)
      : createBrowserRecordingStorage();
  }, []);
  /** null is Demo. */
  const [camera, setCamera] = useState<CameraDevice | null>(null);
  /** Counts Source choices, so that each choice mounts a fresh viewer. */
  const [choice, setChoice] = useState(0);
  const [cameras, setCameras] = useState<readonly CameraDevice[]>([]);
  const [cameraError, setCameraError] = useState('');
  const [listing, setListing] = useState(true);
  const [cameraRefresh, setCameraRefresh] = useState(0);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '');
  const [modeId, setModeId] = useState('');
  const profile = profiles.find((p) => p.id === profileId);
  const thermalModes = profile?.videoModes.filter((m) => m.layout) ?? [];
  const mode = thermalModes.find((m) => m.id === modeId) ?? thermalModes[0];
  useEffect(() => {
    let alive = true;
    setListing(true);
    listLiveCameras()
      .then((list) => {
        if (!alive) return;
        setCameras(list);
        // Track a camera found under a new id there, so the next refresh starts from it.
        setCamera((chosen) => (chosen && findCamera(list, chosen)) ?? chosen);
        setCameraError('');
      })
      .catch((e: unknown) => {
        if (alive) setCameraError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setListing(false);
      });
    return () => {
      alive = false;
    };
  }, [cameraRefresh]);
  const profilePicker = (
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
  );
  const current = camera && findCamera(cameras, camera);
  const source = current ? CAMERA + current.id : camera ? MISSING : DEMO;
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
                const value = e.target.value;
                if (value === MISSING) return;
                setCamera(cameras.find((c) => CAMERA + c.id === value) ?? null);
                setChoice((count) => count + 1);
              }}
            >
              <option value={DEMO}>Demo</option>
              {cameras.map((c) => (
                <option key={c.id} value={CAMERA + c.id}>
                  {c.label || c.id}
                </option>
              ))}
              {camera && !current && (
                <option value={MISSING}>{camera.label || camera.id} (disconnected)</option>
              )}
            </select>
          </label>
          <button
            type="button"
            className="refresh-cameras"
            aria-label="Refresh cameras"
            title="Refresh cameras"
            aria-busy={listing}
            disabled={listing}
            onClick={() => setCameraRefresh((value) => value + 1)}
          >
            <Icon name="refresh" />
          </button>
          <label className="select-field">
            <span>Video mode</span>
            <select
              aria-label="Video mode"
              value={mode?.id ?? ''}
              onChange={(e) => {
                setModeId(e.target.value);
              }}
            >
              {thermalModes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.width} × {m.height} · {m.fps} fps
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {cameraError && (
        <p className="notice error-notice" role="status">
          Cameras unavailable: {cameraError}
        </p>
      )}
      {profiles.length === 0 && <p>No camera is supported yet.</p>}
      {profile && (
        <SourceViewer
          // Choosing another source, camera, profile or mode closes the running capture;
          // a refresh that finds the camera under a new id does not.
          key={`${choice}-${profile.id}-${mode?.id ?? ''}`}
          live={camera !== null}
          device={camera ? (current?.id ?? '') : DEMO_DEVICE}
          modeId={mode?.id ?? ''}
          profile={profile}
          profilePicker={profilePicker}
          recordingStorage={recordingStorage}
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
  live,
  device,
  modeId,
  profile,
  profilePicker,
  photoLibrary,
  recordingStorage,
}: {
  recordingStorage: RecordingStorage;
  live: boolean;
  device: string;
  modeId: string;
  profile: CameraProfile;
  profilePicker: ReactNode;
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
      live
        ? liveBackend((message) => {
            if (acceptsErrors.current) setError(message);
          })
        : createReplayBackend(),
    [live],
  );
  return (
    <Viewer
      openRecording={openRecording}
      recordingStorage={recordingStorage}
      backend={backend}
      profile={profile}
      device={device}
      modeId={modeId}
      profilePicker={profilePicker}
      captureError={error}
      {...(photoLibrary ? { photoLibrary } : {})}
    />
  );
}

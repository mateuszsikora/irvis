import { recordedView } from './recorded-view.ts';
import { exportMp4, fileByteSource, saveRecordingFile } from '@irvis/media';
import { RecordingControls } from './RecordingControls.tsx';
import type { RecordingStorage } from '@irvis/media';
import type { ByteSource, RecordingPlayer } from '@irvis/core';
import { PhotoGallery } from './PhotoGallery.tsx';
import { photoCorrection, type PhotoLibrary } from './photos.ts';
import { AnalysisControls } from './AnalysisControls.tsx';
import { initialAnalysis } from './measurements.ts';
import { useEffect, useRef, useState } from 'react';
import {
  PALETTES,
  IrvisReader,
  memoryByteSource,
  unitSymbol,
  rangeProblems,
  type CameraBackend,
  type CameraProfile,
  type CameraSession,
  type RawFrame,
  type VideoMode,
  type SnapshotOptions,
} from '@irvis/core';
import { Icon } from './Icon.tsx';
import { FrameRenderer, type ViewSettings } from './render.ts';

export interface ViewerProps {
  photoLibrary?: PhotoLibrary;
  openRecording?: (source: ByteSource) => Promise<RecordingPlayer>;
  recordingStorage?: RecordingStorage;
  backend: CameraBackend;
  profile: CameraProfile;
  /** Only supply when the backend actually implements command dispatch. */
  captureError?: string;
  command?: (id: string) => Promise<void>;
}
export function Viewer({
  backend,
  profile,
  command,
  photoLibrary,
  recordingStorage,
  openRecording,
  captureError = '',
}: ViewerProps) {
  const [devices, setDevices] = useState<readonly { id: string; label: string }[]>([]);
  const [device, setDevice] = useState('');
  const [modeId, setModeId] = useState(profile.videoModes.find((m) => m.layout)?.id ?? '');
  const [session, setSession] = useState<CameraSession | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [orientationLock, setOrientationLock] = useState(false);
  const [rangeMode, setRangeMode] = useState('auto');
  const [lower, setLower] = useState('20');
  const [upper, setUpper] = useState('40');
  const [zoom, setZoom] = useState('1');
  const [settings, setSettings] = useState<ViewSettings>({
    palette: 'iron',
    range: null,
    locked: false,
    rotation: 0,
    mirrorX: false,
    mirrorY: false,
    smooth: false,
    uncertain: false,
    gain: 'high',
    analysis: initialAnalysis,
  });
  const playbackCorrectionOverride = useRef(false);
  const playbackRef = useRef<RecordingPlayer | null>(null);
  const rendererRef = useRef<FrameRenderer | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState('all');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryRevision, setGalleryRevision] = useState(0);
  const [photoStatus, setPhotoStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const [analysisRevision, setAnalysisRevision] = useState(0);
  async function capturePhoto() {
    if (!photoLibrary || !rendererRef.current) return;
    setSavingPhoto(true);
    setPhotoError('');
    setPhotoStatus('');
    setSaveError('');
    try {
      const bytes = await rendererRef.current.capturePhoto();
      const createdAt = Date.now();
      const id = crypto.randomUUID();
      const name = `irvis-${new Date(createdAt).toISOString().replaceAll(':', '-')}-${id.slice(0, 8)}.png`;
      await photoLibrary.save({ id, name, createdAt, bytes });
      setGalleryRevision((value) => value + 1);
      setGalleryOpen(true);
      setPhotoStatus(`Saved ${name}`);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSavingPhoto(false);
    }
  }
  const [triggered, setTriggered] = useState(false);
  const [photoName, setPhotoName] = useState('');
  const [photoError, setPhotoError] = useState('');
  const photoGeneration = useRef(0);
  const readouts = useRef<HTMLOutputElement>(null);
  const audio = useRef<AudioContext | null>(null);
  // Adapter capture errors belong to the camera, not a loaded photo.
  // Local errors (including photo rendering failures) still apply to the current view.
  const failure = error || (photoName ? '' : captureError);
  const sounding = settings.analysis!.alarm && triggered && (!!session || !!photoName) && !failure;
  useEffect(() => {
    if (!sounding || !audio.current) return;
    const context = audio.current;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    return () => {
      oscillator.stop();
      oscillator.disconnect();
      gain.disconnect();
    };
  }, [sounding]);
  useEffect(
    () => () => {
      playbackRef.current?.close();
      photoGeneration.current++;
      void audio.current?.close();
    },
    [],
  );
  async function openPhoto(file: Pick<File, 'name' | 'arrayBuffer'>) {
    const token = ++photoGeneration.current;
    setPhotoError('');
    try {
      const reader = await IrvisReader.open(
        memoryByteSource(new Uint8Array(await file.arrayBuffer())),
      );
      if (reader.frames.length !== 1)
        throw new Error('Choose a photo containing one thermal frame.');
      const { frame } = await reader.readFrame(0);
      if (token !== photoGeneration.current) return;
      await stop();
      playbackRef.current?.close();
      playbackRef.current = null;
      if (token !== photoGeneration.current) return;
      latest.current = {
        frame: { kind: 'thermal', frame },
        captureMetadata: {
          profile: reader.header.profile,
          fps: reader.header.fps,
          path: reader.header.path,
        },
        generation: generation.current,
        mode: profile.videoModes.find((m) => m.layout)!,
      };
      setSettings((s) => ({
        ...s,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
        analysis: {
          ...s.analysis!,
          objects: [],
          selected: null,
          correction: photoCorrection(reader.header.viewState),
          alarm: false,
        },
      }));
      setAnalysisRevision((value) => value + 1);
      setPhotoName(file.name);
      setHasFrame(true);
      setError('');
    } catch (e) {
      if (token === photoGeneration.current) setPhotoError(String(e));
    }
  }
  const canvas = useRef<HTMLCanvasElement>(null),
    scale = useRef<HTMLCanvasElement>(null);
  const bounds = useRef<HTMLOutputElement>(null),
    warning = useRef<HTMLParagraphElement>(null);
  const current = useRef(settings);
  const latest = useRef<{
    frame: RawFrame;
    mode: VideoMode;
    generation: number;
    receivedAt?: number;
    captureMetadata?: Pick<SnapshotOptions, 'profile' | 'fps' | 'path'>;
  } | null>(null);
  const active = useRef<CameraSession | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    current.current = settings;
  }, [settings]);
  useEffect(() => {
    let alive = true;
    void backend
      .listDevices()
      .then((list) => {
        if (alive) {
          setDevices(list);
          setDevice(list[0]?.id ?? '');
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      generation.current++;
      void active.current?.close().catch(() => {});
      active.current = null;
    };
  }, [backend]);
  useEffect(() => {
    if (!canvas.current || !scale.current || !bounds.current || !warning.current) return;
    const renderer = new FrameRenderer(
      canvas.current,
      scale.current,
      bounds.current,
      warning.current,
      readouts.current ?? undefined,
      (active) => setTriggered(active && latest.current?.generation === generation.current),
    );
    rendererRef.current = renderer;
    let previousFrame = latest.current;
    let previousSettings = current.current;
    let request = 0;
    const draw = () => {
      const value = latest.current;
      if (value && (value !== previousFrame || previousSettings !== current.current)) {
        try {
          renderer.draw(value.frame, profile, value.mode, {
            ...current.current,
            alarmGeneration: value.generation,
            ...(value.receivedAt === undefined ? {} : { receivedAt: value.receivedAt }),
            ...(value.captureMetadata ? { captureMetadata: value.captureMetadata } : {}),
          });
        } catch (e) {
          setTriggered(false);
          if (readouts.current) readouts.current.textContent = 'Readings unavailable';
          setError(String(e));
        }
        previousFrame = value;
        previousSettings = current.current;
      }
      request = requestAnimationFrame(draw);
    };
    request = requestAnimationFrame(draw);
    return () => {
      rendererRef.current = null;
      cancelAnimationFrame(request);
    };
  }, [profile]);
  useEffect(() => {
    if (!session) return;
    const token = generation.current;
    let received = false;
    return session.frames.subscribe((frame) => {
      if (token !== generation.current) return;
      if (!received) {
        received = true;
        setHasFrame(true);
      }
      latest.current = {
        frame,
        mode: session.mode,
        generation: token,
        receivedAt: performance.now(),
      };
    });
  }, [session]);
  async function connect() {
    playbackRef.current?.close();
    playbackRef.current = null;
    photoGeneration.current++;
    setPhotoName('');
    setPhotoError('');
    setTriggered(false);
    const token = ++generation.current;
    setBusy(true);
    setError('');
    setHasFrame(false);
    setConfirmed(false);
    if (backend.id === 'browser') setSettings((s) => ({ ...s, gain: 'high' }));
    try {
      const opened = await backend.open({ deviceId: device, profile, modeId });
      if (token !== generation.current) {
        await opened.close();
        return;
      }
      active.current = opened;
      setSession(opened);
    } catch (e) {
      if (token === generation.current) setError(String(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function stop() {
    playbackRef.current?.pause();
    generation.current++;
    setTriggered(false);
    if (photoName) {
      setSettings((s) => ({ ...s, analysis: { ...s.analysis!, alarm: false } }));
      if (latest.current) latest.current = { ...latest.current, generation: generation.current };
    }
    setBusy(false);
    const opened = active.current;
    active.current = null;
    setSession(null);
    try {
      await opened?.close();
    } catch (e) {
      setError(String(e));
    }
  }
  const range = { minCelsius: Number(lower), maxCelsius: Number(upper) };
  const invalid = lower.trim() === '' || upper.trim() === '' || rangeProblems(range).length > 0;
  const update = (patch: Partial<ViewSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const gains = profile.state.find((f) => f.id === 'gain');
  const gainOptions = gains?.kind === 'enum' ? gains.values : ['high', 'low'];
  return (
    <section aria-label="Thermal viewer" className="viewer">
      <div className="viewer-topbar">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h2>
            {photoName ? 'Photo analysis' : 'Live view'}{' '}
            <span className={`status-badge ${session && hasFrame && !failure ? 'is-live' : ''}`}>
              <i />
              {failure
                ? 'Capture error'
                : busy
                  ? 'Connecting'
                  : session
                    ? hasFrame
                      ? backend.id === 'replay'
                        ? 'Demo running'
                        : 'Live'
                      : 'Waiting for frames'
                    : hasFrame
                      ? 'Paused'
                      : 'Ready'}
            </span>
          </h2>
        </div>
        <div className="transport">
          <span className="source-note">
            {backend.id === 'replay' ? 'Synthetic scene · no camera needed' : profile.name}
          </span>
          <button
            className="primary-button"
            disabled={busy || !!session || !device || !modeId}
            onClick={() => void connect()}
          >
            <Icon name="play" />
            Start
          </button>
          <button
            className="stop-button"
            disabled={!busy && !session && !photoName}
            onClick={() => void stop()}
          >
            <Icon name="stop" />
            Stop
          </button>
        </div>
      </div>
      <div className="workspace-grid">
        <div className="preview-column">
          <div className="preview-card">
            <div className="preview-meta">
              <span>
                {backend.id === 'replay' ? 'DEMO' : 'THERMAL'}
                <span className="meta-divider">/</span>
                {profile.sensor.width} × {profile.sensor.height}
              </span>
              <span>
                {settings.smooth ? 'Smooth' : 'Clear'} · {settings.rotation}°
              </span>
            </div>
            <div className={`view-stage ${hasFrame ? 'has-frame' : ''}`}>
              <canvas
                ref={canvas}
                aria-label="Thermal image"
                style={{
                  width: `${Number(zoom) * 100}%`,
                  height: `${Number(zoom) * 100}%`,
                  maxWidth: Number(zoom) > 1 ? 'none' : '100%',
                }}
              />
              {!hasFrame && (
                <div className="empty-view">
                  <span className="empty-icon">
                    <Icon name="image" />
                  </span>
                  <h3>
                    {busy || session ? 'Waiting for the first frame' : 'A different way to see'}
                  </h3>
                  <p>
                    {backend.id === 'replay'
                      ? 'Explore the thermal viewer with a synthetic scene.'
                      : 'Connect your camera and start a thermal view.'}
                  </p>
                  <span>{busy || session ? 'Capture is starting…' : 'Press Start to begin'}</span>
                </div>
              )}
            </div>
            <div className="scale-strip">
              <canvas ref={scale} aria-label="Temperature scale" className="temperature-scale" />
              <div className="scale-caption">
                <output ref={bounds} aria-label="Colour bounds">
                  Waiting for frames
                </output>
                <span>
                  {settings.locked
                    ? 'Locked scale'
                    : rangeMode === 'manual'
                      ? 'Manual range'
                      : 'Auto range'}{' '}
                  · {unitSymbol(settings.analysis!.unit)}
                </span>
              </div>
            </div>
          </div>
          {saveError && (
            <p className="notice error-notice" role="alert">
              Photo capture failed: {saveError}
            </p>
          )}
          {photoError && (
            <p className="notice error-notice" role="alert">
              Photo import failed: {photoError}
            </p>
          )}
          {failure && (
            <p className="notice error-notice" role="alert">
              {failure}
            </p>
          )}
          <p ref={warning} className="notice" role="status" />
          <div className="preview-toolbar">
            <label className="zoom-control">
              Scale
              <select aria-label="Scale" value={zoom} onChange={(e) => setZoom(e.target.value)}>
                <option value="0.5">50%</option>
                <option value="1">Fit</option>
                <option value="2">200%</option>
              </select>
            </label>
            <div className="segmented" role="group" aria-label="Rendering">
              {['Clear', 'Smooth'].map((value) => (
                <button
                  key={value}
                  aria-pressed={settings.smooth === (value === 'Smooth')}
                  onClick={() => update({ smooth: value === 'Smooth' })}
                >
                  {value}
                </button>
              ))}
            </div>
            <label className="switch-label">
              <input
                type="checkbox"
                checked={settings.uncertain}
                onChange={(e) => update({ uncertain: e.target.checked })}
              />
              <span>Uncertain pixels</span>
            </label>
          </div>
          <div className="preview-toolbar" aria-label="Tracking shortcuts">
            {(['min', 'max', 'centre'] as const).map((key) => (
              <button
                key={key}
                aria-pressed={settings.analysis!.tracking[key]}
                onClick={() =>
                  update({
                    analysis: {
                      ...settings.analysis!,
                      tracking: {
                        ...settings.analysis!.tracking,
                        [key]: !settings.analysis!.tracking[key],
                      },
                    },
                  })
                }
              >
                Track {key}
              </button>
            ))}
          </div>
          <output
            ref={readouts}
            aria-label="Measurement readings"
            style={{ whiteSpace: 'pre-line' }}
          />
          <p role="status">
            {!settings.analysis!.alarm
              ? 'Alarm disabled'
              : triggered
                ? 'Alarm triggered'
                : 'Alarm enabled — below threshold'}
          </p>
          <label>
            Open thermal photo
            <input
              type="file"
              accept=".png,.irvis"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void openPhoto(file);
                e.target.value = '';
              }}
            />
          </label>
          {photoName && (
            <p>
              {photoName} · New measurements use stored temperatures. Captured overlays are not
              editable objects.
            </p>
          )}
          <nav className="tool-dock" aria-label="Tools">
            <button
              disabled={!photoLibrary || !hasFrame || !!failure || savingPhoto}
              onClick={() => void capturePhoto()}
            >
              <Icon name="photo" />
              {savingPhoto ? 'Saving photo…' : 'Capture photo'}
            </button>
            <button
              disabled={!photoLibrary}
              aria-expanded={galleryOpen}
              onClick={() => setGalleryOpen((value) => !value)}
            >
              <Icon name="gallery" />
              Gallery
            </button>
          </nav>
          <label>
            Gallery filter
            <select
              value={galleryFilter}
              onChange={(e) => {
                setGalleryFilter(e.target.value);
                setGalleryOpen(true);
              }}
            >
              <option value="all">All</option>
              <option value="photos">Photos</option>
              <option value="videos">Videos</option>
            </select>
          </label>
          <RecordingControls
            {...(openRecording ? { openRecording } : {})}
            showFiles={galleryFilter !== 'photos'}
            {...(recordingStorage ? { storage: recordingStorage } : {})}
            profile={profile}
            live={!!session && hasFrame}
            failure={failure}
            frame={() => rendererRef.current?.recordingFrame() ?? null}
            onExport={async (file, factor, smooth, recorded) => {
              const canvas = document.createElement('canvas');
              const exported = document.createElement('canvas');
              const renderer = new FrameRenderer(
                canvas,
                document.createElement('canvas'),
                document.createElement('output'),
                document.createElement('p'),
                document.createElement('output'),
              );
              const sidecar = (await recordingStorage?.list())?.find((item) =>
                ['.audio-v2.pcm', '.audio-v1.webm'].some(
                  (suffix) => item.name === file.name.replace(/\.irvis$/, suffix),
                ),
              );
              const audio = sidecar
                ? new Blob(
                    [(await sidecar.source.read(0, await sidecar.source.size())).slice().buffer],
                    {
                      type: sidecar.name.endsWith('.pcm')
                        ? 'application/x-irvis-audio'
                        : 'audio/webm',
                    },
                  )
                : undefined;
              const bytes = await exportMp4(
                file.source,
                exported,
                (frame, view) => {
                  const config = recorded
                    ? recordedView(view, current.current)
                    : structuredClone(current.current);
                  renderer.draw(
                    { kind: 'thermal', frame },
                    profile,
                    profile.videoModes.find((m) => m.layout)!,
                    config,
                  );
                  exported.width = canvas.width * factor;
                  exported.height = canvas.height * factor;
                  const context = exported.getContext('2d')!;
                  context.imageSmoothingEnabled = smooth;
                  context.drawImage(canvas, 0, 0, exported.width, exported.height);
                },
                audio,
              );
              await saveRecordingFile(
                file.name.replace(/\.irvis$/, '.mp4'),
                fileByteSource(new Blob([bytes.slice().buffer], { type: 'video/mp4' })),
              );
            }}
            onPlayback={async (player) => {
              await stop();
              playbackRef.current?.close();
              playbackRef.current = player;
              photoGeneration.current++;
              setPhotoName('Recording');
              setError('');
              playbackCorrectionOverride.current = false;
              const correction = photoCorrection(player.reader.header.viewState);
              let recordedCorrection = JSON.stringify(correction);
              setAnalysisRevision((value) => value + 1);
              player.recordedViewState.subscribe((view) => {
                if (playbackRef.current !== player || playbackCorrectionOverride.current) return;
                const correction = photoCorrection(view);
                const signature = JSON.stringify(correction);
                if (signature === recordedCorrection) return;
                recordedCorrection = signature;
                setSettings((s) => ({ ...s, analysis: { ...s.analysis!, correction } }));
              });
              setSettings((s) => ({
                ...s,
                rotation: 0,
                mirrorX: false,
                mirrorY: false,
                analysis: { ...s.analysis!, correction, objects: [], selected: null, alarm: false },
              }));
              player.frames.subscribe((frame) => {
                if (playbackRef.current !== player) return;
                latest.current = {
                  frame: { kind: 'thermal', frame },
                  mode: profile.videoModes.find((m) => m.layout)!,
                  generation: generation.current,
                  captureMetadata: {
                    profile: player.reader.header.profile,
                    fps: player.reader.header.fps,
                    path: player.reader.header.path,
                  },
                };
                setHasFrame(true);
              });
            }}
          />
          {!photoLibrary && <p>Photo storage is unavailable in this host.</p>}
          {photoStatus && <p role="status">{photoStatus}</p>}
          {galleryOpen && galleryFilter !== 'videos' && photoLibrary && (
            <PhotoGallery
              library={photoLibrary}
              revision={galleryRevision}
              onOpen={(photo) =>
                void openPhoto({
                  name: photo.name,
                  arrayBuffer: () => Promise.resolve(photo.bytes.slice().buffer),
                })
              }
            />
          )}
        </div>
        <aside className="settings-panel" aria-label="View settings">
          <AnalysisControls
            key={analysisRevision}
            value={settings.analysis!}
            onChange={(analysis) => {
              if (playbackRef.current && analysis.correction !== settings.analysis!.correction)
                playbackCorrectionOverride.current = true;
              if (
                analysis.alarm &&
                !settings.analysis!.alarm &&
                typeof AudioContext !== 'undefined'
              ) {
                audio.current ??= new AudioContext();
                void audio.current.resume().catch(() => {});
              }
              if (
                analysis.alarm !== settings.analysis!.alarm ||
                analysis.threshold !== settings.analysis!.threshold
              )
                setTriggered(false);
              update({ analysis });
            }}
          />

          <section className="settings-section">
            <div className="section-heading">
              <h3>Palette</h3>
              <span>{PALETTES.find((p) => p.id === settings.palette)?.name}</span>
            </div>
            <div className="palette-grid" role="group" aria-label="Palette">
              {PALETTES.map((p) => (
                <button
                  className="palette-choice"
                  key={p.id}
                  aria-pressed={settings.palette === p.id}
                  onClick={() => update({ palette: p.id })}
                >
                  <span
                    className="palette-swatch"
                    style={{
                      background: `linear-gradient(90deg, ${p.stops.map((s) => `rgb(${s.color.join(' ')}) ${(s.index / 255) * 100}%`).join(', ')})`,
                    }}
                  />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <div className="section-heading">
              <h3>Temperature range</h3>
              <span>°C</span>
            </div>
            <div className="segmented full-width" role="group" aria-label="Range mode">
              {['auto', 'manual'].map((value) => (
                <button
                  key={value}
                  aria-pressed={rangeMode === value}
                  onClick={() => {
                    setRangeMode(value);
                    if (value === 'auto') update({ range: null });
                    else if (!invalid) update({ range });
                  }}
                >
                  {value === 'auto' ? 'Automatic' : 'Manual'}
                </button>
              ))}
            </div>
            {rangeMode === 'manual' ? (
              <div className="manual-range">
                <label>
                  Lower bound (°C)
                  <input type="number" value={lower} onChange={(e) => setLower(e.target.value)} />
                </label>
                <label>
                  Upper bound (°C)
                  <input type="number" value={upper} onChange={(e) => setUpper(e.target.value)} />
                </label>
                <button
                  className="apply-button"
                  disabled={invalid}
                  onClick={() => update({ range })}
                >
                  Apply bounds
                </button>
                {invalid && (
                  <p role="alert">Lower bound must be below upper bound; both must be finite.</p>
                )}
              </div>
            ) : (
              <p className="setting-help">Colours follow the scene’s temperature range.</p>
            )}
            <label className="switch-label">
              <input
                type="checkbox"
                checked={settings.locked}
                onChange={(e) => update({ locked: e.target.checked })}
              />
              <span>Lock scale</span>
            </label>
          </section>
          <section className="settings-section">
            <div className="section-heading">
              <h3>Orientation</h3>
              <Icon name="rotate" />
            </div>
            <div className="segmented full-width" role="group" aria-label="Rotation">
              {[0, 90, 180, 270].map((r) => (
                <button
                  key={r}
                  disabled={orientationLock}
                  aria-pressed={settings.rotation === r}
                  onClick={() => update({ rotation: r })}
                >
                  {r}°
                </button>
              ))}
            </div>
            <div className="orientation-toggles">
              {(['mirrorX', 'mirrorY'] as const).map((key, i) => (
                <label className="switch-label" key={key}>
                  <input
                    type="checkbox"
                    checked={settings[key]}
                    onChange={(e) => update({ [key]: e.target.checked })}
                  />
                  <span>{['Mirror horizontally', 'Mirror vertically'][i]}</span>
                </label>
              ))}
              <label className="switch-label">
                <input
                  type="checkbox"
                  checked={orientationLock}
                  onChange={(e) => setOrientationLock(e.target.checked)}
                />
                <span>Lock orientation</span>
              </label>
            </div>
          </section>
          <details className="settings-disclosure">
            <summary>Camera setup</summary>
            <div className="connection">
              {backend.id === 'electron' ? (
                <label>
                  Camera index
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={device}
                    disabled={busy || !!session}
                    onChange={(e) => setDevice(e.target.value)}
                  />
                </label>
              ) : (
                <label>
                  Camera
                  <select
                    aria-label="Camera"
                    value={device}
                    disabled={busy || !!session}
                    onChange={(e) => setDevice(e.target.value)}
                  >
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label || d.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Video mode
                <select
                  aria-label="Video mode"
                  value={modeId}
                  disabled={busy || !!session}
                  onChange={(e) => setModeId(e.target.value)}
                >
                  {profile.videoModes
                    .filter((m) => m.layout)
                    .map((m) => (
                      <option key={m.id}>{m.id}</option>
                    ))}
                </select>
              </label>
            </div>
          </details>
          {backend.id === 'browser' && (
            <section className="settings-section camera-state">
              <h3>Camera state</h3>
              <p className="setting-help">
                {confirmed
                  ? 'Camera mode declared by user.'
                  : 'camera mode unknown, readings assume high gain'}
              </p>
              <p className="setting-help">
                Factory settings are assumed. This does not send a command to the camera.
              </p>
              <label>
                Declared gain
                <select
                  aria-label="Declared gain"
                  value={settings.gain}
                  onChange={(e) => {
                    update({ gain: e.target.value });
                    setConfirmed(true);
                  }}
                >
                  {gainOptions.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <button className="apply-button" onClick={() => setConfirmed(true)}>
                Confirm camera mode and factory settings
              </button>
            </section>
          )}
          <details className="settings-disclosure">
            <summary>Camera commands</summary>
            <div className="command-controls">
              {profile.commands.map((c) => (
                <button
                  key={c.id}
                  disabled={!session || !backend.capabilities.deviceControl || !command}
                  onClick={() => {
                    void command?.(c.id).catch((e) => setError(String(e)));
                  }}
                >
                  {c.label}
                </button>
              ))}
              {backend.id === 'browser' ? (
                <p className="setting-help">
                  available in the desktop app ·{' '}
                  <a href="https://github.com/mateuszsikora/irvis/releases">Download desktop app</a>
                </p>
              ) : (
                !backend.capabilities.deviceControl && (
                  <p className="setting-help">Camera commands are unavailable in this backend.</p>
                )
              )}
            </div>
          </details>
        </aside>
      </div>
    </section>
  );
}

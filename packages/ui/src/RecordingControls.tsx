import { RecordingThumbnail } from './RecordingThumbnail.tsx';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';
import {
  createRecorder,
  startMicrophone,
  type MicrophoneRecording,
  fileByteSource,
  type Recorder,
  type RecordingStorage,
  type RecordingFile,
} from '@irvis/media';
import type { ByteSource, RecordingPlayer } from '@irvis/core';
import type { CameraProfile, PlayerViewState, SnapshotOptions, ThermalFrame } from '@irvis/core';

export interface RecordingControlsProps {
  openRecording?: (source: ByteSource) => Promise<RecordingPlayer>;
  showFiles: boolean;
  /** The host's recordings; without it, recording and the recording list are unavailable. */
  storage?: RecordingStorage;
  /** Saves a copy of a recording or its sidecar where the user chooses (`HostFiles.saveAs`). */
  saveAs: (name: string, source: ByteSource) => Promise<void>;
  profile: CameraProfile;
  live: boolean;
  failure: string;
  frame: () => { frame: ThermalFrame; options: SnapshotOptions; receivedAt?: number } | null;
  onExport: (
    file: RecordingFile,
    scale: number,
    smooth: boolean,
    recorded: boolean,
  ) => Promise<void>;
  onPlayback: (player: RecordingPlayer) => Promise<void>;
}
export function RecordingControls({
  openRecording,
  showFiles,
  storage,
  saveAs,
  profile,
  live,
  failure,
  frame,
  onPlayback,
  onExport,
}: RecordingControlsProps) {
  const id = useId();
  const microphone = useRef<MicrophoneRecording | null>(null);
  const startedAt = useRef(0);
  const [selected, setSelected] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [exportScale, setExportScale] = useState(1);
  const [smooth, setSmooth] = useState(false);
  const [recorded, setRecorded] = useState(true);
  const [threshold, setThreshold] = useState(
    String(profile.conversions[0]?.recordingThreshold ?? 0),
  );
  const [notice, setNotice] = useState('');
  const [prepared, setPrepared] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [files, setFiles] = useState<RecordingFile[]>([]);
  const [playback, setPlayback] = useState<PlayerViewState | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const player = useRef<RecordingPlayer | null>(null);
  const alive = useRef(true);
  const startGeneration = useRef(0);
  const liveRef = useRef(live);
  liveRef.current = live && !failure;
  const [openedFile, setOpenedFile] = useState<RecordingFile | null>(null);
  const getFrame = useRef(frame);
  getFrame.current = frame;
  async function refresh() {
    if (storage) setFiles((await storage.list()).filter((f) => f.name.endsWith('.irvis')));
  }
  useEffect(() => {
    alive.current = true;
    void storage
      ?.list()
      .then((items) => setFiles(items.filter((f) => f.name.endsWith('.irvis'))))
      .catch((e) => setError(String(e)));
    return () => {
      alive.current = false;
      player.current?.close();
      void microphone.current?.stop().catch(() => {});
      void recorder.current?.stop().catch(() => {});
    };
  }, [storage]);
  async function stop() {
    startGeneration.current++;
    const mic = microphone.current;
    microphone.current = null;
    const audioStop = mic?.stop();
    const active = recorder.current;
    recorder.current = null;
    setRecording(false);
    if (!active) {
      await audioStop?.catch((e) => setError(String(e)));
      return;
    }
    setBusy(true);
    try {
      // The recording stays in the host's library; a copy is saved only on request.
      await Promise.all([active.stop(), audioStop]);
      await refresh();
    } catch (e) {
      setError(String(e));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!live || failure) void stop();
    if (live) {
      player.current?.close();
      setPlayback(null);
    }
  }, [live, failure]); // stop on disconnect
  useEffect(() => {
    if (!recording) return;
    const start = performance.now();
    let previous = -Infinity;
    const timer = setInterval(() => {
      const snapshot = getFrame.current();
      setElapsed((performance.now() - start) / 1000);
      const timestamp = snapshot?.receivedAt ?? snapshot?.frame.timestamp ?? -Infinity;
      if (snapshot && timestamp >= startedAt.current && timestamp !== previous) {
        if (recorder.current?.append({ ...snapshot.frame, timestamp }, snapshot.options.viewState))
          previous = timestamp;
      }
    }, 16);
    return () => clearInterval(timer);
  }, [recording]);
  async function start() {
    let snapshot = frame();
    if (!storage || !snapshot || busy) return;
    const token = ++startGeneration.current;
    setBusy(true);
    setError('');
    const name = `irvis-${Date.now()}-${crypto.randomUUID()}.irvis`;
    const audioName = name.replace(/\.irvis$/, '.audio-v2.pcm');
    let started = false;
    try {
      setNotice(
        await storage.prepare(
          profile.sensor.width * profile.sensor.height * 2 * (profile.videoModes[0]?.fps ?? 25) +
            (audioEnabled ? 192000 * 4 : 0),
        ),
      );
      startedAt.current = performance.now();
      if (audioEnabled)
        microphone.current = await startMicrophone(await storage.create(audioName), (e) => {
          setError(String(e));
          void stop();
        });
      if (!alive.current || !liveRef.current || token !== startGeneration.current) {
        await microphone.current?.stop();
        microphone.current = null;
        return;
      }
      snapshot = frame();
      if (!snapshot) throw new Error('Camera frame is unavailable.');
      const sink = await storage.create(name);
      const active = await createRecorder(
        sink,
        {
          ...snapshot.options,
          viewState: {
            ...snapshot.options.viewState,
            ...(audioEnabled
              ? { audio: { version: 2, file: audioName, clock: 'performance' } }
              : {}),
          },
          width: snapshot.frame.width,
          height: snapshot.frame.height,
          threshold: Number(threshold),
        },
        (e) => {
          setError(String(e));
          void stop();
        },
      );
      if (!alive.current || !liveRef.current || token !== startGeneration.current) {
        await active.stop();
        await microphone.current?.stop();
        microphone.current = null;
        return;
      }
      recorder.current = active;
      started = true;
      setElapsed(0);
      setRecording(true);
    } catch (e) {
      await microphone.current?.stop().catch(() => {});
      microphone.current = null;
      setError(String(e));
    } finally {
      if (!started) {
        await storage.remove(name).catch(() => {});
        await storage.remove(audioName).catch(() => {});
      }
      setBusy(false);
    }
  }
  async function open(file: RecordingFile) {
    setError('');
    try {
      if (!openRecording) throw new Error('Playback is unavailable in this host.');
      const next = await openRecording(file.source);
      if (!alive.current) {
        next.close();
        return;
      }
      player.current?.close();
      player.current = next;
      next.viewState.subscribe(setPlayback);
      next.errors.subscribe((e) => setError(String(e)));
      setOpenedFile(file);
      setPlayback(next.viewState.getSnapshot());
      await onPlayback(next);
      next.seek(0);
      if (!next.reader.indexed)
        setNotice('Recovered complete frames from an unfinished recording. Download a backup.');
    } catch (e) {
      setError(String(e));
    }
  }
  async function download(file: RecordingFile) {
    try {
      await saveAs(file.name, file.source);
    } catch (e) {
      setError(String(e));
    }
  }
  const valid =
    threshold.trim() !== '' &&
    Number.isInteger(Number(threshold)) &&
    Number(threshold) >= 0 &&
    Number(threshold) <= 65535;
  const exportFile = (file: RecordingFile) => {
    setBusy(true);
    void onExport(file, exportScale, smooth, recorded)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <section aria-label="Recordings" className="panel-card">
      <div className="panel-heading">
        <h3>Recordings</h3>
        {recording && (
          <output className="status-pill is-recording">Recording · {elapsed.toFixed(1)} s</output>
        )}
      </div>
      <div className="action-row">
        {!prepared && (
          <button
            disabled={!storage || busy}
            onClick={() => {
              void storage
                ?.prepare(
                  profile.sensor.width *
                    profile.sensor.height *
                    2 *
                    (profile.videoModes[0]?.fps ?? 25),
                )
                .then((message) => {
                  setNotice(message);
                  setPrepared(true);
                })
                .catch((e) => setError(String(e)));
            }}
          >
            Check recording storage
          </button>
        )}
        <button
          className="record-button"
          disabled={!live || !storage || !prepared || !valid || busy || recording}
          onClick={() => void start()}
        >
          <Icon name="record" />
          Record .irvis
        </button>
        <button disabled={!recording} onClick={() => void stop()}>
          <Icon name="stop" />
          Stop recording
        </button>
        <label className={`file-button ${recording || busy ? 'is-disabled' : ''}`}>
          <input
            type="file"
            accept=".irvis"
            disabled={recording || busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void open({ name: file.name, source: fileByteSource(file) });
              e.target.value = '';
            }}
          />
          <Icon name="open" />
          Open recording
        </label>
      </div>
      {!storage && <p className="panel-help">Recording storage is unavailable in this host.</p>}
      {storage && !prepared && (
        <p className="panel-help">Check recording storage once before the first recording.</p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="option-grid">
        <label className="switch-label">
          <input
            type="checkbox"
            checked={audioEnabled}
            disabled={recording || busy}
            onChange={(e) => setAudioEnabled(e.target.checked)}
          />
          <span>Record microphone</span>
        </label>
        <div className="inline-field">
          <label htmlFor={`${id}-threshold`}>Recording threshold</label>
          <input
            id={`${id}-threshold`}
            type="number"
            min="0"
            max="65535"
            value={threshold}
            aria-describedby={`${id}-threshold-help`}
            aria-invalid={!valid}
            disabled={recording || busy}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <small id={`${id}-threshold-help`}>0 = lossless</small>
        </div>
      </div>
      {playback && (
        <div className="playback-bar" aria-label="Playback controls">
          <button onClick={() => player.current?.play()}>
            <Icon name="play" />
            Play recording
          </button>
          <button onClick={() => player.current?.pause()}>
            <Icon name="pause" />
            Pause recording
          </button>
          <label className="playback-position">
            <span className="visually-hidden">Position</span>
            <input
              type="range"
              min="0"
              max={playback.duration}
              value={playback.position}
              onChange={(e) => player.current?.seek(Number(e.target.value))}
            />
          </label>
          <output>
            {(playback.position / 1000).toFixed(1)} / {(playback.duration / 1000).toFixed(1)} s
          </output>
          <label className="playback-speed">
            <span className="visually-hidden">Playback speed</span>
            <select
              value={playback.rate}
              onChange={(e) => player.current?.setRate(Number(e.target.value))}
            >
              {[0.25, 0.5, 1, 2, 4].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}×
                </option>
              ))}
            </select>
          </label>
          {openedFile && (
            <button disabled={busy || recording} onClick={() => exportFile(openedFile)}>
              Export opened recording
            </button>
          )}
        </div>
      )}
      {!playback && openedFile && (
        <div className="action-row">
          <button disabled={busy || recording} onClick={() => exportFile(openedFile)}>
            Export opened recording
          </button>
        </div>
      )}
      <fieldset className="export-options">
        <legend>MP4 export</legend>
        <div className="option-grid">
          <label className="switch-label">
            <input
              type="checkbox"
              checked={recorded}
              onChange={(e) => setRecorded(e.target.checked)}
            />
            <span>Recorded appearance</span>
          </label>
          <label className="switch-label">
            <input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} />
            <span>Smooth export</span>
          </label>
          <div className="inline-field">
            <span id={`${id}-upscale`}>Upscale</span>
            <div className="segmented" role="group" aria-labelledby={`${id}-upscale`}>
              {[1, 2, 4].map((n) => (
                <button key={n} aria-pressed={exportScale === n} onClick={() => setExportScale(n)}>
                  {n}×
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="panel-help">
          Uses the current palette, range, units and overlays when recorded appearance is off.
        </p>
      </fieldset>
      <ul className="recording-list" hidden={!showFiles || files.length === 0}>
        {files.map((file) => (
          <li key={file.name}>
            <RecordingThumbnail source={file.source} />
            <label className="recording-name">
              <input
                type="radio"
                name="selected-recording"
                checked={selected === file.name}
                onChange={() => setSelected(file.name)}
              />
              <span>{file.name}</span>
            </label>
            <div className="recording-actions">
              <button disabled={recording || busy} onClick={() => void open(file)}>
                Open
              </button>
              <button disabled={busy || recording} onClick={() => exportFile(file)}>
                Export MP4
              </button>
              <button
                onClick={() => {
                  void storage
                    ?.list()
                    .then(async (items) => {
                      const audio = items.find((f) =>
                        ['.audio-v2.pcm', '.audio-v1.webm'].some(
                          (suffix) => f.name === file.name.replace(/\.irvis$/, suffix),
                        ),
                      );
                      if (!audio) throw new Error('This recording has no microphone sidecar.');
                      await download(audio);
                    })
                    .catch((e) => setError(String(e)));
                }}
              >
                Download audio sidecar
              </button>
              <button onClick={() => void download(file)}>Download .irvis</button>
              <button
                className="danger-button"
                disabled={recording || busy}
                onClick={() => {
                  void (async () => {
                    await storage?.remove(file.name);
                    const audio = (await storage?.list())?.find((item) =>
                      ['.audio-v2.pcm', '.audio-v1.webm'].some(
                        (suffix) => item.name === file.name.replace(/\.irvis$/, suffix),
                      ),
                    );
                    if (audio) await storage?.remove(audio.name);
                    await refresh();
                  })().catch((e) => setError(String(e)));
                }}
              >
                Delete recording
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p className="notice error-notice" role="alert">
          Recording error: {error}
        </p>
      )}
    </section>
  );
}

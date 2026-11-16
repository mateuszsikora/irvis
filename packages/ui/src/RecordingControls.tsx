import { RecordingThumbnail } from './RecordingThumbnail.tsx';
import { useEffect, useRef, useState } from 'react';
import {
  createRecorder,
  startMicrophone,
  type MicrophoneRecording,
  fileByteSource,
  saveRecordingFile,
  type Recorder,
  type RecordingStorage,
  type RecordingFile,
} from '@irvis/media';
import type { ByteSource, RecordingPlayer } from '@irvis/core';
import type { CameraProfile, PlayerViewState, SnapshotOptions, ThermalFrame } from '@irvis/core';

export interface RecordingControlsProps {
  openRecording?: (source: ByteSource) => Promise<RecordingPlayer>;
  showFiles: boolean;
  storage?: RecordingStorage;
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
  profile,
  live,
  failure,
  frame,
  onPlayback,
  onExport,
}: RecordingControlsProps) {
  const microphone = useRef<MicrophoneRecording | null>(null);
  const [autoExport, setAutoExport] = useState(false);
  const currentName = useRef('');
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
      await Promise.all([active.stop(), audioStop]);
      await refresh();
      const file = (await storage?.list())?.find((f) => f.name === currentName.current);
      if (file) {
        await saveRecordingFile(file.name, file.source);
        if (autoExport) await onExport(file, exportScale, smooth, recorded);
      }
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
      currentName.current = name;
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
      await saveRecordingFile(file.name, file.source);
    } catch (e) {
      setError(String(e));
    }
  }
  const valid =
    threshold.trim() !== '' &&
    Number.isInteger(Number(threshold)) &&
    Number(threshold) >= 0 &&
    Number(threshold) <= 65535;
  return (
    <section aria-label="Recordings">
      <h3>Recordings</h3>
      <label>
        <input
          type="checkbox"
          checked={audioEnabled}
          disabled={recording || busy}
          onChange={(e) => setAudioEnabled(e.target.checked)}
        />
        Microphone (Off by default)
      </label>
      <label>
        <input
          type="checkbox"
          checked={autoExport}
          disabled={recording || busy}
          onChange={(e) => setAutoExport(e.target.checked)}
        />
        Export MP4 after recording
      </label>
      <label>
        Recording threshold (0 = lossless)
        <input
          type="number"
          min="0"
          max="65535"
          value={threshold}
          disabled={recording || busy}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </label>
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
      {notice && <p role="status">{notice}</p>}
      <button
        disabled={!live || !storage || !prepared || !valid || busy || recording}
        onClick={() => void start()}
      >
        Record .irvis
      </button>
      <button disabled={!recording} onClick={() => void stop()}>
        Stop recording
      </button>
      {recording && <output>Recording · {elapsed.toFixed(1)} s</output>}
      <label>
        Open recording
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
      </label>
      {playback && (
        <div aria-label="Playback controls">
          <button onClick={() => player.current?.play()}>Play recording</button>
          <button onClick={() => player.current?.pause()}>Pause recording</button>
          <label>
            Position
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
          <label>
            Playback speed
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
        </div>
      )}
      {openedFile && (
        <button
          disabled={busy || recording}
          onClick={() => {
            setBusy(true);
            void onExport(openedFile, exportScale, smooth, recorded)
              .catch((e) => setError(String(e)))
              .finally(() => setBusy(false));
          }}
        >
          Export opened recording
        </button>
      )}
      <fieldset>
        <legend>MP4 export</legend>
        <p>Uses the current palette, range, units and overlays when recorded appearance is off.</p>
        <label>
          <input
            type="checkbox"
            checked={recorded}
            onChange={(e) => setRecorded(e.target.checked)}
          />
          Recorded appearance
        </label>
        <label>
          Upscale
          <select value={exportScale} onChange={(e) => setExportScale(Number(e.target.value))}>
            {[1, 2, 4].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} />
          Smooth export
        </label>
      </fieldset>
      <ul hidden={!showFiles}>
        {files.map((file) => (
          <li key={file.name}>
            <label>
              <input
                type="radio"
                name="selected-recording"
                checked={selected === file.name}
                onChange={() => setSelected(file.name)}
              />
              {file.name}
            </label>
            <RecordingThumbnail source={file.source} />
            <button disabled={recording || busy} onClick={() => void open(file)}>
              Open
            </button>
            <button
              disabled={busy || recording}
              onClick={() => {
                setBusy(true);
                void onExport(file, exportScale, smooth, recorded)
                  .catch((e) => setError(String(e)))
                  .finally(() => setBusy(false));
              }}
            >
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
          </li>
        ))}
      </ul>
      {error && <p role="alert">Recording error: {error}</p>}
    </section>
  );
}

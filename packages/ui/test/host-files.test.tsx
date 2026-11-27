import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraProfiles, type ByteSink, type ByteSource, type CameraBackend } from '@irvis/core';
import type { RecordingStorage } from '@irvis/media';
import { RecordingControls } from '../src/RecordingControls.tsx';
import { PhotoGallery } from '../src/PhotoGallery.tsx';
import { Viewer, type HostFiles, type PhotoLibrary } from '../src/index.ts';

const media = vi.hoisted(() => ({
  exportMp4: vi.fn(() => Promise.resolve(new Uint8Array([7, 7]))),
  createRecorder: vi.fn(() =>
    Promise.resolve({ append: () => true, stop: () => Promise.resolve() }),
  ),
}));
vi.mock('../src/render.ts', () => ({ FrameRenderer: class {} }));
vi.mock('@irvis/media', async (original) => ({
  ...(await original<typeof import('@irvis/media')>()),
  ...media,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const profile = cameraProfiles[0]!;
const sink: ByteSink = {
  append: () => Promise.resolve(),
  flush: () => Promise.resolve(),
  close: () => Promise.resolve(),
};
const bytesOf = (...bytes: number[]): ByteSource => ({
  size: () => Promise.resolve(bytes.length),
  read: () => Promise.resolve(new Uint8Array(bytes)),
});
/** A recordings library in memory, with the names it created. */
function library(...names: string[]) {
  const storage = {
    prepare: () => Promise.resolve('Recordings are kept by the app.'),
    create: (name: string) => {
      names.push(name);
      return Promise.resolve(sink);
    },
    list: () => Promise.resolve(names.map((name) => ({ name, source: bytesOf(1) }))),
    remove: () => Promise.resolve(),
  } satisfies RecordingStorage;
  return { storage, names };
}
const saveAs = () => vi.fn<HostFiles['saveAs']>(() => Promise.resolve());
const backend: CameraBackend = {
  id: 'replay',
  capabilities: { exactRaw: true, deviceControl: false, concurrentWith: [] },
  listDevices: () => Promise.resolve([]),
  open: () => Promise.reject(new Error('unused')),
};
const liveFrame = () => ({
  frame: {
    width: 1,
    height: 1,
    timestamp: 0,
    raw: new Uint16Array([1]),
    uncertain: null,
    conversion: { kind: 'linear' as const, scale: 1, offset: 0 },
    cameraState: { origin: 'assumed' as const, values: {} },
  },
  options: { viewState: {} } as never,
});
const controls = (storage: RecordingStorage, save: HostFiles['saveAs'], live = false) => (
  <RecordingControls
    showFiles
    storage={storage}
    saveAs={save}
    profile={profile}
    live={live}
    failure=""
    frame={live ? liveFrame : () => null}
    onExport={() => Promise.resolve()}
    onPlayback={() => Promise.resolve()}
  />
);

describe('host files', () => {
  it('saves a copy of a recording and of its sidecar through saveAs, under their names', async () => {
    const { storage } = library('clip.irvis', 'clip.audio-v2.pcm');
    const save = saveAs();
    render(controls(storage, save));
    fireEvent.click(await screen.findByRole('button', { name: 'Download .irvis' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('clip.irvis', expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: 'Download audio sidecar' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('clip.audio-v2.pcm', expect.anything()));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('exports an MP4 through saveAs, named after its recording', async () => {
    const { storage } = library('clip.irvis');
    const save = saveAs();
    render(
      <Viewer
        device="test"
        modeId="yuyv-256x384"
        profile={profile}
        backend={backend}
        files={{ recordings: storage, saveAs: save }}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Export MP4' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const [name, source] = save.mock.calls[0]!;
    expect(name).toBe('clip.mp4');
    expect([...(await source.read(0, await source.size()))]).toEqual([7, 7]);
  });

  it('saves a photo and a flattened annotated copy through saveAs', async () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:photo', revokeObjectURL: () => {} });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
      callback(new Blob([new Uint8Array([9])]));
    });
    const photos: PhotoLibrary = {
      list: () =>
        Promise.resolve([
          { id: 'a', name: 'irvis-a.png', createdAt: 1, bytes: new Uint8Array([4, 2]) },
        ]),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    const save = saveAs();
    render(<PhotoGallery library={photos} saveAs={save} revision={0} onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download irvis-a.png' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('irvis-a.png', expect.anything()));
    const copy = save.mock.calls[0]![1];
    expect([...(await copy.read(0, await copy.size()))]).toEqual([4, 2]);
    fireEvent.click(screen.getByRole('button', { name: 'Annotate irvis-a.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export flattened PNG' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('irvis-a-annotated-flat.png', expect.anything()),
    );
  });

  it('turns recording, Capture photo and Gallery off when the host has no library for them', () => {
    render(
      <Viewer
        device="test"
        modeId="yuyv-256x384"
        profile={profile}
        backend={backend}
        files={{ saveAs: saveAs() }}
      />,
    );
    screen.getByText('Recording storage is unavailable in this host.');
    screen.getByText('Photo storage is unavailable in this host.');
    for (const name of ['Check recording storage', 'Record .irvis', 'Capture photo', 'Gallery'])
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
  });

  it('keeps a stopped recording in the library without saving a copy, and offers no automatic export', async () => {
    const { storage, names } = library();
    const save = saveAs();
    render(controls(storage, save, true));
    expect(screen.queryByText('Export MP4 after recording')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check recording storage' }));
    await screen.findByText('Recordings are kept by the app.');
    fireEvent.click(screen.getByRole('button', { name: 'Record .irvis' }));
    await screen.findByText(/^Recording ·/);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    await waitFor(() => expect(screen.queryByText(/^Recording ·/)).toBeNull());
    await screen.findByText(names[0]!);
    expect(save).not.toHaveBeenCalled();
    expect(media.exportMp4).not.toHaveBeenCalled();
  });
});

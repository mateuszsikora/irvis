import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraProfiles, exportPng, type CameraBackend, type RawFrame } from '@irvis/core';
import { Viewer, type PhotoLibrary, type SavedPhoto } from '../src/index.ts';
const capture = vi.hoisted(() => vi.fn<() => Promise<Uint8Array>>());
const draw = vi.hoisted(() => vi.fn());
vi.mock('../src/render.ts', () => ({
  FrameRenderer: class {
    draw = draw;
    capturePhoto = capture;
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  capture.mockReset();
  draw.mockReset();
});
const profile = cameraProfiles[0]!;
async function setup() {
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:photo', revokeObjectURL: vi.fn() });
  const bytes = await exportPng(
    {
      width: 1,
      height: 1,
      timestamp: 0,
      raw: new Uint16Array([50]),
      uncertain: null,
      conversion: { kind: 'linear', scale: 1, offset: 0 },
      cameraState: { origin: 'assumed', values: {} },
    },
    {
      profile: { id: profile.id, version: profile.version, name: profile.name },
      fps: 1,
      path: 'exact',
    },
  );
  capture.mockResolvedValue(bytes);
  let emit!: (frame: RawFrame) => void;
  const backend: CameraBackend = {
    id: 'replay',
    capabilities: { exactRaw: true, deviceControl: false, concurrentWith: [] },
    listDevices: () => Promise.resolve([{ id: 'test', label: 'test' }]),
    open: () =>
      Promise.resolve({
        device: { id: 'test', label: 'test' },
        profile,
        mode: profile.videoModes[0]!,
        frames: {
          subscribe: (listener) => {
            emit = listener;
            return () => {};
          },
        },
        close: () => Promise.resolve(),
      }),
  };
  const items: SavedPhoto[] = [];
  const library: PhotoLibrary = {
    list: () => Promise.resolve([...items]),
    save: vi.fn<PhotoLibrary['save']>((photo) => {
      items.push(photo);
      return Promise.resolve();
    }),
    remove: vi.fn<PhotoLibrary['remove']>((id) => {
      items.splice(
        items.findIndex((p) => p.id === id),
        1,
      );
      return Promise.resolve();
    }),
  };
  render(
    <Viewer
      device="test"
      modeId="yuyv-256x384"
      backend={backend}
      profile={profile}
      photoLibrary={library}
    />,
  );
  await waitFor(() => expect(screen.getByText<HTMLButtonElement>('Start').disabled).toBe(false));
  await act(async () => {
    fireEvent.click(screen.getByText('Start'));
    await Promise.resolve();
  });
  act(() =>
    emit({
      kind: 'thermal',
      frame: {
        width: 1,
        height: 1,
        timestamp: 0,
        raw: new Uint16Array([50]),
        uncertain: null,
        conversion: { kind: 'linear', scale: 1, offset: 0 },
        cameraState: { origin: 'assumed', values: {} },
      },
    }),
  );
  return { library, items };
}
describe('photo workflow', () => {
  it('captures into the gallery and opens fresh measurements while preserving original bytes', async () => {
    const { items } = await setup();
    fireEvent.click(screen.getByText('Add point'));
    fireEvent.click(screen.getByText('Capture photo'));
    // By text: a first ByRole query on this tree costs about as much as the
    // whole wait on a slow runner (docs/guides/testing.md).
    const analyze = await screen.findByText(/^Analyze irvis-/, { selector: 'button' });
    const original = items[0]!.bytes.slice();
    fireEvent.click(analyze);
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLSelectElement>('Selected object').options).toHaveLength(1),
    );
    for (const kind of ['point', 'line', 'area']) fireEvent.click(screen.getByText(`Add ${kind}`));
    expect(screen.getByLabelText<HTMLSelectElement>('Selected object').options).toHaveLength(4);
    expect(items[0]!.bytes).toEqual(original);
    expect(screen.getByRole('link', { name: /^Download irvis-/ }).getAttribute('download')).toBe(
      items[0]!.name,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Delete irvis-/ }));
    await screen.findByText('No saved photos.');
    expect(screen.getByLabelText<HTMLSelectElement>('Selected object').options).toHaveLength(4);
  });
  it('reports failed saves without claiming success and leaves failed deletions visible', async () => {
    const { library } = await setup();
    vi.spyOn(library, 'save').mockRejectedValueOnce(new Error('Storage full'));
    fireEvent.click(screen.getByText('Capture photo'));
    await screen.findByText(/Storage full/);
    expect(screen.queryByText(/^Saved /)).toBeNull();
    fireEvent.click(screen.getByText('Capture photo'));
    const remove = await screen.findByText(/^Delete irvis-/, { selector: 'button' });
    vi.spyOn(library, 'remove').mockRejectedValueOnce(new Error('Cannot delete'));
    fireEvent.click(remove);
    await screen.findByText(/Gallery error: Error: Cannot delete/);
    expect(screen.getByRole('button', { name: /^Analyze irvis-/ })).toBeTruthy();
  });
});

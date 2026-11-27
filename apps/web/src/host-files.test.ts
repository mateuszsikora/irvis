import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '@irvis/backend-electron';
import { saveRecordingFile } from '@irvis/media';
import { createHostFiles } from './host-files.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});
const base = {
  start: () => Promise.resolve(),
  stop: () => Promise.resolve(),
  subscribe: () => () => {},
};

describe('host files', () => {
  it('keeps desktop photos as files through the main process', async () => {
    const files = new Map<string, { bytes: Uint8Array; createdAt: number }>();
    const photoStorage = vi.fn(
      (op: string, name?: string, bytes?: Uint8Array, createdAt?: number) => {
        if (op === 'save') files.set(name!, { bytes: bytes!, createdAt: createdAt! });
        if (op === 'remove') files.delete(name!);
        return Promise.resolve(
          op === 'list' ? [...files].map(([name, file]) => ({ name, ...file })) : undefined,
        );
      },
    );
    const { photos } = createHostFiles({ ...base, photoStorage });
    await photos!.save({
      id: 'uuid',
      name: 'irvis-a.png',
      createdAt: 5,
      bytes: new Uint8Array([1]),
    });
    expect(photoStorage).toHaveBeenCalledWith('save', 'irvis-a.png', new Uint8Array([1]), 5);
    // The file name is the photo's id.
    expect(await photos!.list()).toEqual([
      { id: 'irvis-a.png', name: 'irvis-a.png', createdAt: 5, bytes: new Uint8Array([1]) },
    ]);
    await photos!.remove('irvis-a.png');
    expect(await photos!.list()).toEqual([]);
  });

  it('has the main process copy a desktop recording, and sends the bytes of anything else', async () => {
    const saveAs = vi.fn<NonNullable<DesktopBridge['saveAs']>>(() => Promise.resolve(true));
    const recordingStorage = vi.fn((op: string) =>
      Promise.resolve(op === 'list' ? ['clip.irvis'] : op === 'size' ? 3 : new Uint8Array(3)),
    );
    const files = createHostFiles({ ...base, recordingStorage, saveAs });
    const [recording] = await files.recordings!.list();
    await files.saveAs('clip.irvis', recording!.source);
    expect(saveAs).toHaveBeenLastCalledWith('clip.irvis', {
      kind: 'recordings',
      name: 'clip.irvis',
    });
    // Not read through the renderer.
    expect(recordingStorage.mock.calls.map(([op]) => op)).toEqual(['list']);
    await files.saveAs('clip.mp4', {
      size: () => Promise.resolve(2),
      read: () => Promise.resolve(new Uint8Array([4, 5])),
    });
    expect(saveAs).toHaveBeenLastCalledWith('clip.mp4', new Uint8Array([4, 5]));
    // A preload without the dialog cannot save a copy.
    await expect(createHostFiles(base).saveAs('clip.mp4', recording!.source)).rejects.toThrow(
      'Saving a copy is unavailable in this desktop app.',
    );
  });

  it('gives a desktop app only the libraries its preload has', () => {
    expect(Object.keys(createHostFiles(base))).toEqual(['saveAs']);
  });

  it('gives the browser no recordings without OPFS and no photos without IndexedDB', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('indexedDB', undefined);
    const files = createHostFiles(undefined);
    expect(files).toEqual({ saveAs: saveRecordingFile });
  });
});

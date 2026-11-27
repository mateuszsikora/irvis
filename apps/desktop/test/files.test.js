import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPhotoStorage, installSaveAs } from '../src/recordings.js';

/** Makes `writeFile` fail after writing part of a file, as a full disk does. */
const faults = vi.hoisted(() => ({ cutWrite: false }));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original();
  return {
    ...fs,
    writeFile: async (file, bytes) => {
      if (!faults.cutWrite) return fs.writeFile(file, bytes);
      await fs.writeFile(file, bytes.subarray(0, 1));
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    },
  };
});

let scratch;
function setup() {
  scratch = mkdtempSync(join(tmpdir(), 'irvis-files-'));
  return scratch;
}
afterEach(() => {
  faults.cutWrite = false;
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});
/** The handlers installed on a stand-in for `ipcMain`, called as the preload calls them. */
function handlers(install) {
  const installed = new Map();
  install({ handle: (channel, handler) => installed.set(channel, handler) });
  return (channel, ...args) => installed.get(channel)({}, ...args);
}

describe('desktop library files', () => {
  it('saves, lists and deletes photos in userData/photos by name, with their time', async () => {
    const photos = join(setup(), 'photos');
    const call = handlers((ipc) => installPhotoStorage(ipc, photos, () => {}));
    expect(await call('photo:storage', 'list')).toEqual([]);
    await call('photo:storage', 'save', 'irvis-a.png', new Uint8Array([1, 2]), 1_000_000_000_000);
    const [photo] = await call('photo:storage', 'list');
    expect(photo.name).toBe('irvis-a.png');
    expect(photo.createdAt).toBe(1_000_000_000_000);
    expect([...photo.bytes]).toEqual([1, 2]);
    await expect(
      call('photo:storage', 'save', 'irvis-a.png', new Uint8Array([3]), 1),
    ).rejects.toThrow('irvis-a.png already exists.');
    await call('photo:storage', 'remove', 'irvis-a.png');
    expect(readdirSync(photos)).toEqual([]);
  });

  it('refuses a photo name that is not a PNG file name of the directory', async () => {
    const root = setup();
    const call = handlers((ipc) => installPhotoStorage(ipc, join(root, 'photos'), () => {}));
    for (const name of ['../escape.png', 'photo.irvis', 'a/b.png', undefined])
      await expect(call('photo:storage', 'save', name, new Uint8Array([1]), 1)).rejects.toThrow(
        'Invalid photo name.',
      );
    await expect(call('photo:storage', 'remove', '../settings.json')).rejects.toThrow(
      'Invalid photo name.',
    );
    expect(readdirSync(root)).toEqual(['photos']);
  });

  it('leaves no part of a photo whose write fails, and removes the parts a crash left at start', async () => {
    const photos = join(setup(), 'photos');
    mkdirSync(photos);
    writeFileSync(join(photos, 'irvis-old.png.tmp'), 'cut short');
    writeFileSync(join(photos, 'irvis-kept.png'), 'whole');
    const call = handlers((ipc) => installPhotoStorage(ipc, photos, () => {}));
    expect((await call('photo:storage', 'list')).map((photo) => photo.name)).toEqual([
      'irvis-kept.png',
    ]);
    expect(readdirSync(photos)).toEqual(['irvis-kept.png']);
    faults.cutWrite = true;
    await expect(
      call('photo:storage', 'save', 'irvis-b.png', new Uint8Array([1, 2]), 1),
    ).rejects.toThrow('ENOSPC');
    expect(readdirSync(photos)).toEqual(['irvis-kept.png']);
  });

  it('saves a copy where the save dialog says: a library file copied, bytes written, nothing when cancelled', async () => {
    const root = setup();
    const directories = { recordings: join(root, 'recordings'), photos: join(root, 'photos') };
    mkdirSync(directories.recordings);
    writeFileSync(join(directories.recordings, 'clip.irvis'), 'recording');
    const answers = [];
    const showSaveDialog = vi.fn(() => Promise.resolve(answers.shift()));
    const call = handlers((ipc) =>
      installSaveAs(ipc, {
        authorize: () => {},
        showSaveDialog,
        directories,
        folder: join(root, 'Downloads'),
      }),
    );
    answers.push({ canceled: false, filePath: join(root, 'copy.irvis') });
    expect(
      await call('files:save-as', 'clip.irvis', { kind: 'recordings', name: 'clip.irvis' }),
    ).toBe(true);
    // In the downloads folder, under the suggested name.
    expect(showSaveDialog).toHaveBeenLastCalledWith({
      defaultPath: join(root, 'Downloads', 'clip.irvis'),
    });
    expect(readFileSync(join(root, 'copy.irvis'), 'utf8')).toBe('recording');
    answers.push({ canceled: false, filePath: join(root, 'clip.mp4') });
    await call('files:save-as', 'clip.mp4', new Uint8Array([1, 2, 3]));
    expect([...readFileSync(join(root, 'clip.mp4'))]).toEqual([1, 2, 3]);
    // Cancelled: nothing is written, and it is not an error.
    answers.push({ canceled: true, filePath: '' });
    expect(await call('files:save-as', 'other.mp4', new Uint8Array([1]))).toBe(false);
    expect(readdirSync(root).sort()).toEqual(['clip.mp4', 'copy.irvis', 'recordings']);
    // Only the name is taken from the renderer, and only a file of the library is copied.
    answers.push({ canceled: false, filePath: join(root, 'x') });
    await call('files:save-as', '../../x.mp4', new Uint8Array([1]));
    expect(showSaveDialog).toHaveBeenLastCalledWith({
      defaultPath: join(root, 'Downloads', 'x.mp4'),
    });
    await expect(
      call('files:save-as', 'x', { kind: 'recordings', name: '../settings.json' }),
    ).rejects.toThrow('Invalid file to save.');
    expect(statSync(join(root, 'x')).size).toBe(1);
  });

  it('answers only the app window', async () => {
    const root = setup();
    const deny = () => {
      throw new Error('Untrusted IPC sender');
    };
    const photos = handlers((ipc) => installPhotoStorage(ipc, join(root, 'photos'), deny));
    const save = handlers((ipc) =>
      installSaveAs(ipc, {
        authorize: deny,
        showSaveDialog: () => Promise.resolve({ canceled: true }),
        directories: { recordings: root, photos: root },
        folder: root,
      }),
    );
    await expect(photos('photo:storage', 'list')).rejects.toThrow('Untrusted IPC sender');
    await expect(save('files:save-as', 'a.mp4', new Uint8Array([1]))).rejects.toThrow(
      'Untrusted IPC sender',
    );
  });
});

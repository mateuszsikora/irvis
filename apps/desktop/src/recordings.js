import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';

/** The names a recording or its microphone sidecar may have. */
export const RECORDING_NAME = /^[a-zA-Z0-9_.-]+\.(irvis|webm|pcm)$/;
/** The names a photo may have; the viewer names them by time and a UUID. */
export const PHOTO_NAME = /^[a-zA-Z0-9_.-]+\.png$/;

/** All paths stay inside the app-owned directory. One operation per open sink. */
export function installRecordingStorage(ipcMain, directory, authorize) {
  const sinks = new Map();
  let generation = 0;
  let cleanup = Promise.resolve();
  async function release(name, entry) {
    entry.busy = true;
    try {
      await entry.file.sync();
    } finally {
      try {
        await entry.file.close();
      } finally {
        sinks.delete(name);
        entry.resolveClosed();
      }
    }
  }
  function path(name) {
    if (typeof name !== 'string' || !RECORDING_NAME.test(name))
      throw new Error('Invalid recording name.');
    return join(directory, name);
  }
  ipcMain.handle('recording:storage', async (event, op, name, bytes, offset, length) => {
    authorize(event);
    const token = generation;
    await cleanup;
    await mkdir(directory, { recursive: true });
    if (token !== generation) throw new Error('Recording session closed.');
    if (op === 'list')
      return (await readdir(directory)).filter(
        (name) => name.endsWith('.irvis') || name.endsWith('.webm') || name.endsWith('.pcm'),
      );
    const filename = path(name);
    if (op === 'size') return (await stat(filename)).size;
    if (op === 'read') {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > 4 * 1024 * 1024
      )
        throw new Error('Invalid byte range.');
      const file = await open(filename, 'r');
      try {
        const buffer = Buffer.alloc(length);
        const result = await file.read(buffer, 0, length, offset);
        return buffer.subarray(0, result.bytesRead);
      } finally {
        await file.close();
      }
    }
    if (op === 'remove') {
      if (sinks.has(name)) throw new Error('Recording is still open.');
      await unlink(filename);
      return;
    }
    if (op === 'open') {
      if (sinks.has(name)) throw new Error('A recording is already open.');
      let resolveClosed;
      const closed = new Promise((resolve) => {
        resolveClosed = resolve;
      });
      const entry = { busy: true, file: null, closeRequested: false, closed, resolveClosed };
      sinks.set(name, entry);
      try {
        entry.file = await open(filename, 'wx');
        entry.busy = false;
        if (entry.closeRequested) {
          await release(name, entry);
          throw new Error('Recording session closed.');
        }
      } catch (e) {
        sinks.delete(name);
        entry.resolveClosed();
        throw e;
      }
      return;
    }
    const entry = sinks.get(name);
    if (!entry || entry.busy || entry.closeRequested)
      throw new Error('Recording is closed or busy.');
    entry.busy = true;
    try {
      if (op === 'append') {
        if (!(bytes instanceof Uint8Array) || bytes.length > 4 * 1024 * 1024)
          throw new Error('Invalid recording chunk.');
        let written = 0;
        while (written < bytes.length) {
          const result = await entry.file.write(bytes, written, bytes.length - written);
          if (!result.bytesWritten) throw new Error('Storage write made no progress.');
          written += result.bytesWritten;
        }
      } else if (op === 'flush') await entry.file.sync();
      else if (op === 'close') {
        await release(name, entry);
      } else throw new Error('Invalid recording operation.');
    } finally {
      entry.busy = false;
      if (entry.closeRequested && sinks.has(name)) await release(name, entry);
    }
  });
  return () => {
    generation++;
    const entries = [...sinks];
    // Mark every old handle before yielding; new sessions wait for this cleanup.
    for (const [, entry] of entries) entry.closeRequested = true;
    const previous = cleanup;
    cleanup = Promise.allSettled([
      previous,
      ...entries.map(([name, entry]) => (entry.busy ? entry.closed : release(name, entry))),
    ]).then(() => {});
    return cleanup;
  };
}

/**
 * Photos as PNG files in the app-owned `directory`: the renderer names a file,
 * never a path. A photo is written to `<name>.tmp` and renamed once complete,
 * so the list never shows part of one; the `.tmp` files a crash left are
 * deleted when the storage is installed. A photo's time is its file's
 * modification time.
 */
export function installPhotoStorage(ipcMain, directory, authorize) {
  function path(name) {
    if (typeof name !== 'string' || !PHOTO_NAME.test(name)) throw new Error('Invalid photo name.');
    return join(directory, name);
  }
  const tidied = readdir(directory)
    .then((names) =>
      Promise.all(
        names
          .filter((name) => name.endsWith('.tmp'))
          .map((name) => unlink(join(directory, name)).catch(() => {})),
      ),
    )
    .catch(() => {});
  ipcMain.handle('photo:storage', async (event, op, name, bytes, createdAt) => {
    authorize(event);
    await tidied;
    await mkdir(directory, { recursive: true });
    if (op === 'list') {
      const names = (await readdir(directory)).filter((file) => PHOTO_NAME.test(file));
      const photos = await Promise.all(
        names.map(async (file) => {
          try {
            const [bytes, info] = await Promise.all([
              readFile(join(directory, file)),
              stat(join(directory, file)),
            ]);
            return { name: file, createdAt: info.mtimeMs, bytes };
          } catch {
            // Deleted since the listing.
            return null;
          }
        }),
      );
      return photos.filter((photo) => photo !== null);
    }
    const filename = path(name);
    if (op === 'remove') {
      await unlink(filename);
      return;
    }
    if (op === 'save') {
      if (!(bytes instanceof Uint8Array)) throw new Error('Invalid photo.');
      if (!Number.isFinite(createdAt) || createdAt < 0) throw new Error('Invalid photo time.');
      if (await stat(filename).catch(() => null)) throw new Error(`${name} already exists.`);
      const temporary = filename + '.tmp';
      try {
        await writeFile(temporary, bytes);
        const time = new Date(createdAt);
        await utimes(temporary, time, time);
        await rename(temporary, filename);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      return;
    }
    throw new Error('Invalid photo operation.');
  });
}

/**
 * `files:save-as`: a copy or an export saved where the user chooses in the
 * system's save dialog (`showSaveDialog`, given the options, answering like
 * Electron's `dialog.showSaveDialog`). `what` is a file of the library
 * (`{ kind: 'recordings' | 'photos', name }`, copied in the main process) or
 * the bytes to write. The dialog opens in `folder` (Downloads in the app) with
 * the suggested name. Answers true once the file is written, false when the
 * user cancels; the renderer never learns the path.
 */
export function installSaveAs(ipcMain, { authorize, showSaveDialog, directories, folder }) {
  ipcMain.handle('files:save-as', async (event, suggestedName, what) => {
    authorize(event);
    if (typeof suggestedName !== 'string' || !suggestedName) throw new Error('Invalid file name.');
    let source;
    if (what instanceof Uint8Array) source = null;
    else if (what?.kind === 'recordings' && RECORDING_NAME.test(what.name))
      source = join(directories.recordings, what.name);
    else if (what?.kind === 'photos' && PHOTO_NAME.test(what.name))
      source = join(directories.photos, what.name);
    else throw new Error('Invalid file to save.');
    // Only the name is taken from the renderer, never a folder.
    const result = await showSaveDialog({ defaultPath: join(folder, basename(suggestedName)) });
    if (result.canceled || !result.filePath) return false;
    if (source) await copyFile(source, result.filePath);
    else await writeFile(result.filePath, what);
    return true;
  });
}

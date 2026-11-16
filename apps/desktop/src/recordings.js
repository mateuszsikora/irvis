import { mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

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
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]+\.(irvis|webm|pcm)$/.test(name))
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

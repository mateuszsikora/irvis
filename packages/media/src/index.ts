import type { ByteSink, ByteSource } from '@irvis/core';
export { createRecorder, type Recorder } from './recorder.ts';

export function fileByteSource(file: Blob): ByteSource {
  return {
    size: () => Promise.resolve(file.size),
    async read(offset, length) {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length < 0
      )
        throw new Error('Invalid byte range.');
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    },
  };
}
export interface RecordingFile {
  name: string;
  source: ByteSource;
}
export interface RecordingStorage {
  prepare(bytesPerSecond: number): Promise<string>;
  create(name: string): Promise<ByteSink>;
  list(): Promise<RecordingFile[]>;
  remove(name: string): Promise<void>;
}

/** One outstanding Worker operation; callers must await append to apply backpressure. */
function workerSink(name: string): Promise<ByteSink> {
  const worker = new Worker(new URL('./storage-worker.ts', import.meta.url), { type: 'module' });
  let pending: { resolve: () => void; reject: (error: Error) => void } | null = null;
  let closed = false;
  worker.onmessage = (event: MessageEvent<{ error?: string }>) => {
    const request = pending;
    pending = null;
    if (event.data.error) request?.reject(new Error(event.data.error));
    else request?.resolve();
  };
  worker.onerror = (event) => {
    closed = true;
    pending?.reject(new Error(event.message));
    pending = null;
    worker.terminate();
  };
  function request(op: string, bytes?: Uint8Array): Promise<void> {
    if (closed || pending) return Promise.reject(new Error('Storage is closed or busy.'));
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      worker.postMessage({ op, name, bytes });
    });
  }
  return request('open').then(
    () => ({
      append: (bytes: Uint8Array) => request('append', bytes),
      flush: () => request('flush'),
      async close() {
        if (closed) return;
        try {
          await request('close');
        } finally {
          closed = true;
          worker.terminate();
        }
      },
    }),
    (error: unknown) => {
      worker.terminate();
      throw error;
    },
  );
}

export function createBrowserRecordingStorage(): RecordingStorage {
  const memory = new Map<string, Uint8Array[]>();
  const opfs = typeof navigator.storage?.getDirectory === 'function';
  async function directory() {
    return (await navigator.storage.getDirectory()).getDirectoryHandle('irvis-recordings', {
      create: true,
    });
  }
  return {
    async prepare(bytesPerSecond) {
      if (!opfs)
        return 'Recording stays in memory. Closing this page loses it. Download it after stopping.';
      const persistent = await navigator.storage.persist().catch(() => false);
      const estimate = await navigator.storage.estimate();
      const seconds = Math.floor(
        Math.max(0, (estimate.quota ?? 0) - (estimate.usage ?? 0)) / bytesPerSecond,
      );
      return `${persistent ? 'Persistent storage enabled.' : 'Storage is not persistent; the browser may remove recordings.'} Estimated uncompressed capacity: ${seconds} seconds. Download backups.`;
    },
    async create(name) {
      if (!/^[a-zA-Z0-9_.-]+\.(irvis|webm)$/.test(name)) throw new Error('Invalid recording name.');
      if (opfs) return workerSink(name);
      if (memory.has(name)) throw new Error('Recording already exists.');
      const chunks: Uint8Array[] = [];
      memory.set(name, chunks);
      let closed = false;
      return {
        append(bytes) {
          if (closed) return Promise.reject(new Error('Storage is closed.'));
          chunks.push(bytes.slice());
          return Promise.resolve();
        },
        flush() {
          return closed ? Promise.reject(new Error('Storage is closed.')) : Promise.resolve();
        },
        close() {
          closed = true;
          return Promise.resolve();
        },
      };
    },
    async list() {
      if (!opfs)
        return [...memory].map(([name, chunks]) => ({
          name,
          source: fileByteSource(new Blob(chunks.map((c) => c.slice().buffer))),
        }));
      const dir = await directory();
      const result: RecordingFile[] = [];
      const entries = dir as FileSystemDirectoryHandle & {
        values(): AsyncIterable<FileSystemHandle>;
      };
      for await (const handle of entries.values()) {
        if (
          handle.kind === 'file' &&
          (handle.name.endsWith('.irvis') || handle.name.endsWith('.webm'))
        ) {
          const file = await handle.getFile();
          result.push({ name: file.name, source: fileByteSource(file) });
        }
      }
      return result;
    },
    async remove(name) {
      if (opfs) await (await directory()).removeEntry(name);
      else memory.delete(name);
    },
  };
}
export { exportMp4, saveRecordingFile } from './export.ts';
export { startMicrophone, type MicrophoneRecording } from './microphone.ts';

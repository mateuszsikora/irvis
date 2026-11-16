export {};
interface SyncHandle {
  write(bytes: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
}
let handle: SyncHandle | undefined;
let offset = 0;
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ op: string; name: string; bytes?: Uint8Array }>) => void;
  postMessage(value: object): void;
};
scope.onmessage = ({ data }) => {
  void (async () => {
    try {
      if (data.op === 'open') {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('irvis-recordings', { create: true });
        try {
          await dir.getFileHandle(data.name);
          throw new Error('Recording already exists.');
        } catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
        }
        const file = await dir.getFileHandle(data.name, { create: true });
        handle = await (
          file as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncHandle> }
        ).createSyncAccessHandle();
      } else if (!handle) throw new Error('Storage is closed.');
      else if (data.op === 'append') {
        const bytes = data.bytes!;
        let written = 0;
        while (written < bytes.length) {
          const count = handle.write(bytes.subarray(written), { at: offset });
          if (!count) throw new Error('Storage write made no progress.');
          written += count;
          offset += count;
        }
      } else if (data.op === 'flush') handle.flush();
      else if (data.op === 'close') {
        handle.flush();
        handle.close();
        handle = undefined;
      }
      scope.postMessage({});
    } catch (error) {
      scope.postMessage({ error: String(error) });
    }
  })();
};

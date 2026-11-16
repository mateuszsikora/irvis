import type { ByteSink, ByteSource } from '@irvis/core';
import type { DesktopBridge } from './index.ts';
export function createDesktopRecordingStorage(bridge: DesktopBridge) {
  const invoke = bridge.recordingStorage;
  if (!invoke) throw new Error('Desktop recording storage is unavailable.');
  const call = invoke;
  return {
    prepare: () =>
      Promise.resolve('Recordings are saved locally. Download backups before deleting them.'),
    async create(name: string): Promise<ByteSink> {
      await call('open', name);
      let busy = false;
      let closed = false;
      async function operation(op: string, bytes?: Uint8Array) {
        if (busy || closed) throw new Error('Recording is closed or busy.');
        busy = true;
        try {
          if (op === 'append' && bytes) {
            for (let offset = 0; offset < bytes.length; offset += 4 * 1024 * 1024)
              await call(op, name, bytes.subarray(offset, offset + 4 * 1024 * 1024));
          } else await call(op, name, bytes);
        } finally {
          busy = false;
        }
      }
      return {
        append: (bytes) => operation('append', bytes),
        flush: () => operation('flush'),
        async close() {
          if (!closed) {
            await operation('close');
            closed = true;
          }
        },
      };
    },
    async list() {
      const names = (await call('list')) as string[];
      return names.map((name) => {
        const source: ByteSource = {
          size: async () => (await call('size', name)) as number,
          async read(offset, length) {
            if (
              !Number.isSafeInteger(offset) ||
              offset < 0 ||
              !Number.isSafeInteger(length) ||
              length < 0
            )
              throw new Error('Invalid byte range.');
            const size = await source.size();
            const out = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
            for (let position = 0; position < out.length;) {
              const chunk = (await call(
                'read',
                name,
                undefined,
                offset + position,
                Math.min(4 * 1024 * 1024, out.length - position),
              )) as Uint8Array;
              if (!chunk.length) return out.subarray(0, position);
              out.set(chunk, position);
              position += chunk.length;
            }
            return out;
          },
        };
        return { name, source };
      });
    },
    async remove(name: string) {
      await call('remove', name);
    },
  };
}

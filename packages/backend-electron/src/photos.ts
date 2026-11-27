import type { DesktopBridge } from './index.ts';

/** The shape of `SavedPhoto` in `@irvis/ui`, which this package does not depend on. */
export interface DesktopPhoto {
  id: string;
  name: string;
  createdAt: number;
  bytes: Uint8Array;
}

/**
 * Photos as PNG files in the app's directory (`userData/photos`), through the
 * main process. A photo's id is its file name; its time is the file's
 * modification time, which `save` sets to `createdAt`.
 */
export function createDesktopPhotoLibrary(bridge: DesktopBridge) {
  const invoke = bridge.photoStorage;
  if (!invoke) throw new Error('Desktop photo storage is unavailable.');
  const call = invoke;
  return {
    async list(): Promise<DesktopPhoto[]> {
      const photos = (await call('list')) as {
        name: string;
        createdAt: number;
        bytes: Uint8Array;
      }[];
      return photos.map(({ name, createdAt, bytes }) => ({ id: name, name, createdAt, bytes }));
    },
    /** Written whole or not at all; a name already saved fails. */
    async save(photo: DesktopPhoto) {
      await call('save', photo.name, photo.bytes, photo.createdAt);
    },
    async remove(id: string) {
      await call('remove', id);
    },
  };
}

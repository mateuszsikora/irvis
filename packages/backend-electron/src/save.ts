import type { ByteSource } from '@irvis/core';
import type { DesktopBridge } from './index.ts';
import { libraryFiles } from './recordings.ts';

/**
 * `HostFiles.saveAs` of the desktop app: the main process shows the system's
 * save dialog and writes the file there. A recording of the library is copied
 * by the main process; anything else (a photo, an MP4, a flattened PNG) is
 * read here and sent. A cancelled dialog resolves without saving.
 */
export function desktopSaveAs(bridge: DesktopBridge) {
  const invoke = bridge.saveAs;
  return async (name: string, source: ByteSource): Promise<void> => {
    if (!invoke) throw new Error('Saving a copy is unavailable in this desktop app.');
    const file = libraryFiles.get(source);
    await invoke(name, file ?? (await source.read(0, await source.size())));
  };
}

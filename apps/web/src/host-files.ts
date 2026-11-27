import {
  createDesktopPhotoLibrary,
  createDesktopRecordingStorage,
  desktopSaveAs,
  type DesktopBridge,
} from '@irvis/backend-electron';
import { createBrowserRecordingStorage, saveRecordingFile } from '@irvis/media';
import type { HostFiles } from '@irvis/ui';
import { createPhotoLibrary } from './photo-library.ts';

/**
 * The files of this host. The desktop app keeps recordings and photos in its
 * own directory through the main process and saves copies through the
 * system's save dialog; the browser keeps recordings in OPFS and photos in
 * IndexedDB, and saves copies with its save picker or as downloads. A library
 * the host cannot keep (no OPFS, no IndexedDB) is left out.
 */
export function createHostFiles(bridge: DesktopBridge | undefined): HostFiles {
  if (bridge) {
    return {
      ...(bridge.recordingStorage && { recordings: createDesktopRecordingStorage(bridge) }),
      ...(bridge.photoStorage && { photos: createDesktopPhotoLibrary(bridge) }),
      saveAs: desktopSaveAs(bridge),
    };
  }
  const recordings = createBrowserRecordingStorage();
  return {
    ...(recordings && { recordings }),
    ...(typeof indexedDB !== 'undefined' && { photos: createPhotoLibrary() }),
    saveAs: saveRecordingFile,
  };
}

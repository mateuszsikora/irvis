import type { ByteSource } from '@irvis/core';
import type { RecordingStorage } from '@irvis/media';
import type { PhotoLibrary } from './photos.ts';

/**
 * Everything the viewer does with files, from its host. The viewer does not
 * know whether a file system, OPFS or IndexedDB is underneath. What the host
 * cannot do it leaves out, and the viewer turns the matching controls off.
 */
export interface HostFiles {
  /** The recordings library; without it, recording and the recording list are unavailable. */
  recordings?: RecordingStorage;
  /** The photo library; without it, Capture photo and Gallery are unavailable. */
  photos?: PhotoLibrary;
  /**
   * Saves a copy or an export (a recording, a sidecar, a photo, an MP4, a
   * flattened PNG) where the user chooses. A cancelled choice resolves without
   * saving and is not an error.
   */
  saveAs: (name: string, source: ByteSource) => Promise<void>;
}

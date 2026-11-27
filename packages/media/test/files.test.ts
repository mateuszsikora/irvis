import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserRecordingStorage, saveRecordingFile } from '../src/index.ts';

const source = {
  size: () => Promise.resolve(2),
  read: () => Promise.resolve(new Uint8Array([1, 2])),
};
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser files', () => {
  it('gives no recording storage without OPFS, rather than recordings kept in memory', () => {
    vi.stubGlobal('navigator', { storage: {} });
    expect(createBrowserRecordingStorage()).toBeUndefined();
    vi.stubGlobal('navigator', {});
    expect(createBrowserRecordingStorage()).toBeUndefined();
    vi.stubGlobal('navigator', { storage: { getDirectory: () => Promise.reject(new Error()) } });
    expect(createBrowserRecordingStorage()).toBeDefined();
  });

  it('saves nothing and reports nothing when the save picker is cancelled', async () => {
    const downloads: string[] = [];
    vi.stubGlobal('window', {
      showSaveFilePicker: () => Promise.reject(new DOMException('cancelled', 'AbortError')),
    });
    vi.stubGlobal('navigator', { userActivation: { isActive: true } });
    vi.stubGlobal('document', {
      createElement: () => ({
        click(this: { download: string }) {
          downloads.push(this.download);
        },
      }),
    });
    await expect(saveRecordingFile('clip.irvis', source)).resolves.toBeUndefined();
    expect(downloads).toEqual([]);
    // Another failure of the picker is still an error.
    vi.stubGlobal('window', {
      showSaveFilePicker: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
    });
    await expect(saveRecordingFile('clip.irvis', source)).rejects.toThrow('denied');
  });
});

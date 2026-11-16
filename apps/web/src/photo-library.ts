import type { PhotoLibrary, SavedPhoto } from '@irvis/ui';

/** The host injects durable photo storage into both browser and desktop views. */
export function createPhotoLibrary(factory: IDBFactory = indexedDB): PhotoLibrary {
  async function database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let blocked = false;
      const request = factory.open('irvis-photos', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
      request.onsuccess = () => {
        if (blocked) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('Photo storage could not open.'));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Photo storage is blocked by another window.'));
      };
    });
  }
  async function transaction<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await database();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction('photos', mode);
        const request = run(tx.objectStore('photos'));
        tx.oncomplete = () => {
          resolve(request.result);
        };
        tx.onabort = () => {
          reject(tx.error ?? request.error ?? new Error('Photo storage transaction failed.'));
        };
        tx.onerror = () => {
          /* onabort reports failure; never report success before commit. */
        };
      });
    } finally {
      db.close();
    }
  }
  return {
    list: () =>
      transaction<SavedPhoto[]>('readonly', (store) => store.getAll() as IDBRequest<SavedPhoto[]>),
    save: async (photo) => {
      await transaction('readwrite', (store) => store.add(photo));
    },
    remove: async (id) => {
      await transaction('readwrite', (store) => store.delete(id));
    },
  };
}

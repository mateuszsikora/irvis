import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createPhotoLibrary } from './photo-library.ts';

describe('photo storage', () => {
  it('persists photos across host instances and deletes only selected records', async () => {
    const factory = new IDBFactory();
    const first = createPhotoLibrary(factory);
    const photo = { id: 'one', name: 'one.png', createdAt: 1, bytes: new Uint8Array([1, 2, 3]) };
    await first.save(photo);
    await first.save({ ...photo, id: 'two', name: 'two.png' });
    const reopened = createPhotoLibrary(factory);
    expect((await reopened.list()).map((p) => ({ ...p, bytes: [...p.bytes] }))).toEqual([
      { ...photo, bytes: [1, 2, 3] },
      { ...photo, id: 'two', name: 'two.png', bytes: [1, 2, 3] },
    ]);
    await expect(reopened.save(photo)).rejects.toBeTruthy();
    expect(await reopened.list()).toHaveLength(2);
    await reopened.remove('one');
    expect((await first.list()).map((p) => p.id)).toEqual(['two']);
  });
});

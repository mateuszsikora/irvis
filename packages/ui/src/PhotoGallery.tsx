import { PhotoAnnotations } from './PhotoAnnotations.tsx';
import { useEffect, useState } from 'react';
import { memoryByteSource } from '@irvis/core';
import type { HostFiles } from './files.ts';
import type { PhotoLibrary, SavedPhoto } from './photos.ts';

function PhotoItem({
  photo,
  onOpen,
  onDownload,
  onDelete,
}: {
  photo: SavedPhoto;
  onOpen: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const value = URL.createObjectURL(
      new Blob([photo.bytes.slice().buffer], { type: 'image/png' }),
    );
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [photo]);
  return (
    <li>
      <img src={url || undefined} alt={`Captured preview of ${photo.name}`} width="128" />
      <span>{photo.name}</span>
      <button onClick={onOpen}>Analyze {photo.name}</button>
      <button onClick={onDownload}>Download {photo.name}</button>
      <button onClick={onDelete}>Delete {photo.name}</button>
    </li>
  );
}
export function PhotoGallery({
  library,
  saveAs,
  revision,
  onOpen,
}: {
  library: PhotoLibrary;
  /** Saves a copy of a photo, or a flattened annotated one, where the user chooses. */
  saveAs: HostFiles['saveAs'];
  revision: number;
  onOpen: (photo: SavedPhoto) => void;
}) {
  const [selected, setSelected] = useState('');
  const [annotation, setAnnotation] = useState<SavedPhoto | null>(null);
  const [photos, setPhotos] = useState<SavedPhoto[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void library
      .list()
      .then((items) => {
        if (alive) {
          setPhotos(items.sort((a, b) => b.createdAt - a.createdAt));
          setError('');
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [library, revision]);
  async function remove(photo: SavedPhoto) {
    try {
      await library.remove(photo.id);
      setPhotos((items) => items.filter((p) => p.id !== photo.id));
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }
  async function download(photo: SavedPhoto) {
    try {
      await saveAs(photo.name, memoryByteSource(photo.bytes));
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section aria-label="Photo gallery" className="photo-gallery">
      <h4>Photo gallery</h4>
      <p>
        Saved on this device. Download photos to keep a backup. Deleting a gallery item does not
        delete downloaded files or the photo currently being analyzed.
      </p>
      {error && <p role="alert">Gallery error: {error}</p>}
      {loading ? <p>Loading photos…</p> : photos.length === 0 ? <p>No saved photos.</p> : null}
      {annotation && <PhotoAnnotations photo={annotation} saveAs={saveAs} />}
      <ul>
        {photos.map((photo) => (
          <li key={photo.id}>
            <label>
              <input
                type="radio"
                name="selected-photo"
                checked={selected === photo.id}
                onChange={() => setSelected(photo.id)}
              />
              Select {photo.name}
            </label>
            <button onClick={() => setAnnotation(photo)}>Annotate {photo.name}</button>
            <ul>
              <PhotoItem
                key={photo.id}
                photo={photo}
                onOpen={() => onOpen(photo)}
                onDownload={() => void download(photo)}
                onDelete={() => void remove(photo)}
              />
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

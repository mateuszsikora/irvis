import { useEffect, useState } from 'react';
import type { PhotoLibrary, SavedPhoto } from './photos.ts';

function PhotoItem({
  photo,
  onOpen,
  onDelete,
}: {
  photo: SavedPhoto;
  onOpen: () => void;
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
      <a href={url} download={photo.name}>
        Download {photo.name}
      </a>
      <button onClick={onDelete}>Delete {photo.name}</button>
    </li>
  );
}
export function PhotoGallery({
  library,
  revision,
  onOpen,
}: {
  library: PhotoLibrary;
  revision: number;
  onOpen: (photo: SavedPhoto) => void;
}) {
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
  return (
    <section aria-label="Photo gallery" className="photo-gallery">
      <h3>Photo gallery</h3>
      <p>
        Saved on this device. Download photos to keep a backup. Deleting a gallery item does not
        delete downloaded files or the photo currently being analyzed.
      </p>
      {error && <p role="alert">Gallery error: {error}</p>}
      {loading ? <p>Loading photos…</p> : photos.length === 0 ? <p>No saved photos.</p> : null}
      <ul>
        {photos.map((photo) => (
          <PhotoItem
            key={photo.id}
            photo={photo}
            onOpen={() => onOpen(photo)}
            onDelete={() => void remove(photo)}
          />
        ))}
      </ul>
    </section>
  );
}

import { cameraProfiles, type CameraProfile } from '@irvis/core';

export interface AppProps {
  /** The supported cameras; the registry from core unless a test passes others. */
  readonly profiles?: readonly CameraProfile[];
}

export function App({ profiles = cameraProfiles }: AppProps) {
  return (
    <main>
      <h1>irvis</h1>
      <p>A viewer for USB-C thermal cameras. Work in progress.</p>
      {profiles.length === 0 ? (
        <p>No camera is supported yet.</p>
      ) : (
        <>
          <p>Supported cameras:</p>
          <ul>
            {profiles.map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

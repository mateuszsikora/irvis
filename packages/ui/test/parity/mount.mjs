import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Viewer } from '../../src/Viewer.tsx';
import { cameraProfiles } from '@irvis/core';
import { createReplayBackend } from '@irvis/backend-replay';
export function mount(frame) {
  globalThis.parityRoot?.unmount();
  const host = globalThis.document.createElement('main');
  globalThis.document.body.replaceChildren(host);
  globalThis.parityRoot = createRoot(host);
  globalThis.parityRoot.render(
    createElement(Viewer, {
      profile: cameraProfiles[0],
      backend: createReplayBackend([frame]),
    }),
  );
}

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CameraProfile } from '@irvis/core';
import { App } from './App.tsx';

afterEach(cleanup);

describe('App', () => {
  it('names the app', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('irvis');
  });

  it('says that no camera is supported while the registry is empty', () => {
    render(<App profiles={[]} />);
    expect(screen.getByText('No camera is supported yet.')).toBeTruthy();
  });

  it('lists the registered cameras by name', () => {
    const profiles = [
      { id: 'a', name: 'Camera A' },
      { id: 'b', name: 'Camera B' },
    ] as CameraProfile[];
    render(<App profiles={profiles} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Camera A',
      'Camera B',
    ]);
  });
});

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { cameraProfiles } from '@irvis/core';
import { startDiagnostics, type Analysis } from '@irvis/backend-browser';
import { Diagnostics } from './Diagnostics.tsx';
vi.mock('@irvis/backend-browser', async (original) => ({
  ...(await original<typeof import('@irvis/backend-browser')>()),
  startDiagnostics: vi.fn(() => vi.fn()),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
});
it('disables capture without a thermal profile mode', () => {
  render(<Diagnostics profiles={[]} />);
  expect(screen.getByText<HTMLButtonElement>('Start diagnostics').disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toBe('No thermal profile mode is available.');
});
it('tracks fps, exports evidence, remembers the device and resets a new session', async () => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: vi
        .fn()
        .mockResolvedValue([{ kind: 'videoinput', deviceId: 'camera', label: 'Thermal camera' }]),
    },
  });
  render(<Diagnostics profiles={cameraProfiles} />);
  fireEvent.click(screen.getByText('Refresh cameras'));
  await screen.findByText('Thermal camera');
  fireEvent.change(screen.getByLabelText('Camera'), { target: { value: 'camera' } });
  expect(localStorage.getItem('irvis.browser.deviceId')).toBe('camera');
  fireEvent.click(screen.getByText('Start diagnostics'));
  const callbacks = vi.mocked(startDiagnostics).mock.calls[0]![2];
  const result: Analysis = {
    info: {
      format: 'NV12',
      codedWidth: 2,
      codedHeight: 2,
      visibleRect: null,
      colorSpace: {},
      timestampUs: 1000000,
    },
    frame: {
      kind: 'yuv420',
      layout: 'nv12',
      width: 2,
      height: 2,
      timestamp: 1000,
      data: new Uint8Array([1, 2, 3]),
      planes: [],
    },
    reconstructionMs: 1,
    statistics: {
      minRaw: 1,
      maxRaw: 1,
      meanRaw: 1,
      centerRaw: 1,
      uncertainFraction: 0,
      highByteHistogram: [],
    },
  };
  act(() => {
    callbacks.metadata(result.info);
    callbacks.result(result);
  });
  act(() => callbacks.result({ ...result, frame: { ...result.frame, timestamp: 1040 } }));
  expect(screen.getByText('Processed fps: 25.00; frames: 2')).toBeTruthy();
  const blobs: Blob[] = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      blobs.push(blob);
      return 'blob:test';
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  fireEvent.click(screen.getByText('Download report'));
  fireEvent.click(screen.getByText('Download planar frame'));
  expect(names).toEqual(['m3-report.json', 'm3-planar.json']);
  const read = (blob: Blob) =>
    new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.readAsText(blob);
    });
  const report = await read(blobs[0]!);
  const dump = await read(blobs[1]!);
  expect(JSON.parse(report)).toMatchObject({ frames: 2, processedFps: 25 });
  expect(JSON.parse(dump)).toMatchObject({ frame: { data: [1, 2, 3], timestamp: 1040 } });
  expect(dump).not.toContain('\n');
  fireEvent.click(screen.getByText('Stop'));
  fireEvent.click(screen.getByText('Start diagnostics'));
  expect(screen.getByText('Processed fps: 0.00; frames: 0')).toBeTruthy();
  expect(screen.getByText<HTMLButtonElement>('Download planar frame').disabled).toBe(true);
});

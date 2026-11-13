import type { CameraProfile } from '../src/cameras/profile.ts';

/**
 * A consistent profile shaped like a 256×192 camera with a 256×384 YUYV mode.
 * Test data only: its constants are made up, not taken from a real camera.
 */
export function testProfile(overrides: Partial<CameraProfile> = {}): CameraProfile {
  const source = 'test data';
  return {
    id: 'test-camera',
    name: 'Test camera',
    identification: { usb: [{ vendorId: 0x0bda, productId: 0x5830 }], labelPattern: 'test' },
    videoModes: [
      {
        id: 'yuyv-256x384',
        width: 256,
        height: 384,
        fps: 25,
        pixelFormat: 'yuyv',
        layout: {
          image: { firstRow: 0, rows: 192 },
          thermal: { firstRow: 192, rows: 192, packing: 'u16le' },
        },
      },
      { id: 'yuyv-256x192', width: 256, height: 192, fps: 25, pixelFormat: 'yuyv', layout: null },
    ],
    sensor: {
      width: 256,
      height: 192,
      netd: { kelvin: 0.04, source, confidence: 'unverified' },
      accuracy: { celsius: 2, percent: 2, source, confidence: 'unverified' },
      ranges: [
        { gain: 'high', minCelsius: -20, maxCelsius: 150, source, confidence: 'unverified' },
        { gain: 'low', minCelsius: 100, maxCelsius: 600, source, confidence: 'unverified' },
      ],
    },
    conversions: [
      {
        gain: 'high',
        conversion: { kind: 'linear', scale: 1 / 64, offset: -273.15 },
        source,
        confidence: 'unverified',
      },
      {
        gain: 'low',
        conversion: { kind: 'polynomial', coefficients: [-273.15, 1 / 16] },
        source,
        confidence: 'unverified',
      },
    ],
    state: [
      {
        id: 'gain',
        label: 'Gain',
        kind: 'enum',
        values: ['high', 'low'],
        default: 'high',
        affects: 'meaning',
        refresh: 'command',
      },
      {
        id: 'sensor-temperature',
        label: 'Sensor temperature',
        kind: 'number',
        unit: '°C',
        default: 25,
        affects: 'meaning',
        refresh: 'second',
      },
    ],
    commands: [
      {
        id: 'nuc',
        label: 'Calibrate shutter',
        transport: {
          kind: 'vendor-control',
          requestType: 0x41,
          request: 0x45,
          value: 0x78,
          index: 0x1d00,
          data: [],
        },
        changes: [],
        source,
        confidence: 'unverified',
      },
      {
        id: 'gain-low',
        label: 'Low gain',
        transport: { kind: 'uvc-xu', unit: 3, selector: 1, data: [0x01] },
        changes: ['gain'],
        source,
        confidence: 'unverified',
      },
    ],
    ...overrides,
  };
}

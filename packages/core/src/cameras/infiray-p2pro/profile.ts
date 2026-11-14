// The InfiRay P2 Pro, sold as the TOOLTOP T7. Source and confidence of every
// constant: packages/core/src/cameras/infiray-p2pro/README.md
import type { CameraProfile } from '../profile.ts';

export const profile: CameraProfile = {
  id: 'infiray-p2pro',
  name: 'InfiRay P2 Pro',
  identification: {
    // Realtek bridge; the TOPDON TC001 reports the same pair.
    usb: [{ vendorId: 0x0bda, productId: 0x5830 }],
  },
  videoModes: [
    {
      id: 'yuyv-256x384',
      width: 256,
      height: 384,
      fps: 25,
      pixelFormat: 'yuyv',
      // Reported to carry raw data without any command; the M1 spike checks it.
      layout: {
        image: { firstRow: 0, rows: 192 },
        thermal: { firstRow: 192, rows: 192, packing: 'u16le' },
      },
    },
    { id: 'yuyv-256x192', width: 256, height: 192, fps: 25, pixelFormat: 'yuyv', layout: null },
  ],
  sensor: { width: 256, height: 192, ranges: [] },
  conversions: [
    {
      gain: 'high',
      // raw is in 1/64 K: °C = raw / 64 − 273.15. 1/64 is exact in binary.
      conversion: { kind: 'linear', scale: 1 / 64, offset: -273.15 },
      source:
        'alufers/thermal-cat src/camera_adapter/infiray_p2_pro.rs (raw / 64 in kelvin), ' +
        'atomic14/InfiRayCapture TemperatureProcessor.swift (raw / 64 − 273.2), ' +
        'EEVblog thread "InfiRay and their P2 Pro"; high gain only; to be verified in the M1 spike',
      confidence: 'reported',
    },
  ],
  state: [],
  commands: [],
};

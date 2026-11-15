// The InfiRay P2 Pro, sold as the TOOLTOP T7. Source and confidence of every
// constant: packages/core/src/cameras/infiray-p2pro/README.md
import type { CameraProfile } from '../profile.ts';

export const profile: CameraProfile = {
  id: 'infiray-p2pro',
  version: 1,
  name: 'InfiRay P2 Pro',
  identification: {
    // Realtek bridge; the TOPDON TC001 reports the same pair.
    usb: [
      { vendorId: 0x0bda, productId: 0x5830 },
      // TOOLTOP T7 observed during M1; also reported for compatible clones.
      { vendorId: 0x0bda, productId: 0x5840 },
    ],
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
  // Source: LeoDJ/P2Pro-Viewer P2Pro_cmd.py, set_prop_tpd_params.
  // Reported for P2 Pro; not yet verified on TOOLTOP T7. No NUC opcode is known.
  commands: [0, 1].map((gain) => ({
    id: gain === 1 ? 'gain-high' : 'gain-low',
    label: gain === 1 ? 'High gain' : 'Low gain',
    transport: {
      kind: 'vendor-control',
      requestType: 0x41,
      request: 0x45,
      value: 0x78,
      index: 0x9d00,
      data: [0x14, 0xc5, 0, 5, 0, 0, 0, gain],
    },
    followUp: [
      {
        kind: 'vendor-control',
        requestType: 0x41,
        request: 0x45,
        value: 0x78,
        index: 0x1d08,
        data: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
    changes: [],
    source: 'LeoDJ/P2Pro-Viewer P2Pro/P2Pro_cmd.py at 23887289d3841fdae25c3a11b8d3eed8cd778800',
    confidence: 'reported',
  })),
};

/** Reported protocol constants from P2Pro_cmd.py; experimental cur_vtemp read length. */
export const usbProtocol = {
  source: 'LeoDJ/P2Pro-Viewer P2Pro/P2Pro_cmd.py at 23887289d3841fdae25c3a11b8d3eed8cd778800',
  confidence: 'reported',
  writeType: 0x41,
  writeRequest: 0x45,
  readType: 0xc1,
  readRequest: 0x44,
  value: 0x78,
  status: 0x200,
  longHead: 0x9d00,
  longTail: 0x1d08,
  longResult: 0x1d10,
  standardHead: 0x1d00,
  tpd: 0x8514,
  set: 0x4000,
  palette: 0x8409,
  sensorTemperature: 0x8b0d,
  // cur_vtemp is named upstream but not called: retain bytes, do not decode a temperature.
  sensorTemperatureReadLength: 2,
  tpdNames: ['distance', 'tu', 'ta', 'ems', 'tau', 'gain'],
  // TOOLTOP T7 returned EMS=TAU=128 in M2; allow restoring those raw values.
  // The ratio divisor remains unverified despite the upstream claim of 127.
  tpdMax: [32767, 1024, 1024, 128, 128, 1],
} as const;

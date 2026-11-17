// The InfiRay P2 Pro, sold as the TOOLTOP T7. Source and confidence of every
// constant: packages/core/src/cameras/infiray-p2pro/README.md
import type { CameraProfile } from '../profile.ts';

export const profile: CameraProfile = {
  id: 'infiray-p2pro',
  version: 3,
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
  sensor: {
    width: 256,
    height: 192,
    ranges: [],
    netd: {
      kelvin: 0.07545446351476191,
      source:
        'TOOLTOP T7 static wall, 2026-11-16, session m1-scenes-1794808411555; median temporal population SD over original frames 1875–2130; scene estimate, not calibrated NETD',
      confidence: 'measured',
    },
  },
  conversions: [
    {
      gain: 'high',
      maxCelsius: 160,
      // k = 2 times the measured scene noise, rounded up to whole raw units.
      // docs/decisions/architecture.md#recording-defaults-use-twice-the-static-scene-noise
      recordingThreshold: 10,
      // raw is in 1/64 K: °C = raw / 64 − 273.15. 1/64 is exact in binary.
      conversion: { kind: 'linear', scale: 1 / 64, offset: -273.15 },
      source:
        'alufers/thermal-cat src/camera_adapter/infiray_p2_pro.rs (raw / 64 in kelvin), ' +
        'atomic14/InfiRayCapture TemperatureProcessor.swift (raw / 64 − 273.2), ' +
        'EEVblog thread "InfiRay and their P2 Pro"; high gain; 160 °C display limit from Android 3.07.48 inspected in M5',
      confidence: 'reported',
    },
    {
      gain: 'low',
      minCelsius: 90,
      conversion: { kind: 'linear', scale: 1 / 64, offset: -273.15 },
      source:
        'Infrared Thermal Imager 3.07.48 Tiny1C callback; M5 T7 hot-kettle gain cycle, ' +
        '2026-11-17; shared raw / 64 conversion and vendor display limits, not calibrated accuracy',
      confidence: 'reported',
    },
  ],
  state: [
    {
      id: 'gain',
      label: 'Sensor gain',
      kind: 'enum',
      values: ['high', 'low'],
      default: 'high',
      affects: 'meaning',
      refresh: 'command',
    },
    {
      id: 'emissivity',
      label: 'Camera emissivity',
      kind: 'number',
      unit: '',
      default: 1,
      affects: 'data',
      refresh: 'command',
    },
    {
      id: 'reflected-temperature',
      label: 'Camera reflected temperature',
      kind: 'number',
      unit: '°C',
      default: 300 - 273.15,
      affects: 'data',
      refresh: 'command',
    },
  ],
  // Source: LeoDJ/P2Pro-Viewer P2Pro_cmd.py, set_prop_tpd_params.
  // Gain and TPD readback were measured on TOOLTOP T7 in M5. No NUC opcode is verified.
  commands: [
    ...[0, 1].map((gain) => ({
      id: gain === 1 ? 'gain-high' : 'gain-low',
      label: gain === 1 ? 'High gain' : 'Low gain',
      transport: {
        kind: 'vendor-control' as const,
        requestType: 0x41,
        request: 0x45,
        value: 0x78,
        index: 0x9d00,
        data: [0x14, 0xc5, 0, 5, 0, 0, 0, gain],
      },
      followUp: [
        {
          kind: 'vendor-control' as const,
          requestType: 0x41,
          request: 0x45,
          value: 0x78,
          index: 0x1d08,
          data: [0, 0, 0, 0, 0, 0, 0, 0],
        },
      ],
      changes: ['gain'],
      source: 'LeoDJ/P2Pro-Viewer P2Pro/P2Pro_cmd.py at 23887289d3841fdae25c3a11b8d3eed8cd778800',
      confidence: 'reported' as const,
    })),
    ...[
      {
        id: 'emissivity',
        label: 'Camera emissivity',
        selector: 3,
        min: 0.5,
        max: 1,
        step: 1 / 128,
        default: 1,
        unit: '',
        scale: 128,
        offset: 0,
        readback: 'usb-ems',
        changes: ['emissivity'],
      },
      {
        id: 'reflected-temperature',
        label: 'Camera reflected temperature',
        selector: 1,
        min: -20,
        max: 120,
        step: 1,
        default: 300 - 273.15,
        unit: '°C',
        scale: 1,
        offset: 273.15,
        readback: 'usb-tu',
        changes: ['reflected-temperature'],
      },
      {
        id: 'ambient-temperature',
        label: 'Camera ambient temperature',
        selector: 2,
        min: -20,
        max: 50,
        step: 1,
        default: 300 - 273.15,
        unit: '°C',
        scale: 1,
        offset: 273.15,
        readback: 'usb-ta',
        changes: [],
      },
      {
        id: 'transmittance',
        label: 'Camera atmospheric transmittance',
        selector: 4,
        min: 0.5,
        max: 1,
        step: 1 / 128,
        default: 1,
        unit: '',
        scale: 128,
        offset: 0,
        readback: 'usb-tau',
        changes: [],
      },
    ].map(({ id, label, selector, changes, ...parameter }) => ({
      id: 'set-' + id,
      label,
      changes,
      parameter: { ...parameter, byteOffset: 4 },
      transport: {
        kind: 'vendor-control' as const,
        requestType: 0x41,
        request: 0x45,
        value: 0x78,
        index: 0x9d00,
        data: [0x14, 0xc5, 0, selector, 0, 0, 0, 0],
      },
      followUp: [
        {
          kind: 'vendor-control' as const,
          requestType: 0x41,
          request: 0x45,
          value: 0x78,
          index: 0x1d08,
          data: [0, 0, 0, 0, 0, 0, 0, 0],
        },
      ],
      source:
        'TOOLTOP T7 TC1_V1.02, M5 continuous hardware run, 2026-11-16; scale corroborated by mbuesch/p2pro-rs 091a10a',
      confidence: 'measured' as const,
    })),
  ],
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
  // M5 and the audit Android implementation corroborate a ratio divisor of 128.
  tpdMax: [32767, 1024, 1024, 128, 128, 1],
} as const;

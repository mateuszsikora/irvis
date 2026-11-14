import { describe, expect, it } from 'vitest';
import { testProfile } from '../../test/profiles.ts';
import type { CameraProfile, NumberStateField, VideoMode } from './profile.ts';
import { validateProfile } from './validate.ts';

const base = testProfile();

const emissivity: NumberStateField = {
  id: 'emissivity',
  label: 'Emissivity',
  kind: 'number',
  unit: '',
  default: 0.95,
  affects: 'data',
  refresh: 'command',
};
const reflected: NumberStateField = {
  id: 'reflected-temperature',
  label: 'Reflected temperature',
  kind: 'number',
  unit: '°C',
  default: 25,
  affects: 'data',
  refresh: 'command',
};

function withMode(changes: Partial<VideoMode>): CameraProfile {
  const [first, ...rest] = base.videoModes;
  if (!first) throw new Error('test profile has no video mode');
  return { ...base, videoModes: [{ ...first, ...changes }, ...rest] };
}

describe('validateProfile', () => {
  it('accepts a consistent profile', () => {
    expect(validateProfile(base)).toEqual([]);
  });

  it('rejects an id that is not kebab-case', () => {
    expect(validateProfile({ ...base, id: 'Test_Camera' })).toEqual([
      "id 'Test_Camera' is not kebab-case",
    ]);
  });

  it('rejects a version that is not a positive integer', () => {
    expect(validateProfile({ ...base, version: 0 })).toEqual([
      'version 0 is not a positive integer',
    ]);
    expect(validateProfile({ ...base, version: 1.5 })).toEqual([
      'version 1.5 is not a positive integer',
    ]);
  });

  it('rejects USB IDs that are not 16-bit integers', () => {
    const profile = { ...base, identification: { usb: [{ vendorId: 0x10000, productId: 1 }] } };
    expect(validateProfile(profile)).toEqual([
      'identification: USB ID 65536:1 is not two 16-bit integers',
    ]);
  });

  it('rejects a label pattern that does not compile', () => {
    const profile = { ...base, identification: { ...base.identification, labelPattern: '(' } };
    expect(validateProfile(profile)).toEqual([
      "identification: labelPattern '(' is not a valid regular expression",
    ]);
  });

  it('rejects thermal rows past the frame', () => {
    const problems = validateProfile(
      withMode({ layout: { thermal: { firstRow: 300, rows: 192, packing: 'u16le' } } }),
    );
    expect(problems).toContain(
      'videoModes.yuyv-256x384.layout.thermal: rows 300 to 491 go past the frame height 384',
    );
  });

  it('rejects overlapping image and thermal rows', () => {
    const layout = {
      image: { firstRow: 0, rows: 200 },
      thermal: { firstRow: 192, rows: 192, packing: 'u16le' as const },
    };
    expect(validateProfile(withMode({ layout }))).toEqual([
      'videoModes.yuyv-256x384.layout: image and thermal rows overlap',
    ]);
  });

  it('rejects a thermal region that does not match the sensor', () => {
    const layout = { thermal: { firstRow: 0, rows: 100, packing: 'u16le' as const } };
    expect(validateProfile(withMode({ layout }))).toEqual([
      "videoModes.yuyv-256x384.layout.thermal: 256×100 values do not match the sensor's 256×192",
    ]);
  });

  it('rejects an enable command that the profile does not have', () => {
    expect(validateProfile(withMode({ enableCommand: 'start-raw' }))).toEqual([
      "videoModes.yuyv-256x384: enableCommand 'start-raw' is not a command of the profile",
    ]);
  });

  it('requires one conversion per gain value', () => {
    const profile = { ...base, conversions: base.conversions.slice(0, 1) };
    expect(validateProfile(profile)).toEqual(["conversions: no conversion for gain 'low'"]);
  });

  it('rejects several conversions without a gain field', () => {
    const profile = { ...base, state: base.state.filter((f) => f.id !== 'gain'), commands: [] };
    expect(validateProfile(profile)).toEqual([
      "conversions: more than one, but there is no enum state field 'gain' to choose between them",
    ]);
  });

  it('rejects measurement ranges for unknown or repeated gain values', () => {
    const [high, low] = base.sensor.ranges;
    if (!high || !low) throw new Error('test profile has no ranges');
    const sensor = {
      ...base.sensor,
      ranges: [high, { ...low, gain: 'hgh' }, { ...low, gain: 'hgh' }],
    };
    expect(validateProfile({ ...base, sensor })).toEqual([
      "sensor.ranges: gain 'hgh' appears twice",
      "sensor.ranges[1]: 'hgh' is not a value of state field 'gain'",
      "sensor.ranges[2]: 'hgh' is not a value of state field 'gain'",
    ]);
  });

  it('rejects a linear conversion with scale 0', () => {
    const [first, ...rest] = base.conversions;
    if (!first) throw new Error('test profile has no conversion');
    const conversions = [
      { ...first, conversion: { kind: 'linear' as const, scale: 0, offset: 0 } },
      ...rest,
    ];
    expect(validateProfile({ ...base, conversions })).toEqual([
      'conversions.high: scale must be finite and not 0',
    ]);
  });

  it('requires a source for every constant', () => {
    const [first, ...rest] = base.conversions;
    if (!first) throw new Error('test profile has no conversion');
    expect(validateProfile({ ...base, conversions: [{ ...first, source: ' ' }, ...rest] })).toEqual(
      ['conversions.high: source is empty'],
    );
  });

  it('rejects a command that changes an unknown state field', () => {
    const [first, ...rest] = base.commands;
    if (!first) throw new Error('test profile has no command');
    const commands = [{ ...first, changes: ['palette'] }, ...rest];
    expect(validateProfile({ ...base, commands })).toEqual([
      "commands.nuc: changes unknown state field 'palette'",
    ]);
  });

  it('accepts the emissivity fields of a camera that applies emissivity itself', () => {
    const state = [...base.state, emissivity, reflected];
    expect(validateProfile({ ...base, state })).toEqual([]);
  });

  it('rejects emissivity fields that the correction cannot read', () => {
    expect(validateProfile({ ...base, state: [...base.state, emissivity] })).toEqual([
      "state.emissivity: needs the state field 'reflected-temperature' too",
    ]);
    expect(validateProfile({ ...base, state: [...base.state, reflected] })).toEqual([
      "state.reflected-temperature: needs the state field 'emissivity' too",
    ]);
    const meaning = { ...emissivity, affects: 'meaning' as const };
    const kelvin = { ...reflected, unit: 'K' };
    expect(validateProfile({ ...base, state: [...base.state, meaning, kelvin] })).toEqual([
      "state.emissivity: must be a number field with affects 'data' and unit '', because the emissivity correction reads it",
      "state.reflected-temperature: must be a number field with affects 'data' and unit '°C', because the emissivity correction reads it",
    ]);
    const outOfRange = [
      { ...emissivity, default: 0 },
      { ...reflected, default: -300 },
    ];
    expect(validateProfile({ ...base, state: [...base.state, ...outOfRange] })).toEqual([
      'state.emissivity: default must be greater than 0 and at most 1',
      'state.reflected-temperature: default must be above -273.15 °C',
    ]);
    const notFinite = [
      { ...emissivity, default: Number.NaN },
      { ...reflected, default: Number.NaN },
    ];
    expect(validateProfile({ ...base, state: [...base.state, ...notFinite] })).toEqual([
      'state.emissivity: default must be finite',
      'state.reflected-temperature: default must be finite',
    ]);
  });

  it('rejects transport values outside their USB field size', () => {
    const [first, ...rest] = base.commands;
    if (!first) throw new Error('test profile has no command');
    const transport = {
      kind: 'vendor-control' as const,
      requestType: 0x100,
      request: 0,
      value: 0,
      index: 0,
      data: [256],
    };
    expect(validateProfile({ ...base, commands: [{ ...first, transport }, ...rest] })).toEqual([
      'commands.nuc: requestType must be an integer from 0 to 255',
      'commands.nuc: every data byte must be 0 to 255',
    ]);
  });
});

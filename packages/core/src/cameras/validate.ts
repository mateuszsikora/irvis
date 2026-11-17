import type {
  CameraProfile,
  Conversion,
  Provenance,
  RowRange,
  UvcExtensionUnitTransport,
  VendorControlTransport,
} from './profile.ts';
import { EMISSIVITY_FIELD, REFLECTED_TEMPERATURE_FIELD } from './fields.ts';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONFIDENCE = new Set(['confirmed', 'measured', 'reported', 'unverified']);

function isUint(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) twice.add(v);
    seen.add(v);
  }
  return [...twice];
}

function checkProvenance(where: string, p: Provenance, out: string[]): void {
  if (p.source.trim() === '') out.push(`${where}: source is empty`);
  if (!CONFIDENCE.has(p.confidence))
    out.push(`${where}: unknown confidence '${String(p.confidence)}'`);
}

function checkConversion(where: string, c: Conversion, out: string[]): void {
  switch (c.kind) {
    case 'linear':
      if (!Number.isFinite(c.scale) || c.scale === 0)
        out.push(`${where}: scale must be finite and not 0`);
      if (!Number.isFinite(c.offset)) out.push(`${where}: offset must be finite`);
      break;
    case 'polynomial':
      if (c.coefficients.length < 2)
        out.push(`${where}: a polynomial needs at least two coefficients`);
      if (!c.coefficients.every(Number.isFinite))
        out.push(`${where}: every coefficient must be finite`);
      break;
    case 'lut':
      if (!isUint(c.firstRaw, 0xffff))
        out.push(`${where}: firstRaw must be an integer from 0 to 65535`);
      if (c.celsius.length === 0) out.push(`${where}: the table is empty`);
      if (c.firstRaw + c.celsius.length - 1 > 0xffff)
        out.push(`${where}: the table goes past raw 65535`);
      if (!c.celsius.every(Number.isFinite)) out.push(`${where}: every table value must be finite`);
      break;
  }
}

// The corrections read these two fields from a frame's camera state by id:
// docs/decisions/architecture.md#the-software-correction-works-relative-to-what-the-camera-applied
function checkCorrectionFields(profile: CameraProfile, out: string[]): void {
  const reserved: [string, string, string][] = [
    [EMISSIVITY_FIELD, '', REFLECTED_TEMPERATURE_FIELD],
    [REFLECTED_TEMPERATURE_FIELD, '°C', EMISSIVITY_FIELD],
  ];
  for (const [id, unit, partner] of reserved) {
    const field = profile.state.find((f) => f.id === id);
    if (!field) continue;
    if (!profile.state.some((f) => f.id === partner)) {
      out.push(`state.${id}: needs the state field '${partner}' too`);
    }
    if (field.kind !== 'number' || field.affects !== 'data' || field.unit !== unit) {
      out.push(
        `state.${id}: must be a number field with affects 'data' and unit '${unit}', because the emissivity correction reads it`,
      );
      continue;
    }
    // A default that is not finite already has its message.
    if (!Number.isFinite(field.default)) continue;
    if (id === EMISSIVITY_FIELD && !(field.default > 0 && field.default <= 1)) {
      out.push(`state.${id}: default must be greater than 0 and at most 1`);
    }
    if (id === REFLECTED_TEMPERATURE_FIELD && !(field.default > -273.15)) {
      out.push(`state.${id}: default must be above -273.15 °C`);
    }
  }
}

function checkTransport(
  where: string,
  t: VendorControlTransport | UvcExtensionUnitTransport,
  out: string[],
): void {
  const fields: [string, number, number][] =
    t.kind === 'vendor-control'
      ? [
          ['requestType', t.requestType, 0xff],
          ['request', t.request, 0xff],
          ['value', t.value, 0xffff],
          ['index', t.index, 0xffff],
        ]
      : [
          ['unit', t.unit, 0xff],
          ['selector', t.selector, 0xff],
        ];
  for (const [name, value, max] of fields) {
    if (!isUint(value, max))
      out.push(`${where}: ${name} must be an integer from 0 to ${String(max)}`);
  }
  if (!t.data.every((b) => isUint(b, 0xff))) out.push(`${where}: every data byte must be 0 to 255`);
}

function overlaps(a: RowRange, b: RowRange): boolean {
  return a.firstRow < b.firstRow + b.rows && b.firstRow < a.firstRow + a.rows;
}

/**
 * What is wrong with a profile, one message per problem; empty when the
 * profile is consistent. Checks what the type system cannot: identifiers,
 * ranges, references between parts, and provenance.
 */
export function validateProfile(profile: CameraProfile): string[] {
  const out: string[] = [];
  const { identification, sensor } = profile;

  if (!KEBAB.test(profile.id)) out.push(`id '${profile.id}' is not kebab-case`);
  if (!isPositiveInt(profile.version))
    out.push(`version ${String(profile.version)} is not a positive integer`);
  if (profile.name.trim() === '') out.push('name is empty');

  if (identification.usb.length === 0) out.push('identification: no USB ID');
  for (const { vendorId, productId } of identification.usb) {
    if (!isUint(vendorId, 0xffff) || !isUint(productId, 0xffff)) {
      out.push(
        `identification: USB ID ${String(vendorId)}:${String(productId)} is not two 16-bit integers`,
      );
    }
  }
  if (identification.labelPattern !== undefined) {
    try {
      new RegExp(identification.labelPattern, 'i');
    } catch {
      out.push(
        `identification: labelPattern '${identification.labelPattern}' is not a valid regular expression`,
      );
    }
  }

  if (!isPositiveInt(sensor.width) || !isPositiveInt(sensor.height)) {
    out.push('sensor: width and height must be positive integers');
  }
  if (sensor.netd) {
    checkProvenance('sensor.netd', sensor.netd, out);
    if (!(sensor.netd.kelvin > 0)) out.push('sensor.netd: kelvin must be greater than 0');
  }
  if (sensor.accuracy) {
    checkProvenance('sensor.accuracy', sensor.accuracy, out);
    if (!(sensor.accuracy.celsius >= 0) || !(sensor.accuracy.percent >= 0)) {
      out.push('sensor.accuracy: celsius and percent must be 0 or more');
    }
  }
  for (const [i, r] of sensor.ranges.entries()) {
    checkProvenance(`sensor.ranges[${String(i)}]`, r, out);
    if (!(r.minCelsius < r.maxCelsius))
      out.push(`sensor.ranges[${String(i)}]: minCelsius must be below maxCelsius`);
  }

  const stateIds = profile.state.map((f) => f.id);
  for (const id of duplicates(stateIds)) out.push(`state: field '${id}' appears twice`);
  for (const field of profile.state) {
    if (!KEBAB.test(field.id)) out.push(`state: field id '${field.id}' is not kebab-case`);
    if (field.kind === 'enum') {
      if (field.values.length === 0) out.push(`state.${field.id}: no values`);
      for (const v of duplicates(field.values))
        out.push(`state.${field.id}: value '${v}' appears twice`);
      if (!field.values.includes(field.default)) {
        out.push(`state.${field.id}: default '${field.default}' is not one of its values`);
      }
    } else if (!Number.isFinite(field.default)) {
      out.push(`state.${field.id}: default must be finite`);
    }
  }

  checkCorrectionFields(profile, out);

  const commandIds = profile.commands.map((c) => c.id);
  for (const id of duplicates(commandIds)) out.push(`commands: '${id}' appears twice`);
  for (const command of profile.commands) {
    const where = `commands.${command.id}`;
    if (!KEBAB.test(command.id)) out.push(`commands: id '${command.id}' is not kebab-case`);
    checkProvenance(where, command, out);
    const parameter = command.parameter;
    if (parameter) {
      const values = [
        parameter.min,
        parameter.max,
        parameter.default,
        parameter.step,
        parameter.scale,
        parameter.offset,
      ];
      if (
        !values.every(Number.isFinite) ||
        parameter.min > parameter.max ||
        parameter.default < parameter.min ||
        parameter.default > parameter.max ||
        parameter.step <= 0 ||
        parameter.scale <= 0 ||
        Math.round(parameter.min * parameter.scale + parameter.offset) < 0 ||
        Math.round(parameter.max * parameter.scale + parameter.offset) > 0xffffffff
      )
        out.push(where + ': invalid numeric command parameter');
      if (
        command.transport.kind !== 'vendor-control' ||
        !Number.isInteger(parameter.byteOffset) ||
        parameter.byteOffset < 0 ||
        parameter.byteOffset + 4 > command.transport.data.length
      )
        out.push(where + ': parameter must fit a u32 in the first vendor transfer');
      if (!KEBAB.test(parameter.readback)) out.push(where + ': invalid parameter readback field');
    }
    checkTransport(where, command.transport, out);
    for (const transfer of command.followUp ?? []) checkTransport(where, transfer, out);
    for (const id of command.changes) {
      if (!stateIds.includes(id)) out.push(`${where}: changes unknown state field '${id}'`);
    }
  }

  if (profile.videoModes.length === 0) out.push('videoModes: none');
  for (const id of duplicates(profile.videoModes.map((m) => m.id)))
    out.push(`videoModes: '${id}' appears twice`);
  for (const mode of profile.videoModes) {
    const where = `videoModes.${mode.id}`;
    if (!KEBAB.test(mode.id)) out.push(`videoModes: id '${mode.id}' is not kebab-case`);
    if (!isPositiveInt(mode.width) || !isPositiveInt(mode.height)) {
      out.push(`${where}: width and height must be positive integers`);
    }
    if (!(mode.fps > 0)) out.push(`${where}: fps must be greater than 0`);
    if (mode.enableCommand !== undefined && !commandIds.includes(mode.enableCommand)) {
      out.push(`${where}: enableCommand '${mode.enableCommand}' is not a command of the profile`);
    }
    if (mode.layout === null) continue;
    const { image, thermal } = mode.layout;
    for (const [name, range] of [
      ['image', image],
      ['thermal', thermal],
    ] as const) {
      if (range === undefined) continue;
      if (!isUint(range.firstRow, mode.height - 1) || !isPositiveInt(range.rows)) {
        out.push(`${where}.layout.${name}: firstRow and rows must be integers inside the frame`);
      } else if (range.firstRow + range.rows > mode.height) {
        out.push(
          `${where}.layout.${name}: rows ${String(range.firstRow)} to ${String(range.firstRow + range.rows - 1)} go past the frame height ${String(mode.height)}`,
        );
      }
    }
    if (image && overlaps(image, thermal))
      out.push(`${where}.layout: image and thermal rows overlap`);
    if (mode.width !== sensor.width || thermal.rows !== sensor.height) {
      out.push(
        `${where}.layout.thermal: ${String(mode.width)}×${String(thermal.rows)} values do not match the sensor's ${String(sensor.width)}×${String(sensor.height)}`,
      );
    }
  }

  if (profile.conversions.length === 0) out.push('conversions: none');
  for (const g of duplicates(profile.conversions.map((c) => c.gain))) {
    out.push(`conversions: gain '${g}' appears twice`);
  }
  const gainField = profile.state.find((f) => f.id === 'gain');
  if (gainField?.kind === 'number')
    out.push('state.gain: must be an enum, because it selects the conversion');
  if (gainField?.kind === 'enum') {
    for (const g of gainField.values) {
      if (!profile.conversions.some((c) => c.gain === g))
        out.push(`conversions: no conversion for gain '${g}'`);
    }
  } else if (profile.conversions.length > 1) {
    out.push(
      "conversions: more than one, but there is no enum state field 'gain' to choose between them",
    );
  }
  for (const g of duplicates(sensor.ranges.map((r) => r.gain))) {
    out.push(`sensor.ranges: gain '${g}' appears twice`);
  }
  if (gainField?.kind === 'enum') {
    for (const [i, r] of sensor.ranges.entries()) {
      if (!gainField.values.includes(r.gain)) {
        out.push(`sensor.ranges[${String(i)}]: '${r.gain}' is not a value of state field 'gain'`);
      }
    }
  }
  for (const c of profile.conversions) {
    const where = `conversions.${c.gain}`;
    checkProvenance(where, c, out);
    checkConversion(where, c.conversion, out);
    if (
      (c.minCelsius !== undefined && !Number.isFinite(c.minCelsius)) ||
      (c.maxCelsius !== undefined && !Number.isFinite(c.maxCelsius)) ||
      (c.minCelsius !== undefined && c.maxCelsius !== undefined && c.minCelsius >= c.maxCelsius)
    )
      out.push(`${where}: temperature limits must be finite and increasing`);
    if (c.recordingThreshold !== undefined && !isUint(c.recordingThreshold, 32767)) {
      out.push(`${where}: recordingThreshold must be an integer from 0 to 32767`);
    }
    if (gainField?.kind === 'enum' && !gainField.values.includes(c.gain)) {
      out.push(`${where}: '${c.gain}' is not a value of state field 'gain'`);
    }
  }

  return out;
}

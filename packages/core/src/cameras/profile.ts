// The camera profile schema. What each part is for:
// docs/decisions/architecture.md#a-camera-is-a-profile-and-its-conversion-is-data

/**
 * How sure we are of a constant:
 * - `confirmed`: several independent sources agree, or a measurement against a reference;
 * - `measured`: measured by this project on a real camera;
 * - `reported`: one public source (a forum post, another project's code);
 * - `unverified`: a guess or an inference that nobody has checked.
 */
export type Confidence = 'confirmed' | 'measured' | 'reported' | 'unverified';

/** Where a constant comes from. Every profile constant carries one. */
export interface Provenance {
  /** A link, a document or a measurement, in words a reader can follow. */
  readonly source: string;
  readonly confidence: Confidence;
}

/** A USB vendor and product ID pair. */
export interface UsbId {
  /** 0 to 0xffff. */
  readonly vendorId: number;
  /** 0 to 0xffff. */
  readonly productId: number;
}

/**
 * How a device is matched to this profile. Several profiles may list the same
 * USB ID (the TOOLTOP T7 and the TOPDON TC001 both use 0x5830); then
 * `labelPattern` decides, and when it does not, the user chooses.
 */
export interface CameraIdentification {
  /** At least one. */
  readonly usb: readonly UsbId[];
  /** Regular expression source, matched case-insensitively against the device label. */
  readonly labelPattern?: string;
}

/** A block of whole rows in a video frame. */
export interface RowRange {
  /** First row, from 0. */
  readonly firstRow: number;
  /** Number of rows, at least 1. */
  readonly rows: number;
}

/**
 * Where the temperature data are in a frame of a video mode.
 * `u16le`: one little-endian 16-bit raw value per pixel, filling the YUYV
 * bytes in order (`[Y0 U Y1 V]` = `[p0.lo p0.hi p1.lo p1.hi]`).
 */
export interface FrameLayout {
  /** Rows with the camera's own processed image, if the mode has them. */
  readonly image?: RowRange;
  /** Rows with the raw values; as many as the sensor has, each `sensor.width` values wide. */
  readonly thermal: RowRange & { readonly packing: 'u16le' };
}

/** One video mode the camera offers over UVC. */
export interface VideoMode {
  /** Unique in the profile, kebab-case, for example `yuyv-256x384`. */
  readonly id: string;
  /** Pixels per row of the video frame. */
  readonly width: number;
  /** Rows of the video frame. */
  readonly height: number;
  /** Frames per second. */
  readonly fps: number;
  readonly pixelFormat: 'yuyv';
  /** CameraCommand.id to run before the stream carries `layout`; absent when no command is needed. */
  readonly enableCommand?: string;
  /** Null when the mode carries no temperature data. */
  readonly layout: FrameLayout | null;
}

/** °C = raw × scale + offset. */
export interface LinearConversion {
  readonly kind: 'linear';
  readonly scale: number;
  readonly offset: number;
}

/** °C = c0 + c1·raw + c2·raw² + …, evaluated by multiplication only (Horner's scheme). */
export interface PolynomialConversion {
  readonly kind: 'polynomial';
  /** c0 first; at least two. */
  readonly coefficients: readonly number[];
}

/** °C = celsius[raw − firstRaw]; raw values outside the table have no temperature. */
export interface LookupConversion {
  readonly kind: 'lut';
  readonly firstRaw: number;
  readonly celsius: readonly number[];
}

/**
 * How raw values become degrees Celsius: data, not code, so that a recording
 * can be read without the profile.
 * TODO(owner): parameters that change every frame (such as the sensor
 * temperature) are not modelled yet; #7 adds them once the camera state is known.
 */
export type Conversion = LinearConversion | PolynomialConversion | LookupConversion;

/** The conversion that applies in one gain mode. */
export interface ProfileConversion extends Provenance {
  /** A value of the `gain` state field; any string when the profile has no such field. */
  readonly gain: string;
  readonly conversion: Conversion;
  /** Suggested .irvis error bound in raw units for this gain; writers still take an explicit threshold. */
  readonly recordingThreshold?: number;
  /** Readings outside these limits are uncertain; this is not an accuracy specification. */
  readonly minCelsius?: number;
  readonly maxCelsius?: number;
}

/** A temperature range the camera measures in one gain mode. */
export interface MeasurementRange extends Provenance {
  readonly gain: string;
  readonly minCelsius: number;
  readonly maxCelsius: number;
}

/** The thermal sensor. */
export interface SensorSpec {
  /** Thermal pixels per row. */
  readonly width: number;
  /** Thermal rows. */
  readonly height: number;
  /** Noise-equivalent temperature difference in kelvin; sets the default recording threshold. */
  readonly netd?: Provenance & { readonly kelvin: number };
  /** The larger of ± `celsius` and ± `percent` of the reading. */
  readonly accuracy?: Provenance & { readonly celsius: number; readonly percent: number };
  readonly ranges: readonly MeasurementRange[];
}

/**
 * When the desktop app reads a state field: at connect and after every
 * command (`command`), or also about once a second (`second`).
 */
export type StateRefresh = 'command' | 'second';

interface StateFieldBase {
  /**
   * Unique in the profile, kebab-case. Reserved ids: `gain` selects the
   * conversion; `emissivity` and `reflected-temperature` are what the camera
   * applies to the raw values itself (see `fields.ts`).
   */
  readonly id: string;
  readonly label: string;
  /** `data`: the field changes the raw values. `meaning`: it changes how they are read. */
  readonly affects: 'data' | 'meaning';
  readonly refresh: StateRefresh;
}

export interface EnumStateField extends StateFieldBase {
  readonly kind: 'enum';
  /** At least one, unique. */
  readonly values: readonly string[];
  /** What the browser assumes until the user declares otherwise. */
  readonly default: string;
}

export interface NumberStateField extends StateFieldBase {
  readonly kind: 'number';
  /** For example `°C`, `m`, or an empty string for a ratio. */
  readonly unit: string;
  readonly default: number;
}

/** A setting the camera keeps that changes the data or their meaning. */
export type CameraStateField = EnumStateField | NumberStateField;

/** Values of the state fields, by CameraStateField.id. */
export type CameraStateValues = Readonly<Record<string, string | number>>;

/**
 * The camera state a frame was taken in. `camera`: read from the camera.
 * `declared`: set by the user. `assumed`: the profile's defaults, because
 * nobody could read or declare it (the browser before the user confirms).
 */
export interface CameraStateSnapshot {
  readonly origin: 'camera' | 'declared' | 'assumed';
  readonly values: CameraStateValues;
}

/** A USB vendor control transfer. */
export interface VendorControlTransport {
  readonly kind: 'vendor-control';
  /** bmRequestType, 0 to 0xff. */
  readonly requestType: number;
  /** bRequest, 0 to 0xff. */
  readonly request: number;
  /** wValue, 0 to 0xffff. */
  readonly value: number;
  /** wIndex, 0 to 0xffff. */
  readonly index: number;
  /** Payload bytes, each 0 to 0xff. */
  readonly data: readonly number[];
}

/** A UVC extension unit control. */
export interface UvcExtensionUnitTransport {
  readonly kind: 'uvc-xu';
  /** Extension unit ID, 0 to 0xff. */
  readonly unit: number;
  /** Control selector, 0 to 0xff. */
  readonly selector: number;
  /** Payload bytes, each 0 to 0xff. */
  readonly data: readonly number[];
}

/**
 * A command the desktop app can send. The UI builds its controls from these.
 * Multi-transfer commands send followUp in order before polling completion.
 */
export interface CameraCommand extends Provenance {
  /** Unique in the profile, kebab-case, for example `nuc`. */
  readonly id: string;
  readonly label: string;
  readonly transport: VendorControlTransport | UvcExtensionUnitTransport;
  /** Remaining vendor transfers, sent in order before checking device status. */
  readonly followUp?: readonly VendorControlTransport[];
  /** CameraStateField.id values that the command changes; re-read after it runs. */
  readonly changes: readonly string[];
  /** Numeric UI value encoded into the first vendor transfer as an unsigned BE u32. */
  readonly parameter?: {
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly default: number;
    readonly unit: string;
    readonly scale: number;
    readonly offset: number;
    readonly byteOffset: number;
    /** Snapshot field containing the raw integer readback. */
    readonly readback: string;
  };
}

/** Everything irvis knows about one camera model. */
export interface CameraProfile {
  /** Unique in the registry, kebab-case, equal to the profile's directory name. */
  readonly id: string;
  /**
   * A positive integer, raised whenever a constant that changes readings
   * changes. Every .irvis file records the id and version it was made with.
   */
  readonly version: number;
  /** Shown to the user, for example `InfiRay P2 Pro`. */
  readonly name: string;
  readonly identification: CameraIdentification;
  /** At least one. */
  readonly videoModes: readonly VideoMode[];
  readonly sensor: SensorSpec;
  /** At least one; one per value of the `gain` state field when the profile has it. */
  readonly conversions: readonly ProfileConversion[];
  readonly state: readonly CameraStateField[];
  readonly commands: readonly CameraCommand[];
}

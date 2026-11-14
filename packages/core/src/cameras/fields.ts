// State fields that the corrections read by id. Why the emissivity
// fields are reserved names:
// docs/decisions/architecture.md#the-software-correction-works-relative-to-what-the-camera-applied

/**
 * The emissivity the camera applies to the raw values itself, a number in
 * (0, 1] with `affects: 'data'` and unit `''`. A camera that keeps an
 * emissivity only for its own image gives that field another id.
 */
export const EMISSIVITY_FIELD = 'emissivity';

/**
 * The reflected temperature in °C that the camera applies to the raw values
 * together with `emissivity`, with `affects: 'data'` and unit `°C`.
 */
export const REFLECTED_TEMPERATURE_FIELD = 'reflected-temperature';

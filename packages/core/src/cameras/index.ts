// The camera registry. Adding a camera: a directory <id>/ with profile.ts and
// README.md, and one entry in cameraProfiles below. How:
// docs/features/cameras-user.md#add-a-camera
import { profile as infirayP2Pro } from './infiray-p2pro/profile.ts';
import type { CameraProfile } from './profile.ts';

export type * from './profile.ts';
export { toCelsius, toCelsiusArray } from './conversion.ts';
export { validateProfile } from './validate.ts';

/** Every camera irvis supports, compiled into the app. */
export const cameraProfiles: readonly CameraProfile[] = [infirayP2Pro];

/** What a backend knows about a device; the browser usually knows only the label. */
export interface DeviceDescription {
  readonly vendorId?: number;
  readonly productId?: number;
  readonly label?: string;
}

/** The profile with this id, or undefined. */
export function findProfile(
  id: string,
  profiles: readonly CameraProfile[] = cameraProfiles,
): CameraProfile | undefined {
  return profiles.find((p) => p.id === id);
}

function labelMatches(profile: CameraProfile, label: string | undefined): boolean {
  const pattern = profile.identification.labelPattern;
  return pattern !== undefined && label !== undefined && new RegExp(pattern, 'i').test(label);
}

/**
 * The profiles that may fit a device, best first. With USB IDs, the profiles
 * that list them; if several do and the label matches the labelPattern of
 * some, only those. Without USB IDs, the profiles whose labelPattern matches
 * the label. More than one result means the user has to choose.
 */
export function matchProfiles(
  device: DeviceDescription,
  profiles: readonly CameraProfile[] = cameraProfiles,
): CameraProfile[] {
  const { vendorId, productId, label } = device;
  if (vendorId === undefined || productId === undefined) {
    return profiles.filter((p) => labelMatches(p, label));
  }
  const byUsb = profiles.filter((p) =>
    p.identification.usb.some((u) => u.vendorId === vendorId && u.productId === productId),
  );
  const byLabel = byUsb.filter((p) => labelMatches(p, label));
  return byUsb.length > 1 && byLabel.length > 0 ? byLabel : byUsb;
}

import * as Location from 'expo-location';

export type ForegroundLocationAccessResult =
  | { ok: true }
  | { ok: false; reason: 'services_disabled' | 'permission_denied' };

export type BackgroundLocationAccessResult =
  | { ok: true }
  | { ok: false; reason: 'services_disabled' | 'permission_denied' };

export async function ensureForegroundLocationAccess(): Promise<ForegroundLocationAccessResult> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) {
    return { ok: false, reason: 'services_disabled' };
  }

  let { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Location.requestForegroundPermissionsAsync());
  }

  if (status !== 'granted') {
    return { ok: false, reason: 'permission_denied' };
  }

  return { ok: true };
}

/**
 * Request "always" / background location permission.
 * Must be called AFTER foreground permission is already granted —
 * iOS and Android both require foreground first.
 *
 * Returns { ok: false } if permission is denied; the caller should
 * continue without background tracking rather than blocking the walk.
 */
export async function ensureBackgroundLocationAccess(): Promise<BackgroundLocationAccessResult> {
  // Background permission requires foreground to already be granted
  const foreground = await ensureForegroundLocationAccess();
  if (!foreground.ok) return foreground;

  let { status } = await Location.getBackgroundPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Location.requestBackgroundPermissionsAsync());
  }

  if (status !== 'granted') {
    return { ok: false, reason: 'permission_denied' };
  }

  return { ok: true };
}

import * as Location from 'expo-location';

export type ForegroundLocationAccessResult =
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

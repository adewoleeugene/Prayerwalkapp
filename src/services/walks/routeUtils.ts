import { calculateDistance } from '../../lib/db';

export type LatLng = { latitude: number; longitude: number };

export function parseGeoPoint(pointLike: unknown): LatLng | null {
  if (!pointLike) return null;

  try {
    const parsed = typeof pointLike === 'string' ? JSON.parse(pointLike) : pointLike;
    const coords = (parsed as any)?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const latitude = Number(coords[1]);
      const longitude = Number(coords[0]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude };
      }
    }

    const latitude = Number((parsed as any)?.latitude ?? (parsed as any)?.lat);
    const longitude = Number((parsed as any)?.longitude ?? (parsed as any)?.lng);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  } catch {
    return null;
  }

  return null;
}

export function parsePointLabel(pointLike: unknown): string | null {
  if (!pointLike) return null;

  try {
    const parsed = typeof pointLike === 'string' ? JSON.parse(pointLike) : pointLike;
    const raw =
      (parsed as any)?.label ||
      (parsed as any)?.startAddress ||
      (parsed as any)?.address ||
      (parsed as any)?.properties?.label ||
      (parsed as any)?.properties?.startAddress ||
      (parsed as any)?.properties?.address;
    const label = typeof raw === 'string' ? raw.trim() : '';
    return label || null;
  } catch {
    return null;
  }
}

export function parseParticipants(participantsLike: unknown): string[] {
  if (!participantsLike) return [];

  if (Array.isArray(participantsLike)) {
    return participantsLike.map((name) => String(name).trim()).filter(Boolean);
  }

  if (typeof participantsLike === 'string') {
    try {
      const parsed = JSON.parse(participantsLike);
      if (Array.isArray(parsed)) {
        return parsed.map((name) => String(name).trim()).filter(Boolean);
      }
      const raw = participantsLike.trim();
      return raw ? [raw] : [];
    } catch {
      const raw = participantsLike.trim();
      return raw ? [raw] : [];
    }
  }

  return [];
}

export function normalizeSearchText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function parseCoordinateSearchTerm(term: string): LatLng | null {
  const raw = String(term || '').trim();
  if (!raw) return null;

  const normalized = raw.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  let latStr = '';
  let lngStr = '';

  if (normalized.includes(',')) {
    const parts = normalized.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      latStr = parts[0];
      lngStr = parts[1];
    }
  } else {
    const parts = normalized.split(' ').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      latStr = parts[0];
      lngStr = parts[1];
    }
  }

  if (!latStr || !lngStr) return null;
  const latitude = Number(latStr);
  const longitude = Number(lngStr);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export function calculateDistanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371e3;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

export function cleanRoutePoints(points: LatLng[]) {
  if (points.length < 2) return points;

  const cleaned: LatLng[] = [points[0]];
  const MAX_POINT_JUMP_METERS = 350;

  for (let i = 1; i < points.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    const next = points[i];
    const jump = calculateDistanceMeters(prev, next);
    if (jump <= MAX_POINT_JUMP_METERS) {
      cleaned.push(next);
    }
  }

  return cleaned;
}

export function toWalkLabel(startLocationName: string | null, endLocationName: string | null, fallback: string): string {
  if (startLocationName && endLocationName) {
    if (startLocationName === endLocationName) return startLocationName;
    return `${startLocationName} -> ${endLocationName}`;
  }
  if (endLocationName) return endLocationName;
  if (startLocationName) return startLocationName;
  return fallback;
}

export function generateCheckpoints(startLat: number, startLng: number, targetLat: number, targetLng: number) {
  const distance = calculateDistance(startLat, startLng, targetLat, targetLng);
  const numPoints = Math.floor(distance / 100);

  const checkpoints = [];
  if (numPoints <= 1) return [];

  for (let i = 1; i < numPoints; i++) {
    const ratio = i / numPoints;
    const lat = startLat + (targetLat - startLat) * ratio;
    const lng = startLng + (targetLng - startLng) * ratio;
    checkpoints.push({
      location: JSON.stringify({ type: 'Point', coordinates: [lng, lat] }),
      order: i,
    });
  }
  return checkpoints;
}

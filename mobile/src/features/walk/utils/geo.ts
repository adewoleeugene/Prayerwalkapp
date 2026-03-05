export type LatLng = { latitude: number; longitude: number };

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

export function parseParticipantsLike(participantsLike: unknown): string[] {
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
    } catch {
      return participantsLike.split(',').map((name) => name.trim()).filter(Boolean);
    }
  }
  return [];
}

export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}

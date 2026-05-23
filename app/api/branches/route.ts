import { type NextRequest } from 'next/server';
import { executeRawQuery, calculateDistance } from '@/lib/db';
import { requireDeviceAuth, handleError } from '@/lib/apiHelpers';

type BranchRow = {
  id: string; name: string; slug: string; center_lat: number; center_lng: number;
  service_radius_meters: number; country: string | null; region: string | null;
  is_active: boolean; sort_order: number;
};

export async function GET(request: NextRequest) {
  try {
    await requireDeviceAuth(request);
    const { searchParams } = new URL(request.url);
    const latRaw = searchParams.get('lat');
    const lngRaw = searchParams.get('lng');
    const radiusRaw = searchParams.get('radius');

    const latitude = latRaw !== null ? Number(latRaw) : NaN;
    const longitude = lngRaw !== null ? Number(lngRaw) : NaN;
    const hasRadius = radiusRaw !== null && radiusRaw.trim().length > 0;
    const radiusMeters = hasRadius ? Number(radiusRaw) : null;

    if (
      (latRaw !== null && !Number.isFinite(latitude)) ||
      (lngRaw !== null && !Number.isFinite(longitude)) ||
      (hasRadius && (!Number.isFinite(radiusMeters) || (radiusMeters as number) <= 0))
    ) {
      return Response.json({ error: 'Invalid lat/lng/radius query params' }, { status: 400 });
    }

    const rows = await executeRawQuery<BranchRow[]>(
      `SELECT id, name, slug, center_lat, center_lng, service_radius_meters, country, region, is_active, sort_order
       FROM branches WHERE is_active = true ORDER BY sort_order ASC, name ASC`
    );

    const withDistance = rows.map((branch) => {
      const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);
      const distanceMeters = hasCoords
        ? calculateDistance(latitude, longitude, Number(branch.center_lat), Number(branch.center_lng))
        : null;
      return {
        id: branch.id, name: branch.name, slug: branch.slug,
        lat: Number(branch.center_lat), lng: Number(branch.center_lng),
        radiusMeters: Number(branch.service_radius_meters),
        country: branch.country, region: branch.region,
        isActive: branch.is_active, sortOrder: Number(branch.sort_order),
        distanceMeters,
        distanceKm: distanceMeters === null ? null : Number((distanceMeters / 1000).toFixed(2)),
      };
    });

    const filtered = Number.isFinite(latitude) && Number.isFinite(longitude)
      ? withDistance.filter(b => !hasRadius || (b.distanceMeters ?? Infinity) <= (radiusMeters as number))
      : withDistance;

    const sorted = Number.isFinite(latitude) && Number.isFinite(longitude)
      ? filtered.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity))
      : filtered;

    return Response.json({ success: true, count: sorted.length, branches: sorted });
  } catch (error) {
    return handleError(error);
  }
}

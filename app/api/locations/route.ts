import { type NextRequest } from 'next/server';
import { executeRawQuery, findLocationsNearby, parsePoint } from '@/lib/db';
import { requireDeviceAuth, handleError } from '@/lib/apiHelpers';

export async function GET(request: NextRequest) {
  try {
    await requireDeviceAuth(request);
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');
    const radius = searchParams.get('radius');
    const category = searchParams.get('category');

    if (lat && lng) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);
      const radiusMeters = parseFloat(radius || '5000');

      if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusMeters)) {
        return Response.json({ error: 'Invalid coordinates or radius' }, { status: 400 });
      }

      const locations = await findLocationsNearby(latitude, longitude, radiusMeters);
      const filtered = category ? locations.filter((l: any) => l.category === category) : locations;

      return Response.json({
        success: true,
        count: filtered.length,
        locations: filtered.map((l: any) => ({
          ...l,
          location: parsePoint(l.location),
          radiusMeters: Number(l.radius_meters),
          distanceMeters: Number(l.distance_meters),
        })),
      });
    }

    let whereClause = 'WHERE is_active = true';
    const params: any[] = [];
    if (category) {
      params.push(category);
      whereClause += ' AND category = $1';
    }

    const locations: any[] = await executeRawQuery(
      `SELECT id, name, description, address, prayer_text, category, difficulty, points, radius_meters,
              ST_AsGeoJSON(CASE WHEN left(trim(location::text), 1) = '{' THEN ST_SetSRID(ST_GeomFromGeoJSON(location::text), 4326) ELSE location::geometry END) as location
       FROM prayer_locations ${whereClause} ORDER BY created_at DESC`,
      params
    );

    return Response.json({
      success: true,
      count: locations.length,
      locations: locations.map(l => ({
        ...l,
        location: parsePoint(l.location),
        radiusMeters: Number(l.radius_meters),
        prayerText: l.prayer_text,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

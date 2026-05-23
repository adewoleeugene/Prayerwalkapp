import { type NextRequest } from 'next/server';
import { executeRawQuery, parsePoint } from '@/lib/db';
import { requireAuth, handleError } from '@/lib/apiHelpers';

const LOCATION_GEOM_EXPR = `CASE WHEN left(trim(location::text), 1) = '{' THEN ST_SetSRID(ST_GeomFromGeoJSON(location::text), 4326) ELSE location::geometry END`;

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const { role } = user;
    if (role !== 'admin' && role !== 'superadmin') {
      return Response.json({ error: 'Search is restricted to admin and super admin users.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    if (q.length < 2) return Response.json({ error: 'Query must be at least 2 characters' }, { status: 400 });

    const latitude = searchParams.get('lat') ? Number(searchParams.get('lat')) : null;
    const longitude = searchParams.get('lng') ? Number(searchParams.get('lng')) : null;
    const hasUserPoint = Number.isFinite(latitude) && Number.isFinite(longitude);
    const qLike = `%${q}%`;
    const qPrefix = `${q}%`;

    const locationsSql = hasUserPoint
      ? `SELECT id, name, address, category, points, radius_meters, prayer_text,
                ST_AsGeoJSON(${LOCATION_GEOM_EXPR}) AS location,
                ST_Distance(${LOCATION_GEOM_EXPR}::geography, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography) AS distance_meters
         FROM prayer_locations WHERE is_active = true AND (name ILIKE $1 OR address ILIKE $1 OR category ILIKE $1)
         ORDER BY CASE WHEN name ILIKE $4 THEN 0 WHEN name ILIKE $1 THEN 1 WHEN address ILIKE $4 THEN 2 ELSE 3 END, distance_meters ASC, name ASC LIMIT 8`
      : `SELECT id, name, address, category, points, radius_meters, prayer_text,
                ST_AsGeoJSON(${LOCATION_GEOM_EXPR}) AS location, NULL::double precision AS distance_meters
         FROM prayer_locations WHERE is_active = true AND (name ILIKE $1 OR address ILIKE $1 OR category ILIKE $1)
         ORDER BY CASE WHEN name ILIKE $2 THEN 0 WHEN name ILIKE $1 THEN 1 WHEN address ILIKE $2 THEN 2 ELSE 3 END, name ASC LIMIT 8`;

    const locationsParams = hasUserPoint ? [qLike, latitude, longitude, qPrefix] : [qLike, qPrefix];

    const walkRows: any[] = await executeRawQuery(
      `SELECT ps.id AS session_id, ps.user_id, ps.status, ps.branch, ps.start_time, ps.end_time, ps.prayer_summary, ps.participants,
              pl.name AS location_name, u.name AS user_name, u.email AS user_email
       FROM prayer_sessions ps LEFT JOIN prayer_locations pl ON pl.id = ps.location_id LEFT JOIN users u ON u.id = ps.user_id
       WHERE ps.status IN ('active', 'completed', 'abandoned') AND (ps.prayer_summary ILIKE $1 OR ps.branch ILIKE $1 OR pl.name ILIKE $1 OR ps.participants ILIKE $1)
       ORDER BY CASE WHEN pl.name ILIKE $2 THEN 0 WHEN ps.prayer_summary ILIKE $2 THEN 1 WHEN ps.branch ILIKE $2 THEN 2 ELSE 3 END, ps.updated_at DESC LIMIT 8`,
      [qLike, qPrefix]
    );

    const locationRows: any[] = await executeRawQuery(locationsSql, locationsParams);

    return Response.json({
      success: true, query: q,
      locations: locationRows.map(row => ({
        id: row.id, name: row.name, address: row.address, category: row.category,
        points: Number(row.points || 0), radiusMeters: Number(row.radius_meters || 0), prayerText: row.prayer_text,
        distanceMeters: row.distance_meters === null || row.distance_meters === undefined ? null : Number(row.distance_meters),
        location: parsePoint(row.location),
      })),
      walks: walkRows.map(row => ({
        sessionId: row.session_id, userId: row.user_id, status: row.status, branch: row.branch,
        startedAt: row.start_time, endedAt: row.end_time, prayerSummary: row.prayer_summary,
        locationName: row.location_name, walkerDisplayName: row.user_name || row.user_email || 'Unknown',
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

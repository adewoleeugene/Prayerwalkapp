import { type NextRequest } from 'next/server';
import { executeRawQuery, parsePoint } from '@/lib/db';
import { requireDeviceAuth, handleError } from '@/lib/apiHelpers';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireDeviceAuth(request);
    const { id } = await params;

    const locs: any[] = await executeRawQuery(
      `SELECT id, name, description, address, prayer_text, category, difficulty, points, radius_meters, is_active,
              ST_AsGeoJSON(CASE WHEN left(trim(location::text), 1) = '{' THEN ST_SetSRID(ST_GeomFromGeoJSON(location::text), 4326) ELSE location::geometry END) as location
       FROM prayer_locations WHERE id = $1::uuid`,
      [id]
    );
    if (!locs[0]) return Response.json({ error: 'Location not found' }, { status: 404 });
    const location = locs[0];
    if (!location.is_active) return Response.json({ error: 'Location is not active' }, { status: 403 });

    const prayers: any[] = await executeRawQuery(
      `SELECT id, title, content, scripture_reference, duration_minutes FROM prayers WHERE location_id = $1::uuid`, [id]
    );
    const completion: any[] = await executeRawQuery(
      `SELECT completed_at FROM completions WHERE user_id = $1::uuid AND location_id = $2::uuid`, [user.userId, id]
    );
    const completionCount: any[] = await executeRawQuery(
      `SELECT COUNT(*) as count FROM completions WHERE location_id = $1::uuid`, [id]
    );

    return Response.json({
      success: true,
      location: {
        ...location,
        location: parsePoint(location.location),
        radiusMeters: Number(location.radius_meters),
        prayerText: location.prayer_text,
        prayers: prayers.map(p => ({ ...p, scriptureReference: p.scripture_reference, durationMinutes: p.duration_minutes })),
        isCompleted: completion.length > 0,
        completedAt: completion.length > 0 ? completion[0].completed_at : null,
        completionCount: Number(completionCount[0].count),
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

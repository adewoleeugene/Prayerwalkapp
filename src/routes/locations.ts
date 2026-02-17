import { Router, Request, Response } from 'express';
import { executeRawQuery, findLocationsNearby, parsePoint } from '../lib/db';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

// GET /locations - List all or nearby locations
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { lat, lng, radius, category } = req.query;

    if (lat && lng) {
      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lng as string);
      const radiusMeters = parseFloat(radius as string || '5000');

      if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusMeters)) {
        res.status(400).json({ error: 'Invalid coordinates or radius' });
        return;
      }

      const locations = await findLocationsNearby(latitude, longitude, radiusMeters);

      const filtered = category
        ? locations.filter((l: any) => l.category === category)
        : locations;

      res.json({
        success: true,
        count: filtered.length,
        locations: filtered.map((l: any) => ({
          ...l,
          location: parsePoint(l.location),
          radiusMeters: Number(l.radius_meters),
          distanceMeters: Number(l.distance_meters),
        })),
      });
      return;
    }

    const whereClause = `WHERE is_active = true`;
    const params: any[] = [];
    if (category) {
      params.push(category);
      whereClause += ` AND category = $1`;
    }

    const locations: any[] = await executeRawQuery(
      `SELECT id, name, description, address, prayer_text, category, difficulty, points, radius_meters, ST_AsGeoJSON(location) as location 
         FROM prayer_locations 
         ${whereClause} 
         ORDER BY created_at DESC`,
      params
    );

    res.json({
      success: true,
      count: locations.length,
      locations: locations.map(l => ({
        ...l,
        location: parsePoint(l.location),
        radiusMeters: Number(l.radius_meters),
        points: l.points,
        // map other snake_case to camelCase if needed, but returning as is mostly fine for API except specific contracts
        prayerText: l.prayer_text,
      })),
    });
  } catch (error) {
    console.error('List locations error:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// GET /locations/:id - Location details
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const locs: any[] = await executeRawQuery(
      `SELECT id, name, description, address, prayer_text, category, difficulty, points, radius_meters, is_active, ST_AsGeoJSON(location) as location 
         FROM prayer_locations WHERE id = $1::uuid`,
      [id]
    );

    if (locs.length === 0) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }
    const location = locs[0];

    if (!location.is_active) {
      res.status(403).json({ error: 'Location is not active' });
      return;
    }

    const prayers: any[] = await executeRawQuery(
      `SELECT id, title, content, scripture_reference, duration_minutes 
         FROM prayers WHERE location_id = $1::uuid`,
      [id]
    );

    const completion: any[] = await executeRawQuery(
      `SELECT completed_at FROM completions WHERE user_id = $1::uuid AND location_id = $2::uuid`,
      [userId, id]
    );

    const completionCount: any[] = await executeRawQuery(
      `SELECT COUNT(*) as count FROM completions WHERE location_id = $1::uuid`,
      [id]
    );

    res.json({
      success: true,
      location: {
        ...location,
        location: parsePoint(location.location),
        radiusMeters: Number(location.radius_meters),
        prayerText: location.prayer_text,
        prayers: prayers.map(p => ({
          ...p,
          scriptureReference: p.scripture_reference,
          durationMinutes: p.duration_minutes
        })),
        isCompleted: completion.length > 0,
        completedAt: completion.length > 0 ? completion[0].completed_at : null,
        completionCount: Number(completionCount[0].count),
      },
    });

  } catch (error) {
    console.error('Get location error:', error);
    res.status(500).json({ error: 'Failed to fetch location' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { executeRawQuery, calculateDistance } from '../lib/db';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

type BranchRow = {
  id: string;
  name: string;
  slug: string;
  center_lat: number;
  center_lng: number;
  service_radius_meters: number;
  country: string | null;
  region: string | null;
  is_active: boolean;
  sort_order: number;
};

// GET /branches - Active branches, optionally sorted by proximity
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const latRaw = req.query.lat;
    const lngRaw = req.query.lng;
    const radiusRaw = req.query.radius;

    const latitude = typeof latRaw === 'string' ? Number(latRaw) : NaN;
    const longitude = typeof lngRaw === 'string' ? Number(lngRaw) : NaN;
    const radiusMeters =
      typeof radiusRaw === 'string' && radiusRaw.trim()
        ? Number(radiusRaw)
        : Number.POSITIVE_INFINITY;

    if (
      (latRaw !== undefined && !Number.isFinite(latitude)) ||
      (lngRaw !== undefined && !Number.isFinite(longitude)) ||
      !Number.isFinite(radiusMeters) ||
      radiusMeters <= 0
    ) {
      res.status(400).json({ error: 'Invalid lat/lng/radius query params' });
      return;
    }

    const rows = await executeRawQuery<BranchRow[]>(
      `SELECT id, name, slug, center_lat, center_lng, service_radius_meters, country, region, is_active, sort_order
       FROM branches
       WHERE is_active = true
       ORDER BY sort_order ASC, name ASC`
    );

    const withDistance = rows.map((branch) => {
      const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);
      const distanceMeters = hasCoords
        ? calculateDistance(latitude, longitude, Number(branch.center_lat), Number(branch.center_lng))
        : null;

      return {
        id: branch.id,
        name: branch.name,
        slug: branch.slug,
        lat: Number(branch.center_lat),
        lng: Number(branch.center_lng),
        radiusMeters: Number(branch.service_radius_meters),
        country: branch.country,
        region: branch.region,
        isActive: branch.is_active,
        sortOrder: Number(branch.sort_order),
        distanceMeters,
        distanceKm: distanceMeters === null ? null : Number((distanceMeters / 1000).toFixed(2)),
      };
    });

    const filtered =
      Number.isFinite(latitude) && Number.isFinite(longitude)
        ? withDistance.filter((branch) => (branch.distanceMeters ?? Infinity) <= radiusMeters)
        : withDistance;

    const sorted =
      Number.isFinite(latitude) && Number.isFinite(longitude)
        ? filtered.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity))
        : filtered;

    res.json({
      success: true,
      count: sorted.length,
      branches: sorted,
    });
  } catch (error) {
    console.error('List branches error:', error);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

export default router;

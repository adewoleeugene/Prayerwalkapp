import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// PostGIS helper functions
export async function executeRawQuery<T = any>(
  query: string,
  params: any[] = []
): Promise<T> {
  return prisma.$queryRawUnsafe<T>(query, ...params);
}

export const executePostGISQuery = executeRawQuery;

// Create a Point from lat/lng
export function createPoint(latitude: number, longitude: number): string {
  return JSON.stringify({
    type: 'Point',
    coordinates: [longitude, latitude]
  });
}

// Parse Point from database
export function parsePoint(pointStr: string): { latitude: number; longitude: number } | null {
  try {
    const point = JSON.parse(pointStr);
    return {
      latitude: point.coordinates[1],
      longitude: point.coordinates[0]
    };
  } catch {
    return null;
  }
}

// Calculate distance between two points using Haversine formula
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Calculate distance using PostGIS (more accurate)
export async function calculateDistancePostGIS(
  point1: { latitude: number; longitude: number },
  point2: { latitude: number; longitude: number }
): Promise<number> {
  const result = await executeRawQuery<{ distance: number }[]>(
    `SELECT ST_Distance(
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
      ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
    ) as distance`,
    [point1.longitude, point1.latitude, point2.longitude, point2.latitude]
  );
  return result[0]?.distance || 0;
}

// Find locations within radius using PostGIS
export async function findLocationsNearby(
  latitude: number,
  longitude: number,
  radiusMeters: number
) {
  return executeRawQuery(`
    SELECT 
      id,
      name,
      description,
      ST_AsGeoJSON(location) as location,
      address,
      prayer_text,
      category,
      difficulty,
      points,
      radius_meters,
      ST_Distance(
        location::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
      ) as distance_meters
    FROM prayer_locations
    WHERE is_active = true
    AND ST_DWithin(
      location::geography,
      ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
      $3
    )
    ORDER BY distance_meters
  `, [latitude, longitude, radiusMeters]);
}

// Check if user is within range of a location
export async function isWithinRange(
  userLat: number,
  userLng: number,
  locationId: string
): Promise<{ withinRange: boolean; distance: number; requiredRadius: number }> {
  const result = await executeRawQuery<any[]>(`
    SELECT 
      ST_Distance(
        location::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
      ) as distance,
      radius_meters
    FROM prayer_locations
    WHERE id = $3
  `, [userLat, userLng, locationId]);

  if (!result[0]) {
    return { withinRange: false, distance: 0, requiredRadius: 0 };
  }

  const distance = parseFloat(result[0].distance);
  const requiredRadius = parseFloat(result[0].radius_meters);

  return {
    withinRange: distance <= requiredRadius,
    distance,
    requiredRadius
  };
}

export default prisma;

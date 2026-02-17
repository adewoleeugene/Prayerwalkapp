import { prisma } from "../lib/prisma";

export async function isUserNearLocation(
  locationId: string,
  lat: number,
  lng: number
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ is_near: boolean }[]>`
    SELECT ST_DWithin(
      ST_SetSRID(ST_MakePoint(pl.longitude, pl.latitude), 4326)::geography,
      ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
      COALESCE(pl.radius_meters, 50)
    ) AS is_near
    FROM prayer_locations pl
    WHERE pl.id = ${locationId}
    LIMIT 1
  `;

  return Boolean(rows[0]?.is_near);
}

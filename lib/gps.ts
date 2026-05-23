import { prisma } from '@/lib/db';

const MAX_HUMAN_SPEED_MS = 10;
const TELEPORT_THRESHOLD_METERS = 500;

export interface GPSUpdate {
  latitude: number;
  longitude: number;
  speed?: number;
  accuracy?: number;
  altitude?: number;
  isMock?: boolean;
  timestamp?: number;
  clientEventAt?: string;
  clientRequestId?: string;
}

type GPSValidationResult = {
  acceptedAt: string;
  idempotentReplay: boolean;
};

const MAX_EVENT_FUTURE_SKEW_MS = 15 * 60 * 1000;

function parseClientEventAt(raw?: string): Date | null {
  if (!raw || typeof raw !== 'string') return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export async function validateGPSUpdate(sessionId: string, userId: string, update: GPSUpdate): Promise<GPSValidationResult> {
  const { latitude, longitude, speed, isMock, accuracy, clientEventAt, clientRequestId } = update;
  const serverNow = new Date();
  const normalizedClientRequestId = typeof clientRequestId === 'string' ? clientRequestId.trim().slice(0, 64) : '';

  if (normalizedClientRequestId) {
    const existingRows = await prisma.$queryRawUnsafe<Array<{ timestamp: Date }>>(
      `SELECT "timestamp" FROM gps_events WHERE session_id = $1::uuid AND client_request_id = $2 LIMIT 1`,
      sessionId, normalizedClientRequestId
    );
    if (existingRows[0]?.timestamp) {
      return { acceptedAt: new Date(existingRows[0].timestamp).toISOString(), idempotentReplay: true };
    }
  }

  const parsedClientEventAt = parseClientEventAt(clientEventAt);
  let eventAt = parsedClientEventAt || serverNow;
  let clockSkewAdjusted = false;

  if (eventAt.getTime() - serverNow.getTime() > MAX_EVENT_FUTURE_SKEW_MS) {
    eventAt = serverNow;
    clockSkewAdjusted = true;
  }

  if (isMock) {
    await flagSession(sessionId, userId, 'mock_gps', 'high', 'Device reported mock location provider');
    await updateSessionScore(sessionId, -50);
  }

  if (clockSkewAdjusted) {
    await flagSession(sessionId, userId, 'clock_skew', 'low', 'Client event timestamp was too far in the future and was clamped to server time');
  }

  const lastRows = await prisma.$queryRawUnsafe<Array<{ location: string; event_at: Date; timestamp: Date }>>(
    `SELECT location, event_at, "timestamp" FROM gps_events WHERE session_id = $1::uuid ORDER BY event_at DESC LIMIT 1`,
    sessionId
  );
  const lastEvent = lastRows[0];

  if (lastEvent) {
    const lastLoc = JSON.parse(lastEvent.location);
    const lastLng = lastLoc.coordinates[0];
    const lastLat = lastLoc.coordinates[1];
    const lastEventAt = new Date(lastEvent.event_at || lastEvent.timestamp);
    const distanceMeters = calculateDistance(lastLat, lastLng, latitude, longitude);
    const timeSec = (eventAt.getTime() - lastEventAt.getTime()) / 1000;

    if (timeSec > 0) {
      const calculatedSpeed = distanceMeters / timeSec;
      if (calculatedSpeed > MAX_HUMAN_SPEED_MS && distanceMeters > TELEPORT_THRESHOLD_METERS) {
        await flagSession(sessionId, userId, 'teleport', 'high', `Jumped ${Math.round(distanceMeters)}m at ${Math.round(calculatedSpeed * 3.6)}km/h`);
        await updateSessionScore(sessionId, -30);
      }
    }
  }

  let acceptedAt = serverNow.toISOString();
  let idempotentReplay = false;

  if (normalizedClientRequestId) {
    const dedupeRows = await prisma.$queryRawUnsafe<Array<{ timestamp: Date; inserted: boolean }>>(
      `WITH ins AS (
          INSERT INTO gps_events (session_id, event_at, location, speed, accuracy, is_mock, client_request_id)
          VALUES ($1::uuid, $2::timestamptz, $3, $4, $5, $6, $7)
          ON CONFLICT (session_id, client_request_id) WHERE client_request_id IS NOT NULL
          DO NOTHING
          RETURNING "timestamp", TRUE AS inserted
      )
      SELECT "timestamp", inserted FROM ins
      UNION ALL
      SELECT "timestamp", FALSE AS inserted FROM gps_events
      WHERE session_id = $1::uuid AND client_request_id = $7 LIMIT 1`,
      sessionId, eventAt.toISOString(),
      JSON.stringify({ type: 'Point', coordinates: [longitude, latitude] }),
      speed || null, accuracy || null, isMock || false, normalizedClientRequestId
    );
    const row = dedupeRows[0];
    if (row?.timestamp) acceptedAt = new Date(row.timestamp).toISOString();
    idempotentReplay = row ? !row.inserted : false;
  } else {
    const inserted = await prisma.$queryRawUnsafe<Array<{ timestamp: Date }>>(
      `INSERT INTO gps_events (session_id, event_at, location, speed, accuracy, is_mock, client_request_id)
       VALUES ($1::uuid, $2::timestamptz, $3, $4, $5, $6, NULL) RETURNING "timestamp"`,
      sessionId, eventAt.toISOString(),
      JSON.stringify({ type: 'Point', coordinates: [longitude, latitude] }),
      speed || null, accuracy || null, isMock || false
    );
    if (inserted[0]?.timestamp) acceptedAt = new Date(inserted[0].timestamp).toISOString();
  }

  await checkRouteProgress(sessionId, latitude, longitude);
  return { acceptedAt, idempotentReplay };
}

async function flagSession(sessionId: string, userId: string, type: string, severity: string, description: string) {
  await prisma.gPSFlag.create({ data: { sessionId, userId, flagType: type, severity, description } });
}

async function updateSessionScore(sessionId: string, delta: number) {
  await prisma.prayerSession.update({
    where: { id: sessionId },
    data: { trustScore: { decrement: Math.abs(delta) } },
  });
}

async function checkRouteProgress(sessionId: string, lat: number, lng: number) {
  const nextCheckpoint = await prisma.routeCheckpoint.findFirst({
    where: { sessionId, isReached: false },
    orderBy: { order: 'asc' },
  });
  if (nextCheckpoint) {
    const cpLoc = JSON.parse(nextCheckpoint.location);
    const dist = calculateDistance(lat, lng, cpLoc.coordinates[1], cpLoc.coordinates[0]);
    if (dist < 50) {
      await prisma.routeCheckpoint.update({
        where: { id: nextCheckpoint.id },
        data: { isReached: true, reachedAt: new Date() },
      });
    }
  }
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

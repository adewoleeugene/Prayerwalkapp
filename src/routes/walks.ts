import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { executeRawQuery, createPoint, isWithinRange, parsePoint, calculateDistance } from '../lib/db';
import { checkAndAwardBadges } from '../lib/badges';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

function parseGeoPoint(pointLike: unknown): { latitude: number; longitude: number } | null {
  if (!pointLike) return null;

  try {
    const parsed = typeof pointLike === 'string' ? JSON.parse(pointLike) : pointLike;
    const coords = (parsed as any)?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const latitude = Number(coords[1]);
      const longitude = Number(coords[0]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude };
      }
    }

    const latitude = Number((parsed as any)?.latitude ?? (parsed as any)?.lat);
    const longitude = Number((parsed as any)?.longitude ?? (parsed as any)?.lng);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  } catch {
    return null;
  }

  return null;
}

function parsePointLabel(pointLike: unknown): string | null {
  if (!pointLike) return null;

  try {
    const parsed = typeof pointLike === 'string' ? JSON.parse(pointLike) : pointLike;
    const raw =
      (parsed as any)?.label ||
      (parsed as any)?.startAddress ||
      (parsed as any)?.address ||
      (parsed as any)?.properties?.label ||
      (parsed as any)?.properties?.startAddress ||
      (parsed as any)?.properties?.address;
    const label = typeof raw === 'string' ? raw.trim() : '';
    return label || null;
  } catch {
    return null;
  }
}

function parseParticipants(participantsLike: unknown): string[] {
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
      const raw = participantsLike.trim();
      return raw ? [raw] : [];
    } catch {
      const raw = participantsLike.trim();
      return raw ? [raw] : [];
    }
  }

  return [];
}

function calculateDistanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
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

function cleanRoutePoints(points: Array<{ latitude: number; longitude: number }>) {
  if (points.length < 2) return points;

  const cleaned: Array<{ latitude: number; longitude: number }> = [points[0]];
  const MAX_POINT_JUMP_METERS = 350;

  for (let i = 1; i < points.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    const next = points[i];
    const jump = calculateDistanceMeters(prev, next);
    if (jump <= MAX_POINT_JUMP_METERS) {
      cleaned.push(next);
    }
  }

  return cleaned;
}

function toWalkLabel(startLocationName: string | null, endLocationName: string | null, fallback: string): string {
  if (startLocationName && endLocationName) {
    if (startLocationName === endLocationName) return startLocationName;
    return `${startLocationName} -> ${endLocationName}`;
  }
  if (endLocationName) return endLocationName;
  if (startLocationName) return startLocationName;
  return fallback;
}

// Helper to generate checkpoints between start and target
function generateCheckpoints(startLat: number, startLng: number, targetLat: number, targetLng: number) {
  const distance = calculateDistance(startLat, startLng, targetLat, targetLng);
  const numPoints = Math.floor(distance / 100); // Checkpoint every 100m

  const checkpoints = [];
  if (numPoints <= 1) return []; // Too close for checkpoints

  for (let i = 1; i < numPoints; i++) {
    const ratio = i / numPoints;
    const lat = startLat + (targetLat - startLat) * ratio;
    const lng = startLng + (targetLng - startLng) * ratio;
    checkpoints.push({
      location: JSON.stringify({ type: 'Point', coordinates: [lng, lat] }),
      order: i
    });
  }
  return checkpoints;
}

// GET /walks/history - show completed walk paths on map
router.get('/history', authenticate, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const hasSearch = q.length >= 2;
    const locationQuery = typeof req.query.locationQuery === 'string' ? req.query.locationQuery.trim() : '';
    const hasLocationQuery = locationQuery.length >= 2;
    const fromParam = typeof req.query.from === 'string' ? req.query.from.trim() : '';
    const toParam = typeof req.query.to === 'string' ? req.query.to.trim() : '';
    const allTimeSearch = String(req.query.allTimeSearch || 'false').toLowerCase() === 'true';
    const limitRaw = Number(req.query.limit || 50);
    const hasAdvancedFilter = hasSearch || hasLocationQuery || !!fromParam || !!toParam;
    const role = req.user?.role || 'user';
    if (hasAdvancedFilter && role !== 'admin' && role !== 'superadmin') {
      res.status(403).json({ error: 'Advanced search is restricted to admin and super admin users.' });
      return;
    }
    const limitCap = hasAdvancedFilter ? 1000 : 300;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), limitCap) : 50;
    const daysRaw = Number(req.query.days || 14);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 90) : 14;
    const walkType = typeof req.query.walkType === 'string' ? req.query.walkType.trim().toLowerCase() : 'all';
    const includeActive = String(req.query.includeActive || 'true').toLowerCase() !== 'false';
    const branch = typeof req.query.branch === 'string' && req.query.branch.trim() ? req.query.branch.trim() : null;
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const statusFilter = includeActive ? ['completed', 'active', 'abandoned'] : ['completed', 'abandoned'];
    const shouldApplyDateWindow = !((hasSearch || hasLocationQuery) && allTimeSearch);

    const timelineFilter: { gte?: Date; lte?: Date } = {};
    if (fromParam) {
      const parsedFrom = new Date(fromParam);
      if (Number.isNaN(parsedFrom.getTime())) {
        res.status(400).json({ error: 'Invalid from date. Use YYYY-MM-DD format.' });
        return;
      }
      timelineFilter.gte = parsedFrom;
    }
    if (toParam) {
      const parsedTo = new Date(toParam);
      if (Number.isNaN(parsedTo.getTime())) {
        res.status(400).json({ error: 'Invalid to date. Use YYYY-MM-DD format.' });
        return;
      }

      if (/^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
        parsedTo.setUTCHours(23, 59, 59, 999);
      }
      timelineFilter.lte = parsedTo;
    }
    if (timelineFilter.gte && timelineFilter.lte && timelineFilter.gte > timelineFilter.lte) {
      res.status(400).json({ error: 'Invalid timeline: "from" date is after "to" date.' });
      return;
    }

    const andFilters: any[] = [];
    if (hasSearch) {
      andFilters.push({
        OR: [
          { branch: { contains: q, mode: 'insensitive' } },
          { prayerSummary: { contains: q, mode: 'insensitive' } },
          { participants: { contains: q, mode: 'insensitive' } },
          { user: { is: { name: { contains: q, mode: 'insensitive' } } } },
          { user: { is: { email: { contains: q, mode: 'insensitive' } } } },
          { location: { is: { name: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }
    if (hasLocationQuery) {
      andFilters.push({
        OR: [
          { branch: { contains: locationQuery, mode: 'insensitive' } },
          { startLocation: { contains: locationQuery, mode: 'insensitive' } },
          { currentLocation: { contains: locationQuery, mode: 'insensitive' } },
          { location: { is: { name: { contains: locationQuery, mode: 'insensitive' } } } },
        ],
      });
    }

    const where: any = {
      status: { in: statusFilter as any },
      ...(
        timelineFilter.gte || timelineFilter.lte
          ? { updatedAt: timelineFilter }
          : shouldApplyDateWindow
            ? { updatedAt: { gte: fromDate } }
            : {}
      ),
      ...(branch ? { branch } : {}),
      ...(andFilters.length > 0 ? { AND: andFilters } : {}),
    };

    const sessions = await prisma.prayerSession.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        location: {
          select: { id: true, name: true, prayerText: true, category: true }
        },
        gpsEvents: {
          orderBy: { timestamp: 'asc' },
          select: { location: true, timestamp: true }
        }
      }
    });

    const userIds = Array.from(new Set(sessions.map((session) => session.userId).filter(Boolean)));
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true }
        })
      : [];
    const userById = new Map(users.map((user) => [user.id, user] as const));
    const walks = sessions
      .map((session) => {
        const user = userById.get(session.userId);
        const derivedWalkType = session.locationId ? 'path' : 'area';
        if (walkType !== 'all' && walkType !== derivedWalkType) {
          return null;
        }

        const gpsPoints = cleanRoutePoints(
          session.gpsEvents
          .map((event) => parseGeoPoint(event.location))
          .filter((point): point is { latitude: number; longitude: number } => !!point)
        );

        const startPoint = parseGeoPoint(session.startLocation);
        const currentPoint = parseGeoPoint(session.currentLocation);
        const endPoint = session.status === 'completed' ? currentPoint : null;
        let points = gpsPoints;
        let geometryType: 'path' | 'spot' = 'path';
        let routeQuality: 'high' | 'medium' | 'low' = 'high';

        if (points.length < 2) {
          const fallback = [startPoint, currentPoint].filter(
            (point): point is { latitude: number; longitude: number } => !!point
          );

          if (fallback.length >= 2) {
            const uniqueFallback = cleanRoutePoints(fallback);
            if (uniqueFallback.length >= 2) {
              points = uniqueFallback;
              routeQuality = 'low';
            } else {
              points = [uniqueFallback[0]];
              geometryType = 'spot';
              routeQuality = 'low';
            }
          } else if (fallback.length === 1) {
            points = [fallback[0]];
            geometryType = 'spot';
            routeQuality = 'low';
          } else {
            return null;
          }
        }

        if (points.length === 1) {
          geometryType = 'spot';
        }

        let distanceMeters = 0;
        if (points.length >= 2) {
          for (let i = 1; i < points.length; i++) {
            distanceMeters += calculateDistanceMeters(points[i - 1], points[i]);
          }
        } else {
          distanceMeters = Number(session.distanceTraveled || 0);
        }

        const startedAtMs = new Date(session.startTime).getTime();
        const endedAtMs = session.endTime ? new Date(session.endTime).getTime() : Date.now();
        const durationSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
        const participantNames = parseParticipants((session as any).participants);
        const walkerDisplayName =
          participantNames.length > 0
            ? participantNames.join(', ')
            : user?.name || user?.email || 'Unknown';
        const startLabelFromSession = parsePointLabel(session.startLocation);
        const startLocationName = startLabelFromSession || null;
        const endLocationName =
          session.location?.name ||
          session.location?.category ||
          null;
        const prayerFocus = toWalkLabel(
          startLocationName,
          endLocationName,
          (walkerDisplayName ? `Prayer walk with ${walkerDisplayName}` : null) ||
            session.branch ||
            'Open Prayer Walk'
        );
        const prayerSummary =
          typeof (session as any).prayerSummary === 'string' && (session as any).prayerSummary.trim()
            ? (session as any).prayerSummary.trim()
            : null;
        const prayerJournal =
          typeof (session as any).prayerJournal === 'string' && (session as any).prayerJournal.trim()
            ? (session as any).prayerJournal.trim()
            : null;

        return {
          sessionId: session.id,
          userId: session.userId,
          participantNames,
          walkerDisplayName,
          who: user ? { id: user.id, name: user.name, email: user.email } : null,
          walkType: derivedWalkType,
          geometryType,
          routeQuality,
          branch: session.branch,
          status: session.status,
          startedAt: session.startTime,
          endedAt: session.endTime,
          startLocation: startPoint,
          endLocation: endPoint,
          durationSeconds,
          distanceMeters,
          startLocationName,
          endLocationName,
          prayerSummary,
          prayerJournal,
          prayerFocus,
          points
        };
      })
      .filter((walk): walk is NonNullable<typeof walk> => !!walk);

    const pathWalks = walks.filter((walk) => walk.geometryType === 'path');
    const cellCounts = new Map<string, number>();

    const toCellKey = (point: { latitude: number; longitude: number }) =>
      `${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`;

    for (const walk of pathWalks) {
      const keys = new Set(walk.points.map(toCellKey));
      for (const key of keys) {
        cellCounts.set(key, (cellCounts.get(key) || 0) + 1);
      }
    }

    let maxCellCount = 1;
    for (const count of cellCounts.values()) {
      if (count > maxCellCount) maxCellCount = count;
    }

    const walksWithOpacity = walks.map((walk) => {
      if (walk.geometryType !== 'path') {
        return { ...walk, opacity: 0.5 };
      }

      const keys = walk.points.map(toCellKey);
      const avgDensity =
        keys.reduce((sum, key) => sum + (cellCounts.get(key) || 1), 0) / Math.max(keys.length, 1);
      const normalized = Math.min(1, avgDensity / maxCellCount);
      const opacity = 0.25 + normalized * 0.7;
      return { ...walk, opacity: Number(opacity.toFixed(2)) };
    });

    res.json({
      success: true,
      count: walksWithOpacity.length,
      routes: walksWithOpacity
    });
  } catch (error) {
    console.error('Walk history error:', error);
    res.status(500).json({ error: 'Failed to fetch walk history' });
  }
});

// POST /walks/start
router.post('/start', authenticate, async (req: Request, res: Response) => {
  try {
    const { locationId, latitude, longitude, deviceFingerprint, branch, participants, startAddress } = req.body;
    const userId = req.user!.userId;

    if (!latitude || !longitude) {
      res.status(400).json({ error: 'Start location (lat, lng) required' });
      return;
    }

    const activeSession = await prisma.prayerSession.findFirst({
      where: { userId, status: 'active' }
    });

    if (activeSession) {
      res.status(200).json({
        success: true,
        message: 'Resuming existing active session',
        session: activeSession,
        location: null
      });
      return;
    }

    let targetLocation = null;
    if (locationId) {
      targetLocation = await prisma.prayerLocation.findUnique({
        where: { id: locationId }
      });
      if (!targetLocation) return res.status(404).json({ error: 'Location not found' });
    }

    const point = createPoint(latitude, longitude);
    const parsedPoint = JSON.parse(point);
    const normalizedStartAddress =
      typeof startAddress === 'string' && startAddress.trim()
        ? startAddress.trim()
        : null;
    const startPointPayload = normalizedStartAddress
      ? { ...parsedPoint, label: normalizedStartAddress }
      : parsedPoint;

    // Create session
    const session = await prisma.prayerSession.create({
      data: {
        userId,
        locationId: locationId || null,
        startLocation: JSON.stringify(startPointPayload),
        currentLocation: JSON.stringify(parsedPoint),
        status: 'active',
        deviceFingerprint,
        branch,
        participants: Array.isArray(participants) ? JSON.stringify(participants) : participants,
        trustScore: 100
      }
    });

    // Generate Checkpoints if target exists
    if (targetLocation && targetLocation.location) {
      const targetPoint = JSON.parse(targetLocation.location as string);
      const checkpoints = generateCheckpoints(
        latitude, longitude,
        targetPoint.coordinates[1], targetPoint.coordinates[0]
      );

      if (checkpoints.length > 0) {
        await prisma.routeCheckpoint.createMany({
          data: checkpoints.map(cp => ({ ...cp, sessionId: session.id }))
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Walk started with Route Integrity enabled',
      session,
      location: targetLocation
    });
  } catch (error) {
    console.error('Start walk error:', error);
    res.status(500).json({ error: 'Failed to start walk' });
  }
});

// POST /walks/arrive
router.post('/arrive', authenticate, async (req: Request, res: Response) => {
  try {
    const { sessionId, locationId, latitude, longitude } = req.body;
    const userId = req.user!.userId;

    const session = await prisma.prayerSession.findUnique({
      where: { id: sessionId },
      include: { checkpoints: true }
    });

    if (!session || session.userId !== userId || session.status !== 'active') {
      return res.status(400).json({ error: 'Invalid or inactive session' });
    }

    let rangeCheck = { withinRange: true, distance: 0 };
    let prayerLocation = null;

    if (locationId) {
      rangeCheck = await isWithinRange(latitude, longitude, locationId);
      prayerLocation = await prisma.prayerLocation.findUnique({
        where: { id: locationId },
        include: { prayers: true }
      });
    }

    // Route Integrity Check
    const unreached = session.checkpoints.filter(cp => !cp.isReached);
    const integrityScore = session.checkpoints.length > 0
      ? Math.round(((session.checkpoints.length - unreached.length) / session.checkpoints.length) * 100)
      : 100;

    if (locationId && integrityScore < 70 && rangeCheck.withinRange) {
      // Flag for skipping route but arriving anyway (teleport suspect)
      await prisma.gPSFlag.create({
        data: {
          sessionId,
          userId,
          flagType: 'route_skipped',
          severity: 'medium',
          description: `Reached target but only ${integrityScore}% of checkpoints reached.`
        }
      });
    }

    // Update current location
    const point = createPoint(latitude, longitude);

    await prisma.prayerSession.update({
      where: { id: sessionId },
      data: {
        currentLocation: JSON.stringify(JSON.parse(point)),
        locationId: locationId || undefined
      }
    });

    res.json({
      success: true,
      withinRange: rangeCheck.withinRange,
      integrityScore,
      location: prayerLocation,
      distance: rangeCheck.distance,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /walks/complete
router.post('/complete', authenticate, async (req: Request, res: Response) => {
  try {
    const { sessionId, locationId, latitude, longitude, prayerSummary, prayerJournal } = req.body;
    const userId = req.user!.userId;

    const session = await prisma.prayerSession.findUnique({
      where: { id: sessionId },
      include: { checkpoints: true, flags: true }
    });

    if (!session || session.status !== 'active') {
      return res.status(400).json({ error: 'Inactive session' });
    }

    // Final Trust Score Calculation
    let finalScore = session.trustScore;
    const unreached = session.checkpoints.filter(cp => !cp.isReached);
    if (session.checkpoints.length > 0) {
      const checkpointPenalty = (unreached.length / session.checkpoints.length) * 50;
      finalScore -= Math.round(checkpointPenalty);
    }

    if (session.flags.length > 0) {
      finalScore -= (session.flags.length * 20);
    }

    finalScore = Math.max(0, finalScore);

    if (finalScore < 50) {
      return res.status(403).json({
        error: 'Session integrity too low for reward.',
        trustScore: finalScore,
        reason: 'Suspicious GPS activity or route skipping detected.'
      });
    }

    let pointsEarned = 50; // Default for Open Walk
    let locationName = 'Open Prayer Walk';
    const completionLocationId = locationId || session.locationId || null;

    if (completionLocationId) {
      const location = await prisma.prayerLocation.findUnique({ where: { id: completionLocationId } });
      if (!location) return res.status(404).json({ error: 'Location invalid' });

      pointsEarned = location.points;
      locationName = location.name;
    }

    const completionPoint = JSON.parse(createPoint(latitude, longitude));

    if (completionLocationId) {
      // Record Completion only when we have a concrete location
      await prisma.completion.upsert({
        where: {
          userId_locationId: {
            userId,
            locationId: completionLocationId
          }
        },
        update: {
          sessionId,
          pointsEarned,
          trustScore: finalScore,
          completionLocation: JSON.stringify(completionPoint),
          completedAt: new Date()
        },
        create: {
          userId,
          locationId: completionLocationId,
          sessionId,
          pointsEarned,
          trustScore: finalScore,
          completionLocation: JSON.stringify(completionPoint)
        }
      });
    }

    const completionUpdateData: any = {
      status: 'completed',
      endTime: new Date(),
      trustScore: finalScore,
      prayerSummary:
        typeof prayerSummary === 'string' && prayerSummary.trim()
          ? prayerSummary.trim().slice(0, 600)
          : null,
      prayerJournal:
        typeof prayerJournal === 'string' && prayerJournal.trim()
          ? prayerJournal.trim().slice(0, 2000)
          : null,
      // Persist exact end destination coordinates on the session itself.
      currentLocation: JSON.stringify(completionPoint)
    };

    await prisma.prayerSession.update({
      where: { id: sessionId },
      data: completionUpdateData
    });

    const badges = await checkAndAwardBadges(userId);

    res.json({
      success: true,
      trustScore: finalScore,
      pointsEarned: pointsEarned,
      badgesEarned: badges
    });

  } catch (e) {
    res.status(500).json({ error: 'Internal Error' });
  }
});

export default router;

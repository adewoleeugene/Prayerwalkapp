import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { executeRawQuery } from '../lib/db';
import { deviceAuth } from '../middleware/deviceAuthMiddleware';
import { flexAuth } from '../middleware/flexAuthMiddleware';
import { validateGPSUpdate } from '../lib/gps';
import { logger } from '../lib/logger';
import { DomainError } from '../errors/domainError';
import { executeIdempotentRequest } from '../lib/idempotency';
import {
  calculateDistanceMeters,
  cleanRoutePoints,
  normalizeSearchText,
  parseCoordinateSearchTerm,
  parseGeoPoint,
  parseParticipants,
  parsePointLabel,
  toWalkLabel,
} from '../services/walks/routeUtils';
import { arriveAtLocation, completeWalk, startWalk } from '../services/walks/walkSessionService';

const router = Router();

// GET /walks/history - show completed walk paths on map
router.get('/history', flexAuth, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const hasSearch = q.length >= 2;
    const locationQuery = typeof req.query.locationQuery === 'string' ? req.query.locationQuery.trim() : '';
    const hasLocationQuery = locationQuery.length >= 2;
    const fromParam = typeof req.query.from === 'string' ? req.query.from.trim() : '';
    const toParam = typeof req.query.to === 'string' ? req.query.to.trim() : '';
    const allTimeSearch = String(req.query.allTimeSearch || 'false').toLowerCase() === 'true';
    const allTime = String(req.query.allTime || 'false').toLowerCase() === 'true';
    const limitRaw = Number(req.query.limit || 50);
    const hasAdvancedFilter = hasSearch || hasLocationQuery || !!fromParam || !!toParam;
    const role = req.user?.role || 'user';
    if (hasAdvancedFilter && role !== 'admin' && role !== 'superadmin') {
      res.status(403).json({ error: 'Advanced search is restricted to admin and super admin users.' });
      return;
    }
    const isPrivileged = role === 'admin' || role === 'superadmin';
    const limitCap = isPrivileged ? 5000 : 300;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), limitCap) : 50;
    const daysRaw = Number(req.query.days || 14);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 90) : 14;
    const walkType = typeof req.query.walkType === 'string' ? req.query.walkType.trim().toLowerCase() : 'all';
    const includeActive = String(req.query.includeActive || 'true').toLowerCase() !== 'false';

    // Branch admins are LOCKED to their assigned branch — they cannot see other branches.
    // Superadmins may optionally filter by branch via query param.
    const isBranchAdmin = role === 'admin';
    const assignedBranch = req.user?.branch?.trim() || null;
    const branch = isBranchAdmin
      ? assignedBranch  // force their branch, ignore any ?branch= param
      : (typeof req.query.branch === 'string' && req.query.branch.trim() ? req.query.branch.trim() : null);
    const branchAliases = new Set<string>();
    if (branch) {
      branchAliases.add(branch);
      const mapped = await executeRawQuery<Array<{ name: string; slug: string }>>(
        `SELECT name, slug
         FROM branches
         WHERE LOWER(slug) = LOWER($1) OR LOWER(name) = LOWER($1)
         LIMIT 1`,
        [branch]
      );
      if (mapped[0]?.name) branchAliases.add(String(mapped[0].name));
      if (mapped[0]?.slug) branchAliases.add(String(mapped[0].slug));
    }
    const branchTerms = Array.from(branchAliases);
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const statusFilter = includeActive ? ['completed', 'active', 'abandoned'] : ['completed', 'abandoned'];
    const shouldApplyDateWindow = !(allTime || ((hasSearch || hasLocationQuery) && allTimeSearch));

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
          { location: { is: { address: { contains: q, mode: 'insensitive' } } } },
          { location: { is: { category: { contains: q, mode: 'insensitive' } } } },
          { startLocation: { contains: q, mode: 'insensitive' } },
          { currentLocation: { contains: q, mode: 'insensitive' } },
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
          { location: { is: { address: { contains: locationQuery, mode: 'insensitive' } } } },
          { location: { is: { category: { contains: locationQuery, mode: 'insensitive' } } } },
        ],
      });
    }

    // Regular (anonymous) users only see walks from their own device.
    // Admins/superadmins see all walks (scoped by branch if applicable).
    const deviceFingerprint = typeof req.headers['x-device-fingerprint'] === 'string'
      ? req.headers['x-device-fingerprint'].trim()
      : '';
    const isAnonymousUser = role === 'user' && deviceFingerprint.length >= 4;

    const baseWhere: any = {
      status: { in: statusFilter as any },
      ...(isAnonymousUser ? { deviceFingerprint } : {}),
      ...(
        timelineFilter.gte || timelineFilter.lte
          ? { updatedAt: timelineFilter }
          : shouldApplyDateWindow
            ? { updatedAt: { gte: fromDate } }
            : {}
      ),
      ...(branchTerms.length > 0
        ? {
          OR: branchTerms.map((term) => ({
            branch: { contains: term, mode: 'insensitive' as const }
          }))
        }
        : {}),
    };
    const where: any = {
      ...baseWhere,
      ...(andFilters.length > 0 ? { AND: andFilters } : {}),
    };

    const shouldApplyRobustSearch = hasSearch || hasLocationQuery;
    const dbWhere = shouldApplyRobustSearch ? baseWhere : where;
    const dbTake = shouldApplyRobustSearch ? limitCap : limit;

    const sessions = await prisma.prayerSession.findMany({
      where: dbWhere,
      orderBy: { updatedAt: 'desc' },
      take: dbTake,
      include: {
        location: {
          select: { id: true, name: true, prayerText: true, category: true, points: true }
        },
        flags: true,
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

        const rawGpsPoints = session.gpsEvents
          .map((event) => parseGeoPoint(event.location))
          .filter((point): point is { latitude: number; longitude: number } => !!point);
        const gpsPoints = cleanRoutePoints(rawGpsPoints);

        const startPoint = parseGeoPoint(session.startLocation);
        const currentPoint = parseGeoPoint(session.currentLocation);
        const endPoint = session.status === 'completed' ? currentPoint : null;
        let points = gpsPoints;
        let geometryType: 'path' | 'spot' = 'path';
        let routeQuality: 'high' | 'medium' | 'low' = 'high';

        // If cleaning removed too many points, try using all raw GPS points
        if (points.length < 3 && rawGpsPoints.length >= 3) {
          points = rawGpsPoints;
          routeQuality = 'medium';
        }

        // If we still don't have a real path (3+ points), fall back to spot markers only
        if (points.length < 3) {
          const fallback = [startPoint, currentPoint].filter(
            (point): point is { latitude: number; longitude: number } => !!point
          );

          if (fallback.length >= 1) {
            points = fallback;
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
        const sessionDistTraveled = Number(session.distanceTraveled || 0);

        if (points.length >= 2) {
          for (let i = 1; i < points.length; i++) {
            distanceMeters += calculateDistanceMeters(points[i - 1], points[i]);
          }
          // If calculated distance is weirdly small compared to reported distance, fallback
          if (distanceMeters < 5 && sessionDistTraveled > 5) {
            distanceMeters = sessionDistTraveled;
          }
        } else {
          distanceMeters = sessionDistTraveled;
        }

        // Ensure we never return NaN
        if (isNaN(distanceMeters)) distanceMeters = sessionDistTraveled || 0;

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
          trustScore: session.trustScore,
          awardedPoints: (session.location as any)?.points || 0,
          points
        };
      })
      .filter((walk): walk is NonNullable<typeof walk> => !!walk);

    const matchesWalkSearch = (walk: (typeof walks)[number], term: string) => {
      const qTerm = normalizeSearchText(term);
      if (!qTerm) return true;
      const haystack = normalizeSearchText([
        walk.branch,
        walk.prayerSummary,
        walk.prayerJournal,
        walk.prayerFocus,
        walk.startLocationName,
        walk.endLocationName,
        walk.walkerDisplayName,
        walk.who?.name,
        walk.who?.email,
        ...(Array.isArray(walk.participantNames) ? walk.participantNames : [])
      ].filter(Boolean).join(' '));
      return haystack.includes(qTerm);
    };

    const filteredWalks = shouldApplyRobustSearch
      ? walks.filter((walk) => {
        if (hasSearch && !matchesWalkSearch(walk, q)) return false;
        if (hasLocationQuery && !matchesWalkSearch(walk, locationQuery)) return false;
        return true;
      })
      : walks;
    const coordinateSearch =
      parseCoordinateSearchTerm(q) || parseCoordinateSearchTerm(locationQuery);
    const coordinateRadiusMeters = Number.isFinite(Number(req.query.coordRadiusMeters))
      ? Math.min(Math.max(Number(req.query.coordRadiusMeters), 25), 5000)
      : 250;

    const coordinateFilteredWalks = coordinateSearch
      ? filteredWalks.filter((walk) => {
        const candidates = [
          walk.startLocation,
          walk.endLocation,
          ...(Array.isArray(walk.points) ? walk.points : [])
        ].filter((point): point is { latitude: number; longitude: number } => (
          !!point &&
          Number.isFinite(Number(point.latitude)) &&
          Number.isFinite(Number(point.longitude))
        ));

        return candidates.some((point) => (
          calculateDistanceMeters(
            { latitude: Number(point.latitude), longitude: Number(point.longitude) },
            coordinateSearch
          ) <= coordinateRadiusMeters
        ));
      })
      : filteredWalks;
    const limitedWalks = coordinateFilteredWalks.slice(0, limit);

    const pathWalks = limitedWalks.filter((walk) => walk.geometryType === 'path');
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

    const walksWithOpacity = limitedWalks.map((walk) => {
      if (walk.geometryType !== 'path') {
        return { ...walk, opacity: 0.5 };
      }

      const keys = walk.points.map(toCellKey);
      const avgDensity =
        keys.reduce((sum: number, key) => sum + (cellCounts.get(key) || 1), 0) / Math.max(keys.length, 1);
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
    logger.error('Walk history error:', error);
    res.status(500).json({ error: 'Failed to fetch walk history' });
  }
});

// POST /walks/start
router.post('/start', deviceAuth, async (req: Request, res: Response) => {
  try {
    const { locationId, latitude, longitude, deviceFingerprint, branch, participants, startAddress, clientRequestId, clientEventAt, localSessionId } = req.body;
    const result = await executeIdempotentRequest({
      idempotencyKey: typeof clientRequestId === 'string' ? clientRequestId : undefined,
      endpoint: 'walks/start',
      userId: req.user!.userId,
      payload: {
        locationId,
        latitude,
        longitude,
        deviceFingerprint,
        branch,
        participants,
        startAddress,
        clientEventAt,
        localSessionId,
      },
      execute: async () => {
        const started = await startWalk({
          userId: req.user!.userId,
          locationId,
          latitude,
          longitude,
          deviceFingerprint,
          branch,
          participants,
          startAddress,
        });

        if (started.resumed) {
          return {
            statusCode: 200,
            body: {
              success: true,
              message: 'Resuming existing active session',
              session: started.session,
              location: null,
            },
          };
        }

        return {
          statusCode: 201,
          body: {
            success: true,
            message: 'Walk started with Route Integrity enabled',
            session: started.session,
            location: started.location,
          },
        };
      },
    });

    res.status(result.statusCode).json({
      ...result.body,
      acceptedAt: result.acceptedAt,
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      res.status(error.statusCode).json({ error: error.message, details: error.details });
      return;
    }
    logger.error('Start walk error:', error);
    res.status(500).json({ error: 'Failed to start walk' });
  }
});

// POST /walks/track (replaces WebSocket for serverless)
router.post('/track', deviceAuth, async (req: Request, res: Response) => {
  try {
    const { sessionId, latitude, longitude, speed, accuracy, isMock, clientRequestId, clientEventAt } = req.body;
    const userId = req.user!.userId;

    if (!sessionId || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Missing required tracking data' });
    }

    try {
      const trackResult = await validateGPSUpdate(sessionId, userId, {
        latitude,
        longitude,
        speed,
        accuracy,
        isMock,
        clientEventAt,
        clientRequestId
      });
      res.json({
        success: true,
        status: 'validated',
        acceptedAt: trackResult.acceptedAt,
        idempotentReplay: trackResult.idempotentReplay,
      });
    } catch (err) {
      logger.error('Failed to validate GPS for session', err, { sessionId });
      // Still return 200 so the app doesn't crash on failed validation logs
      res.json({ success: false, error: 'Validation failed', acceptedAt: new Date().toISOString(), idempotentReplay: false });
    }
  } catch (error) {
    logger.error('Track error:', error);
    res.status(500).json({ error: 'Failed to record tracking point' });
  }
});

// POST /walks/arrive
router.post('/arrive', deviceAuth, async (req: Request, res: Response) => {
  try {
    const { sessionId, locationId, latitude, longitude, clientRequestId, clientEventAt } = req.body;
    const result = await executeIdempotentRequest({
      idempotencyKey: typeof clientRequestId === 'string' ? clientRequestId : undefined,
      endpoint: 'walks/arrive',
      userId: req.user!.userId,
      payload: {
        sessionId,
        locationId,
        latitude,
        longitude,
        clientEventAt,
      },
      execute: async () => {
        const arrived = await arriveAtLocation({
          sessionId,
          locationId,
          latitude,
          longitude,
          userId: req.user!.userId,
        });

        return {
          statusCode: 200,
          body: {
            success: true,
            withinRange: arrived.withinRange,
            integrityScore: arrived.integrityScore,
            location: arrived.location,
            distance: arrived.distance,
          },
        };
      }
    });

    res.status(result.statusCode).json({
      ...result.body,
      acceptedAt: result.acceptedAt,
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      res.status(error.statusCode).json({ error: error.message, details: error.details });
      return;
    }
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /walks/complete
router.post('/complete', deviceAuth, async (req: Request, res: Response) => {
  try {
    const { sessionId, locationId, latitude, longitude, prayerSummary, prayerJournal, clientRequestId, clientEventAt, localSessionId } = req.body;
    const result = await executeIdempotentRequest({
      idempotencyKey: typeof clientRequestId === 'string' ? clientRequestId : undefined,
      endpoint: 'walks/complete',
      userId: req.user!.userId,
      payload: {
        sessionId,
        locationId,
        latitude,
        longitude,
        prayerSummary,
        prayerJournal,
        clientEventAt,
        localSessionId,
      },
      execute: async () => {
        const completed = await completeWalk({
          sessionId,
          locationId,
          latitude,
          longitude,
          prayerSummary,
          prayerJournal,
          userId: req.user!.userId,
        });

        return {
          statusCode: 200,
          body: {
            success: true,
            trustScore: completed.trustScore,
            pointsEarned: completed.pointsEarned,
            badgesEarned: completed.badgesEarned
          },
        };
      },
    });

    res.status(result.statusCode).json({
      ...result.body,
      acceptedAt: result.acceptedAt,
      idempotentReplay: result.idempotentReplay,
    });

  } catch (e) {
    if (e instanceof DomainError) {
      const details = (e.details ?? {}) as Record<string, unknown>;
      res.status(e.statusCode).json({
        error: e.message,
        ...(details.trustScore !== undefined ? { trustScore: details.trustScore } : {}),
        ...(details.reason !== undefined ? { reason: details.reason } : {}),
      });
      return;
    }
    res.status(500).json({ error: 'Internal Error' });
  }
});

export default router;

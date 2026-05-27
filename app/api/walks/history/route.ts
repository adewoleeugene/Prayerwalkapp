import { type NextRequest } from 'next/server';
import { prisma, executeRawQuery } from '@/lib/db';
import { flexAuth, handleError } from '@/lib/apiHelpers';
import { logger } from '@/lib/logger';
import {
  calculateDistanceMeters,
  cleanRoutePoints,
  normalizeSearchText,
  parseCoordinateSearchTerm,
  parseGeoPoint,
  parseParticipants,
  parsePointLabel,
  toWalkLabel,
} from '@/services/walks/routeUtils';

export async function GET(request: NextRequest) {
  try {
    const user = await flexAuth(request);
    const { searchParams } = new URL(request.url);

    const q = (searchParams.get('q') || '').trim();
    const hasSearch = q.length >= 2;
    const locationQuery = (searchParams.get('locationQuery') || '').trim();
    const hasLocationQuery = locationQuery.length >= 2;
    const fromParam = (searchParams.get('from') || '').trim();
    const toParam = (searchParams.get('to') || '').trim();
    const allTimeSearch = searchParams.get('allTimeSearch') === 'true';
    const allTime = searchParams.get('allTime') === 'true';
    const showAreaWalks = searchParams.get('showAreaWalks') === 'true';
    const limitRaw = Number(searchParams.get('limit') || 50);
    const hasAdvancedFilter = hasSearch || hasLocationQuery || !!fromParam || !!toParam;

    const role = user.role;
    if (hasAdvancedFilter && role !== 'admin' && role !== 'superadmin') {
      return Response.json({ error: 'Advanced search is restricted to admin and super admin users.' }, { status: 403 });
    }

    const isPrivileged = role === 'admin' || role === 'superadmin';
    const limitCap = isPrivileged ? 5000 : 300;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), limitCap) : 50;
    const daysRaw = Number(searchParams.get('days') || 14);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 90) : 14;
    const walkType = (searchParams.get('walkType') || 'all').trim().toLowerCase();
    const includeActive = searchParams.get('includeActive') !== 'false';

    const isBranchAdmin = role === 'admin';
    const assignedBranch = user.branch?.trim() || null;
    const branchParam = searchParams.get('branch');
    const branch = isBranchAdmin
      ? assignedBranch
      : (branchParam && branchParam.trim() ? branchParam.trim() : null);

    const branchAliases = new Set<string>();
    if (branch) {
      branchAliases.add(branch);
      const mapped = await executeRawQuery<Array<{ name: string; slug: string }>>(
        `SELECT name, slug FROM branches WHERE LOWER(slug) = LOWER($1) OR LOWER(name) = LOWER($1) LIMIT 1`, [branch]
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
      if (Number.isNaN(parsedFrom.getTime())) return Response.json({ error: 'Invalid from date. Use YYYY-MM-DD format.' }, { status: 400 });
      timelineFilter.gte = parsedFrom;
    }
    if (toParam) {
      const parsedTo = new Date(toParam);
      if (Number.isNaN(parsedTo.getTime())) return Response.json({ error: 'Invalid to date. Use YYYY-MM-DD format.' }, { status: 400 });
      if (/^\d{4}-\d{2}-\d{2}$/.test(toParam)) parsedTo.setUTCHours(23, 59, 59, 999);
      timelineFilter.lte = parsedTo;
    }
    if (timelineFilter.gte && timelineFilter.lte && timelineFilter.gte > timelineFilter.lte) {
      return Response.json({ error: 'Invalid timeline: "from" date is after "to" date.' }, { status: 400 });
    }

    const andFilters: any[] = [];
    if (hasSearch) {
      andFilters.push({ OR: [
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
      ]});
    }
    if (hasLocationQuery) {
      andFilters.push({ OR: [
        { branch: { contains: locationQuery, mode: 'insensitive' } },
        { startLocation: { contains: locationQuery, mode: 'insensitive' } },
        { currentLocation: { contains: locationQuery, mode: 'insensitive' } },
        { location: { is: { name: { contains: locationQuery, mode: 'insensitive' } } } },
        { location: { is: { address: { contains: locationQuery, mode: 'insensitive' } } } },
        { location: { is: { category: { contains: locationQuery, mode: 'insensitive' } } } },
      ]});
    }

    const deviceFingerprint = (request.headers.get('x-device-fingerprint') || '').trim();
    // showAreaWalks=true: authenticated user wants collective map view — skip device-scoped filter
    const isAnonymousUser = role === 'user' && deviceFingerprint.length >= 4 && !showAreaWalks;

    const baseWhere: any = {
      status: { in: statusFilter as any },
      ...(isAnonymousUser ? { deviceFingerprint } : {}),
      ...(timelineFilter.gte || timelineFilter.lte
        ? { updatedAt: timelineFilter }
        : shouldApplyDateWindow ? { updatedAt: { gte: fromDate } } : {}),
      ...(branchTerms.length > 0 ? { OR: branchTerms.map(term => ({ branch: { contains: term, mode: 'insensitive' as const } })) } : {}),
    };
    const where: any = { ...baseWhere, ...(andFilters.length > 0 ? { AND: andFilters } : {}) };
    const shouldApplyRobustSearch = hasSearch || hasLocationQuery;
    const dbWhere = shouldApplyRobustSearch ? baseWhere : where;
    const dbTake = shouldApplyRobustSearch ? limitCap : limit;

    const sessions = await prisma.prayerSession.findMany({
      where: dbWhere, orderBy: { updatedAt: 'desc' }, take: dbTake,
      include: {
        location: { select: { id: true, name: true, prayerText: true, category: true, points: true } },
        flags: true,
        gpsEvents: { orderBy: { eventAt: 'asc' }, select: { location: true, timestamp: true } },
      },
    });

    const userIds = Array.from(new Set(sessions.map(s => s.userId).filter(Boolean)));
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
    const userById = new Map(users.map(u => [u.id, u] as const));

    const walks = sessions.map(session => {
      const sessionUser = userById.get(session.userId);
      const derivedWalkType = session.locationId ? 'path' : 'area';
      if (walkType !== 'all' && walkType !== derivedWalkType) return null;

      const rawGpsPoints = session.gpsEvents.map(e => parseGeoPoint(e.location)).filter((p): p is { latitude: number; longitude: number } => !!p);
      const gpsPoints = cleanRoutePoints(rawGpsPoints);
      const startPoint = parseGeoPoint(session.startLocation);
      const currentPoint = parseGeoPoint(session.currentLocation);
      const endPoint = session.status === 'completed' ? currentPoint : null;
      let points = gpsPoints;
      let geometryType: 'path' | 'spot' = 'path';
      let routeQuality: 'high' | 'medium' | 'low' = 'high';

      if (points.length < 3 && rawGpsPoints.length >= 3) { points = rawGpsPoints; routeQuality = 'medium'; }
      if (points.length < 3) {
        const fallback = [startPoint, currentPoint].filter((p): p is { latitude: number; longitude: number } => !!p);
        if (fallback.length >= 1) { points = fallback; geometryType = 'spot'; routeQuality = 'low'; }
        else return null;
      }
      if (points.length === 1) geometryType = 'spot';

      let distanceMeters = 0;
      const sessionDistTraveled = Number(session.distanceTraveled || 0);
      if (points.length >= 2) {
        for (let i = 1; i < points.length; i++) distanceMeters += calculateDistanceMeters(points[i - 1], points[i]);
        if (distanceMeters < 5 && sessionDistTraveled > 5) distanceMeters = sessionDistTraveled;
      } else {
        distanceMeters = sessionDistTraveled;
      }
      if (isNaN(distanceMeters)) distanceMeters = sessionDistTraveled || 0;

      const durationSeconds = Math.max(0, Math.floor((
        (session.endTime ? new Date(session.endTime).getTime() : Date.now()) - new Date(session.startTime).getTime()
      ) / 1000));
      const participantNames = parseParticipants((session as any).participants);
      const walkerDisplayName = participantNames.length > 0 ? participantNames.join(', ') : sessionUser?.name || sessionUser?.email || 'Unknown';
      const startLabelFromSession = parsePointLabel(session.startLocation);
      const startLocationName = startLabelFromSession || null;
      const endLocationName = session.location?.name || session.location?.category || null;
      const prayerFocus = toWalkLabel(startLocationName, endLocationName, (walkerDisplayName ? `Prayer walk with ${walkerDisplayName}` : null) || session.branch || 'Open Prayer Walk');
      const prayerSummary = typeof (session as any).prayerSummary === 'string' && (session as any).prayerSummary.trim() ? (session as any).prayerSummary.trim() : null;
      const prayerJournal = typeof (session as any).prayerJournal === 'string' && (session as any).prayerJournal.trim() ? (session as any).prayerJournal.trim() : null;

      return {
        sessionId: session.id, userId: session.userId, participantNames, walkerDisplayName,
        who: sessionUser ? { id: sessionUser.id, name: sessionUser.name, email: sessionUser.email } : null,
        walkType: derivedWalkType, geometryType, routeQuality, branch: session.branch,
        status: session.status, startedAt: session.startTime, endedAt: session.endTime,
        startLocation: startPoint, endLocation: endPoint, durationSeconds, distanceMeters,
        startLocationName, endLocationName, prayerSummary, prayerJournal, prayerFocus,
        trustScore: session.trustScore, awardedPoints: (session.location as any)?.points || 0, points,
      };
    }).filter((w): w is NonNullable<typeof w> => !!w);

    const matchesWalkSearch = (walk: (typeof walks)[number], term: string) => {
      const qTerm = normalizeSearchText(term);
      if (!qTerm) return true;
      const haystack = normalizeSearchText([walk.branch, walk.prayerSummary, walk.prayerJournal, walk.prayerFocus, walk.startLocationName, walk.endLocationName, walk.walkerDisplayName, walk.who?.name, walk.who?.email, ...(walk.participantNames || [])].filter(Boolean).join(' '));
      return haystack.includes(qTerm);
    };

    const filteredWalks = shouldApplyRobustSearch
      ? walks.filter(w => {
        if (hasSearch && !matchesWalkSearch(w, q)) return false;
        if (hasLocationQuery && !matchesWalkSearch(w, locationQuery)) return false;
        return true;
      })
      : walks;

    const coordinateSearch = parseCoordinateSearchTerm(q) || parseCoordinateSearchTerm(locationQuery);
    const coordRadiusMeters = Math.min(Math.max(Number(searchParams.get('coordRadiusMeters') || 250), 25), 5000);

    const coordinateFilteredWalks = coordinateSearch
      ? filteredWalks.filter(w => {
        const candidates = [w.startLocation, w.endLocation, ...(w.points || [])].filter((p): p is { latitude: number; longitude: number } => !!p && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)));
        return candidates.some(p => calculateDistanceMeters({ latitude: Number(p.latitude), longitude: Number(p.longitude) }, coordinateSearch) <= coordRadiusMeters);
      })
      : filteredWalks;

    const limitedWalks = coordinateFilteredWalks.slice(0, limit);
    const toCellKey = (p: { latitude: number; longitude: number }) => `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;
    const cellCounts = new Map<string, number>();
    for (const walk of limitedWalks.filter(w => w.geometryType === 'path')) {
      for (const key of new Set(walk.points.map(toCellKey))) cellCounts.set(key, (cellCounts.get(key) || 0) + 1);
    }
    let maxCellCount = 1;
    for (const count of cellCounts.values()) if (count > maxCellCount) maxCellCount = count;

    const walksWithOpacity = limitedWalks.map(walk => {
      if (walk.geometryType !== 'path') return { ...walk, opacity: 0.5 };
      const keys = walk.points.map(toCellKey);
      const avgDensity = keys.reduce((sum, key) => sum + (cellCounts.get(key) || 1), 0) / Math.max(keys.length, 1);
      const opacity = 0.25 + Math.min(1, avgDensity / maxCellCount) * 0.7;
      return { ...walk, opacity: Number(opacity.toFixed(2)) };
    });

    return Response.json({ success: true, count: walksWithOpacity.length, routes: walksWithOpacity });
  } catch (error) {
    logger.error('Walk history error:', error);
    return handleError(error);
  }
}

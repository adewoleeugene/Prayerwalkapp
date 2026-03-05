import { checkAndAwardBadges } from '../../lib/badges';
import { createPoint, isWithinRange } from '../../lib/db';
import { DomainError } from '../../errors/domainError';
import { generateCheckpoints } from './routeUtils';
import {
  createRouteCheckpoints,
  createRouteSkippedFlag,
  createSession,
  findActiveSessionForUser,
  findActiveSessionWithFlags,
  findLocationWithPrayers,
  findSessionWithCheckpoints,
  findTargetLocation,
  updateSessionCompletion,
  updateSessionCurrentLocation,
  upsertCompletion,
} from '../../repositories/walks/walkSessionRepository';

export async function startWalk(input: {
  userId: string;
  locationId?: string;
  latitude: number;
  longitude: number;
  deviceFingerprint?: string;
  branch?: string;
  participants?: unknown;
  startAddress?: string;
}) {
  if (!input.latitude || !input.longitude) {
    throw new DomainError('Start location (lat, lng) required', { statusCode: 400, code: 'start_location_required' });
  }

  const activeSession = await findActiveSessionForUser(input.userId);
  if (activeSession) {
    return {
      resumed: true,
      session: activeSession,
      location: null,
    };
  }

  let targetLocation = null;
  if (input.locationId) {
    targetLocation = await findTargetLocation(input.locationId);
    if (!targetLocation) {
      throw new DomainError('Location not found', { statusCode: 404, code: 'location_not_found' });
    }
  }

  const point = createPoint(input.latitude, input.longitude);
  const parsedPoint = JSON.parse(point);
  const normalizedStartAddress = typeof input.startAddress === 'string' && input.startAddress.trim() ? input.startAddress.trim() : null;
  const startPointPayload = normalizedStartAddress ? { ...parsedPoint, label: normalizedStartAddress } : parsedPoint;

  const session = await createSession({
    userId: input.userId,
    locationId: input.locationId || null,
    startLocation: JSON.stringify(startPointPayload),
    currentLocation: JSON.stringify(parsedPoint),
    deviceFingerprint: input.deviceFingerprint,
    branch: input.branch,
    participants: input.participants,
  });

  if (targetLocation?.location) {
    const targetPoint = JSON.parse(targetLocation.location as string);
    const checkpoints = generateCheckpoints(
      input.latitude,
      input.longitude,
      targetPoint.coordinates[1],
      targetPoint.coordinates[0]
    );
    await createRouteCheckpoints(session.id, checkpoints as Array<{ location: string; order: number }>);
  }

  return { resumed: false, session, location: targetLocation };
}

export async function arriveAtLocation(input: {
  sessionId: string;
  userId: string;
  locationId?: string;
  latitude: number;
  longitude: number;
}) {
  const session = await findSessionWithCheckpoints(input.sessionId);
  if (!session || session.userId !== input.userId || session.status !== 'active') {
    throw new DomainError('Invalid or inactive session', { statusCode: 400, code: 'invalid_session' });
  }

  let rangeCheck = { withinRange: true, distance: 0, requiredRadius: 0 };
  let prayerLocation: any = null;

  if (input.locationId) {
    rangeCheck = await isWithinRange(input.latitude, input.longitude, input.locationId);
    prayerLocation = await findLocationWithPrayers(input.locationId);
  }

  const unreached = session.checkpoints.filter((cp) => !cp.isReached);
  const integrityScore = session.checkpoints.length > 0
    ? Math.round(((session.checkpoints.length - unreached.length) / session.checkpoints.length) * 100)
    : 100;

  if (input.locationId && integrityScore < 70 && rangeCheck.withinRange) {
    await createRouteSkippedFlag({ sessionId: input.sessionId, userId: input.userId, integrityScore });
  }

  const point = createPoint(input.latitude, input.longitude);
  await updateSessionCurrentLocation(input.sessionId, JSON.stringify(JSON.parse(point)), input.locationId);

  return {
    withinRange: rangeCheck.withinRange,
    integrityScore,
    location: prayerLocation,
    distance: rangeCheck.distance,
  };
}

export async function completeWalk(input: {
  sessionId: string;
  userId: string;
  locationId?: string;
  latitude: number;
  longitude: number;
  prayerSummary?: string;
  prayerJournal?: string;
}) {
  const session = await findActiveSessionWithFlags(input.sessionId);
  if (!session || session.status !== 'active') {
    throw new DomainError('Inactive session', { statusCode: 400, code: 'inactive_session' });
  }

  let finalScore = session.trustScore;
  const unreached = session.checkpoints.filter((cp) => !cp.isReached);
  if (session.checkpoints.length > 0) {
    const checkpointPenalty = (unreached.length / session.checkpoints.length) * 50;
    finalScore -= Math.round(checkpointPenalty);
  }
  if (session.flags.length > 0) {
    finalScore -= session.flags.length * 20;
  }
  finalScore = Math.max(0, finalScore);

  if (finalScore < 50) {
    throw new DomainError('Session integrity too low for reward.', {
      statusCode: 403,
      code: 'session_integrity_low',
      details: {
        trustScore: finalScore,
        reason: 'Suspicious GPS activity or route skipping detected.',
      },
    });
  }

  let pointsEarned = 50;
  const completionLocationId = input.locationId || session.locationId || null;

  if (completionLocationId) {
    const location = await findTargetLocation(completionLocationId);
    if (!location) {
      throw new DomainError('Location invalid', { statusCode: 404, code: 'location_invalid' });
    }
    pointsEarned = location.points;
  }

  const completionPoint = JSON.parse(createPoint(input.latitude, input.longitude));

  if (completionLocationId) {
    await upsertCompletion({
      userId: input.userId,
      locationId: completionLocationId,
      sessionId: input.sessionId,
      pointsEarned,
      trustScore: finalScore,
      completionLocation: JSON.stringify(completionPoint),
    });
  }

  await updateSessionCompletion(input.sessionId, {
    trustScore: finalScore,
    prayerSummary: typeof input.prayerSummary === 'string' && input.prayerSummary.trim()
      ? input.prayerSummary.trim().slice(0, 600)
      : null,
    prayerJournal: typeof input.prayerJournal === 'string' && input.prayerJournal.trim()
      ? input.prayerJournal.trim().slice(0, 2000)
      : null,
    currentLocation: JSON.stringify(completionPoint),
  });

  const badges = await checkAndAwardBadges(input.userId);
  return {
    trustScore: finalScore,
    pointsEarned,
    badgesEarned: badges,
  };
}

import { prisma } from '../../lib/db';

export async function findActiveSessionForUser(userId: string) {
  return prisma.prayerSession.findFirst({ where: { userId, status: 'active' } });
}

export async function findTargetLocation(locationId: string) {
  return prisma.prayerLocation.findUnique({ where: { id: locationId } });
}

export async function createSession(data: {
  userId: string;
  locationId: string | null;
  startLocation: string;
  currentLocation: string;
  deviceFingerprint?: string;
  branch?: string;
  participants?: unknown;
}) {
  return prisma.prayerSession.create({
    data: {
      userId: data.userId,
      locationId: data.locationId,
      startLocation: data.startLocation,
      currentLocation: data.currentLocation,
      status: 'active',
      deviceFingerprint: data.deviceFingerprint,
      branch: data.branch,
      participants: Array.isArray(data.participants) ? JSON.stringify(data.participants) : (data.participants as any),
      trustScore: 100,
    },
  });
}

export async function createRouteCheckpoints(sessionId: string, checkpoints: Array<{ location: string; order: number }>) {
  if (checkpoints.length === 0) return;
  await prisma.routeCheckpoint.createMany({ data: checkpoints.map((cp) => ({ ...cp, sessionId })) });
}

export async function findSessionWithCheckpoints(sessionId: string) {
  return prisma.prayerSession.findUnique({ where: { id: sessionId }, include: { checkpoints: true } });
}

export async function findLocationWithPrayers(locationId: string) {
  return prisma.prayerLocation.findUnique({ where: { id: locationId }, include: { prayers: true } });
}

export async function createRouteSkippedFlag(input: { sessionId: string; userId: string; integrityScore: number }) {
  return prisma.gPSFlag.create({
    data: {
      sessionId: input.sessionId,
      userId: input.userId,
      flagType: 'route_skipped',
      severity: 'medium',
      description: `Reached target but only ${input.integrityScore}% of checkpoints reached.`,
    },
  });
}

export async function updateSessionCurrentLocation(sessionId: string, locationJson: string, locationId?: string) {
  return prisma.prayerSession.update({
    where: { id: sessionId },
    data: {
      currentLocation: locationJson,
      locationId: locationId || undefined,
    },
  });
}

export async function findActiveSessionWithFlags(sessionId: string) {
  return prisma.prayerSession.findUnique({ where: { id: sessionId }, include: { checkpoints: true, flags: true } });
}

export async function upsertCompletion(input: {
  userId: string;
  locationId: string;
  sessionId: string;
  pointsEarned: number;
  trustScore: number;
  completionLocation: string;
}) {
  return prisma.completion.upsert({
    where: { userId_locationId: { userId: input.userId, locationId: input.locationId } },
    update: {
      sessionId: input.sessionId,
      pointsEarned: input.pointsEarned,
      trustScore: input.trustScore,
      completionLocation: input.completionLocation,
      completedAt: new Date(),
    },
    create: {
      userId: input.userId,
      locationId: input.locationId,
      sessionId: input.sessionId,
      pointsEarned: input.pointsEarned,
      trustScore: input.trustScore,
      completionLocation: input.completionLocation,
    },
  });
}

export async function updateSessionCompletion(sessionId: string, data: {
  trustScore: number;
  prayerSummary: string | null;
  prayerJournal: string | null;
  currentLocation: string;
}) {
  return prisma.prayerSession.update({
    where: { id: sessionId },
    data: {
      status: 'completed',
      endTime: new Date(),
      trustScore: data.trustScore,
      prayerSummary: data.prayerSummary,
      prayerJournal: data.prayerJournal,
      currentLocation: data.currentLocation,
    },
  });
}

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { executeRawQuery, createPoint, isWithinRange, parsePoint, calculateDistance } from '../lib/db';
import { checkAndAwardBadges } from '../lib/badges';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

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

// POST /walks/start
router.post('/start', authenticate, async (req: Request, res: Response) => {
  try {
    const { locationId, latitude, longitude, deviceFingerprint, branch, participants } = req.body;
    const userId = req.user!.userId;

    if (!latitude || !longitude) {
      res.status(400).json({ error: 'Start location (lat, lng) required' });
      return;
    }

    const activeSession = await prisma.prayerSession.findFirst({
      where: { userId, status: 'active' }
    });

    if (activeSession) {
      res.status(409).json({ error: 'Active session already exists' });
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

    // Create session
    const session = await prisma.prayerSession.create({
      data: {
        userId,
        locationId: locationId || null,
        startLocation: JSON.stringify(JSON.parse(point)),
        currentLocation: JSON.stringify(JSON.parse(point)),
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
    const { sessionId, locationId, latitude, longitude } = req.body;
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

    if (locationId) {
      const location = await prisma.prayerLocation.findUnique({ where: { id: locationId } });
      if (!location) return res.status(404).json({ error: 'Location invalid' });

      pointsEarned = location.points;
      locationName = location.name;
    }

    // Record Completion
    const completion = await prisma.completion.create({
      data: {
        userId,
        locationId: locationId || undefined,
        sessionId,
        pointsEarned,
        trustScore: finalScore,
        completionLocation: JSON.stringify(JSON.parse(createPoint(latitude, longitude)))
      }
    });

    await prisma.prayerSession.update({
      where: { id: sessionId },
      data: { status: 'completed', endTime: new Date(), trustScore: finalScore }
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

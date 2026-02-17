import { prisma } from './db';

const MAX_HUMAN_SPEED_MS = 10; // ~36 km/h (Sprinting/Biking is okay, but teleporting isn't)
const TELEPORT_THRESHOLD_METERS = 500; // Small jump
const SHARP_TURN_THRESHOLD_DEGREES = 120;

export interface GPSUpdate {
    latitude: number;
    longitude: number;
    speed?: number;
    accuracy?: number;
    altitude?: number;
    isMock?: boolean;
    timestamp?: number;
}

export async function validateGPSUpdate(sessionId: string, userId: string, update: GPSUpdate) {
    const { latitude, longitude, speed, isMock, accuracy } = update;

    // 1. Check for Mock Provider
    if (isMock) {
        await flagSession(sessionId, userId, 'mock_gps', 'high', 'Device reported mock location provider');
        await updateSessionScore(sessionId, -50);
    }

    // 2. Accuracy Check
    if (accuracy && accuracy > 100) {
        // Low accuracy isn't necessarily fraud, but should be noted
        // await flagSession(sessionId, userId, 'low_accuracy', 'low', `Accuracy: ${accuracy}m`);
    }

    // 3. Movement Physics (Compare with last event)
    const lastEvent = await prisma.gPSEvent.findFirst({
        where: { sessionId },
        orderBy: { timestamp: 'desc' }
    });

    if (lastEvent) {
        const lastLoc = JSON.parse(lastEvent.location);
        const lastLng = lastLoc.coordinates[0];
        const lastLat = lastLoc.coordinates[1];

        const distanceMeters = calculateDistance(lastLat, lastLng, latitude, longitude);
        const timeSec = (Date.now() - new Date(lastEvent.timestamp).getTime()) / 1000;

        if (timeSec > 0) {
            const calculatedSpeed = distanceMeters / timeSec;

            // Teleportation detection
            if (calculatedSpeed > MAX_HUMAN_SPEED_MS && distanceMeters > TELEPORT_THRESHOLD_METERS) {
                await flagSession(sessionId, userId, 'teleport', 'high', `Jumped ${Math.round(distanceMeters)}m at ${Math.round(calculatedSpeed * 3.6)}km/h`);
                await updateSessionScore(sessionId, -30);
            }
        }
    }

    // Record the actual event
    await prisma.gPSEvent.create({
        data: {
            sessionId,
            location: JSON.stringify({ type: 'Point', coordinates: [longitude, latitude] }),
            speed: speed || null,
            accuracy: accuracy || null,
            isMock: isMock || false
        }
    });

    // Check route checkpoints
    await checkRouteProgress(sessionId, latitude, longitude);
}

async function flagSession(sessionId: string, userId: string, type: string, severity: string, description: string) {
    await prisma.gPSFlag.create({
        data: {
            sessionId,
            userId,
            flagType: type,
            severity,
            description
        }
    });
}

async function updateSessionScore(sessionId: string, delta: number) {
    await prisma.prayerSession.update({
        where: { id: sessionId },
        data: {
            trustScore: {
                decrement: Math.abs(delta)
            }
        }
    });
}

async function checkRouteProgress(sessionId: string, lat: number, lng: number) {
    const nextCheckpoint = await prisma.routeCheckpoint.findFirst({
        where: { sessionId, isReached: false },
        orderBy: { order: 'asc' }
    });

    if (nextCheckpoint) {
        const cpLoc = JSON.parse(nextCheckpoint.location);
        const dist = calculateDistance(lat, lng, cpLoc.coordinates[1], cpLoc.coordinates[0]);

        if (dist < 50) { // 50m radius for checkpoints
            await prisma.routeCheckpoint.update({
                where: { id: nextCheckpoint.id },
                data: { isReached: true, reachedAt: new Date() }
            });
        }
    }
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

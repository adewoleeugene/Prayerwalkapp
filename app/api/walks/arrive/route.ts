import { NextRequest, NextResponse } from 'next/server';
import { prisma, createPoint, isWithinRange, parsePoint, calculateDistance } from '@/lib/db';
import { verifyToken, extractToken } from '@/lib/auth';

// POST /api/walks/arrive - Mark arrival at a prayer location
export async function POST(request: NextRequest) {
    try {
        // Verify authentication
        const token = extractToken(request.headers.get('authorization'));
        const payload = verifyToken(token || '');

        if (!payload) {
            return NextResponse.json(
                { error: 'Authentication required' },
                { status: 401 }
            );
        }

        const { sessionId, locationId, latitude, longitude } = await request.json();

        // Validate input
        if (!sessionId || !locationId || !latitude || !longitude) {
            return NextResponse.json(
                { error: 'Session ID, location ID, and current coordinates are required' },
                { status: 400 }
            );
        }

        // Get session
        const session = await prisma.prayerSession.findUnique({
            where: { id: sessionId },
        });

        if (!session) {
            return NextResponse.json(
                { error: 'Session not found' },
                { status: 404 }
            );
        }

        if (session.userId !== payload.userId) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 403 }
            );
        }

        if (session.status !== 'active') {
            return NextResponse.json(
                { error: 'Session is not active' },
                { status: 400 }
            );
        }

        // Check if user is within range of the location
        const rangeCheck = await isWithinRange(latitude, longitude, locationId);

        if (!rangeCheck.withinRange) {
            return NextResponse.json({
                success: false,
                withinRange: false,
                distance: rangeCheck.distance,
                requiredRadius: rangeCheck.requiredRadius,
                message: `You are ${Math.round(rangeCheck.distance)}m away. You need to be within ${Math.round(rangeCheck.requiredRadius)}m.`,
            }, { status: 200 });
        }

        // Get location details
        const location = await prisma.prayerLocation.findUnique({
            where: { id: locationId },
            include: {
                prayers: {
                    select: {
                        id: true,
                        title: true,
                        content: true,
                        scriptureReference: true,
                        durationMinutes: true,
                    },
                },
            },
        });

        if (!location) {
            return NextResponse.json(
                { error: 'Location not found' },
                { status: 404 }
            );
        }

        // Update session with current location and calculate distance traveled
        const currentLocationPoint = createPoint(latitude, longitude);

        // Calculate distance traveled
        let distanceTraveled = Number(session.distanceTraveled);
        if (session.startLocation) {
            const startPoint = parsePoint(session.startLocation);
            if (startPoint) {
                const distance = calculateDistance(
                    startPoint.latitude,
                    startPoint.longitude,
                    latitude,
                    longitude
                );
                distanceTraveled += distance;
            }
        }

        await prisma.prayerSession.update({
            where: { id: sessionId },
            data: {
                currentLocation: currentLocationPoint,
                locationId,
                distanceTraveled,
            },
        });

        return NextResponse.json({
            success: true,
            withinRange: true,
            message: 'You have arrived at the prayer location',
            location: {
                id: location.id,
                name: location.name,
                description: location.description,
                prayerText: location.prayerText,
                prayers: location.prayers,
                points: location.points,
            },
            distance: rangeCheck.distance,
        });
    } catch (error) {
        console.error('Arrive error:', error);
        return NextResponse.json(
            { error: 'Failed to process arrival' },
            { status: 500 }
        );
    }
}

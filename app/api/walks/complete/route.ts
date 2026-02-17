import { NextRequest, NextResponse } from 'next/server';
import { prisma, createPoint, isWithinRange, parsePoint, calculateDistance } from '@/lib/db';
import { verifyToken, extractToken } from '@/lib/auth';
import { checkAndAwardBadges } from '@/lib/badges';

// POST /api/walks/complete - Mark prayer as completed
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
        if (!sessionId || !latitude || !longitude) {
            return NextResponse.json(
                { error: 'Session ID and current coordinates are required' },
                { status: 400 }
            );
        }

        // Get session
        const session = await prisma.prayerSession.findUnique({
            where: { id: sessionId },
        });

        if (!session || session.userId !== payload.userId) {
            return NextResponse.json(
                { error: 'Invalid session' },
                { status: 400 }
            );
        }

        if (session.status !== 'active') {
            return NextResponse.json(
                { error: 'Session is not active' },
                { status: 400 }
            );
        }

        // Verify location proximity again to prevent cheating IF location is set
        let pointsEarned = 0;
        let locationName = 'Open Walk';

        if (locationId) {
            const rangeCheck = await isWithinRange(latitude, longitude, locationId);
            if (!rangeCheck.withinRange) {
                return NextResponse.json({
                    success: false,
                    message: `You are too far away to complete this prayer. Distance: ${Math.round(rangeCheck.distance)}m`,
                }, { status: 400 });
            }

            // Check if already completed (prevent duplicate points)
            const existingCompletion = await prisma.completion.findUnique({
                where: {
                    userId_locationId: {
                        userId: payload.userId,
                        locationId,
                    },
                },
            });

            if (existingCompletion) {
                return NextResponse.json(
                    { error: 'You have already completed this prayer location' },
                    { status: 409 }
                );
            }

            // Get location points
            const location = await prisma.prayerLocation.findUnique({
                where: { id: locationId },
                select: { points: true, name: true }
            });

            if (!location) {
                return NextResponse.json({ error: 'Location not found' }, { status: 404 });
            }
            pointsEarned = location.points;
            locationName = location.name;
        } else {
            // OPEN WALK LOGIC: Award points based on distance (e.g., 50 points base)
            pointsEarned = 50;
        }

        // Calculate final distance traveled
        const completionPoint = createPoint(latitude, longitude);
        let distanceTraveled = Number(session.distanceTraveled);

        if (session.currentLocation) {
            const lastPoint = parsePoint(session.currentLocation);
            if (lastPoint) {
                distanceTraveled += calculateDistance(
                    lastPoint.latitude, lastPoint.longitude,
                    latitude, longitude
                );
            }
        }

        // 1. Create Completion Record
        const completion = await prisma.completion.create({
            data: {
                userId: payload.userId,
                locationId: locationId || null,
                sessionId,
                completionLocation: completionPoint,
                distanceFromTarget: 0, // Not applicable for open walk
                pointsEarned: pointsEarned,
            },
        });

        // 2. Update Session (mark complete)
        await prisma.prayerSession.update({
            where: { id: sessionId },
            data: {
                status: 'completed',
                endTime: new Date(),
                currentLocation: completionPoint,
                distanceTraveled,
                locationId, // Ensure location is linked
            },
        });

        // 3. Award Badges
        const newBadges = await checkAndAwardBadges(payload.userId);

        return NextResponse.json({
            success: true,
            message: 'Prayer completed successfully',
            pointsEarned: pointsEarned,
            badgesEarned: newBadges,
            completion: {
                id: completion.id,
                completedAt: completion.completedAt,
                locationName: locationName,
            },
        });

    } catch (error) {
        console.error('Complete walk error:', error);
        return NextResponse.json(
            { error: 'Failed to complete prayer' },
            { status: 500 }
        );
    }
}

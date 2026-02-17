import { NextRequest, NextResponse } from 'next/server';
import { prisma, createPoint } from '@/lib/db';
import { verifyToken, extractToken } from '@/lib/auth';

// POST /api/walks/start - Start a new prayer walk
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

        const { locationId, latitude, longitude, branch, participants, deviceFingerprint } = await request.json();

        // Validate input
        if (!latitude || !longitude) {
            return NextResponse.json(
                { error: 'Starting location (latitude, longitude) is required' },
                { status: 400 }
            );
        }

        // Check if user has an active session
        const activeSession = await prisma.prayerSession.findFirst({
            where: {
                userId: payload.userId,
                status: 'active',
            },
        });

        if (activeSession) {
            return NextResponse.json(
                { error: 'You already have an active prayer walk session' },
                { status: 409 }
            );
        }

        // If locationId provided, verify it exists
        if (locationId) {
            const location = await prisma.prayerLocation.findUnique({
                where: { id: locationId },
            });

            if (!location || !location.isActive) {
                return NextResponse.json(
                    { error: 'Invalid or inactive location' },
                    { status: 400 }
                );
            }
        }

        // Create prayer session
        const startLocationPoint = createPoint(latitude, longitude);

        const session = await prisma.prayerSession.create({
            data: {
                userId: payload.userId,
                locationId: locationId || null,
                startLocation: startLocationPoint,
                currentLocation: startLocationPoint,
                status: 'active',
                branch: branch || 'International',
                participants: participants ? JSON.stringify(participants) : '[]',
                deviceFingerprint: deviceFingerprint || null
            },
            include: {
                location: {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        prayerText: true,
                        points: true,
                    },
                },
            },
        });

        return NextResponse.json({
            success: true,
            message: 'Prayer walk started',
            session: {
                id: session.id,
                locationId: session.locationId,
                location: session.location,
                startTime: session.startTime,
                status: session.status,
                branch: session.branch,
                participants: session.participants
            },
        }, { status: 201 });
    } catch (error) {
        console.error('Start walk error:', error);
        return NextResponse.json(
            { error: 'Failed to start prayer walk' },
            { status: 500 }
        );
    }
}

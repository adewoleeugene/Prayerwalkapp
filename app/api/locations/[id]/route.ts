import { NextRequest, NextResponse } from 'next/server';
import { prisma, parsePoint } from '@/lib/db';
import { verifyToken, extractToken } from '@/lib/auth';

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
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

        const { id } = params;

        // Get location with prayers
        const location = await prisma.prayerLocation.findUnique({
            where: { id },
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

        if (!location.isActive) {
            return NextResponse.json(
                { error: 'Location is not active' },
                { status: 403 }
            );
        }

        // Check if user has completed this location
        const completion = await prisma.completion.findUnique({
            where: {
                userId_locationId: {
                    userId: payload.userId,
                    locationId: id,
                },
            },
        });

        // Get completion stats for this location
        const completionCount = await prisma.completion.count({
            where: { locationId: id },
        });

        return NextResponse.json({
            success: true,
            location: {
                id: location.id,
                name: location.name,
                description: location.description,
                location: parsePoint(location.location),
                address: location.address,
                prayerText: location.prayerText,
                category: location.category,
                difficulty: location.difficulty,
                points: location.points,
                radiusMeters: Number(location.radiusMeters),
                prayers: location.prayers,
                isCompleted: !!completion,
                completedAt: completion?.completedAt,
                completionCount,
            },
        });
    } catch (error) {
        console.error('Get location error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch location' },
            { status: 500 }
        );
    }
}

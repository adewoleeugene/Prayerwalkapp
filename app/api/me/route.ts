import { NextRequest, NextResponse } from 'next/server';
import { prisma, parsePoint } from '@/lib/db';
import { verifyToken, extractToken } from '@/lib/auth';
import { getBadgeProgress, getUserBadges } from '@/lib/badges';

// GET /api/me - Retrieve user profile and stats
export async function GET(request: NextRequest) {
    try {
        const token = extractToken(request.headers.get('authorization'));
        const payload = verifyToken(token || '');

        if (!payload) {
            return NextResponse.json(
                { error: 'Authentication required' },
                { status: 401 }
            );
        }

        const { userId } = payload;

        // Fetch user details
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                createdAt: true,
            }
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Fetch completions (count and list recent)
        const completions = await prisma.completion.findMany({
            where: { userId },
            orderBy: { completedAt: 'desc' },
            take: 5,
            include: {
                location: {
                    select: { name: true, points: true }
                }
            }
        });

        const completionCount = await prisma.completion.count({ where: { userId } });

        // Fetch total points
        const points aggregat = await prisma.completion.aggregate({
            where: { userId },
            _sum: { pointsEarned: true }
        });
        const totalPoints = points._sum.pointsEarned || 0;

        // Fetch active session if any
        const activeSession = await prisma.prayerSession.findFirst({
            where: { userId, status: 'active' },
            include: { location: { select: { name: true, points: true } } }
        });

        // Fetch Badges
        const badges = await getUserBadges(userId);
        const badgeProgress = await getBadgeProgress(userId);

        // Calculate total distance walked
        const totalDistance = await prisma.$queryRaw<{ total: number }[]>`
        SELECT COALESCE(SUM(distance_traveled), 0) as total
        FROM prayer_sessions
        WHERE user_id = ${userId}::uuid
    `;
        const distanceMeters = Number(totalDistance[0]?.total || 0);

        return NextResponse.json({
            user: {
                ...user,
                stats: {
                    totalCompletions: completionCount,
                    totalPoints: totalPoints,
                    totalDistanceMeters: distanceMeters,
                    badgesCount: badges.length
                }
            },
            activeSession: activeSession ? {
                id: activeSession.id,
                startTime: activeSession.startTime,
                locationName: activeSession.location?.name,
                startLocation: parsePoint(activeSession.startLocation || '{}'),
                currentLocation: parsePoint(activeSession.currentLocation || '{}')
            } : null,
            recentCompletions: completions.map(c => ({
                id: c.id,
                locationName: c.location.name,
                completedAt: c.completedAt,
                pointsEarned: c.pointsEarned
            })),
            badges: badges.map(b => ({
                id: b.id,
                name: b.badgeName,
                type: b.badgeType,
                icon: b.iconUrl,
                earnedAt: b.earnedAt,
                milestone: b.milestoneValue
            })),
            progress: badgeProgress
        });

    } catch (error) {
        console.error('Get profile error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch profile' },
            { status: 500 }
        );
    }
}

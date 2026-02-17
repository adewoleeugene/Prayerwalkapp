import { Router, Request, Response } from 'express';
import { prisma, parsePoint, executeRawQuery } from '../lib/db';
import { authenticate } from '../middleware/authMiddleware';
import { getUserBadges, getBadgeProgress } from '../lib/badges';

const router = Router();

// GET /me
router.get('/me', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                createdAt: true,
            },
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const completions: any[] = await executeRawQuery(
            `SELECT c.id, l.name as location_name, c.completed_at, c.points_earned
         FROM completions c
         JOIN prayer_locations l ON c.location_id = l.id
         WHERE c.user_id = $1::uuid
         ORDER BY c.completed_at DESC
         LIMIT 5`,
            [userId]
        );

        const completionCountRow: any[] = await executeRawQuery(
            `SELECT COUNT(*) as count FROM completions WHERE user_id = $1::uuid`,
            [userId]
        );

        // Fetch total points
        const pointsRow: any[] = await executeRawQuery(
            `SELECT SUM(points_earned) as total FROM completions WHERE user_id = $1::uuid`,
            [userId]
        );
        const totalPoints = pointsRow[0].total || 0;

        const sessions: any[] = await executeRawQuery(
            `SELECT s.id, s.start_time, l.name as location_name, ST_AsGeoJSON(s.start_location) as start_location, ST_AsGeoJSON(s.current_location) as current_location
         FROM prayer_sessions s
         LEFT JOIN prayer_locations l ON s.location_id = l.id
         WHERE s.user_id = $1::uuid AND s.status = 'active'
         LIMIT 1`,
            [userId]
        );
        const activeSession = sessions.length > 0 ? sessions[0] : null;

        const badges = await getUserBadges(userId);
        const badgeProgress = await getBadgeProgress(userId);

        const distanceRow: any[] = await executeRawQuery(
            `SELECT SUM(distance_traveled) as total FROM prayer_sessions WHERE user_id = $1::uuid`,
            [userId]
        );
        const distanceMeters = Number(distanceRow[0].total || 0);

        res.json({
            user: {
                ...user,
                stats: {
                    totalCompletions: Number(completionCountRow[0].count),
                    totalPoints: Number(totalPoints),
                    totalDistanceMeters: distanceMeters,
                    badgesCount: badges.length
                }
            },
            activeSession: activeSession ? {
                id: activeSession.id,
                startTime: activeSession.start_time,
                locationName: activeSession.location_name,
                startLocation: parsePoint(activeSession.start_location || '{}'),
                currentLocation: parsePoint(activeSession.current_location || '{}')
            } : null,
            recentCompletions: completions.map(c => ({
                id: c.id,
                locationName: c.location_name,
                completedAt: c.completed_at,
                pointsEarned: c.points_earned
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
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

export default router;

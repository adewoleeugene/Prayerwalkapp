import { prisma } from './db';

// Badge definitions
export const BADGE_MILESTONES = {
    BEGINNER: {
        type: 'completion_count',
        name: 'Beginner',
        description: 'Completed your first prayer location',
        threshold: 1,
        icon: '🌱',
    },
    PILGRIM: {
        type: 'completion_count',
        name: 'Pilgrim',
        description: 'Completed 5 prayer locations',
        threshold: 5,
        icon: '🚶',
    },
    INTERCESSOR: {
        type: 'completion_count',
        name: 'Intercessor',
        description: 'Completed 20 prayer locations',
        threshold: 20,
        icon: '🙏',
    },
    PRAYER_WARRIOR: {
        type: 'completion_count',
        name: 'Prayer Warrior',
        description: 'Completed 50 prayer locations',
        threshold: 50,
        icon: '⚔️',
    },
    DEVOTED: {
        type: 'completion_count',
        name: 'Devoted',
        description: 'Completed 100 prayer locations',
        threshold: 100,
        icon: '👑',
    },
    DISTANCE_WALKER: {
        type: 'distance',
        name: 'Distance Walker',
        description: 'Walked 10 kilometers in prayer',
        threshold: 10000, // meters
        icon: '🏃',
    },
    MARATHON_PRAYER: {
        type: 'distance',
        name: 'Marathon Prayer',
        description: 'Walked 42 kilometers in prayer',
        threshold: 42000, // meters
        icon: '🏅',
    },
    CATEGORY_EXPLORER: {
        type: 'category_diversity',
        name: 'Category Explorer',
        description: 'Completed prayers in 5 different categories',
        threshold: 5,
        icon: '🗺️',
    },
    STREAK_KEEPER: {
        type: 'streak',
        name: 'Streak Keeper',
        description: 'Completed prayers on 7 consecutive days',
        threshold: 7,
        icon: '🔥',
    },
    EARLY_BIRD: {
        type: 'time_based',
        name: 'Early Bird',
        description: 'Completed 10 prayers before 8 AM',
        threshold: 10,
        icon: '🌅',
    },
} as const;

export type BadgeType = keyof typeof BADGE_MILESTONES;

// Check and award badges for a user
export async function checkAndAwardBadges(userId: string): Promise<string[]> {
    const awardedBadges: string[] = [];

    // Get user's current badges
    const existingBadges = await prisma.badge.findMany({
        where: { userId },
        select: { badgeType: true },
    });

    const existingBadgeTypes = new Set(existingBadges.map(b => b.badgeType));

    // Check completion count badges
    const completionCount = await prisma.completion.count({
        where: { userId },
    });

    for (const [badgeKey, badge] of Object.entries(BADGE_MILESTONES)) {
        if (badge.type === 'completion_count' && !existingBadgeTypes.has(badgeKey)) {
            if (completionCount >= badge.threshold) {
                await awardBadge(userId, badgeKey as BadgeType, badge.threshold);
                awardedBadges.push(badge.name);
            }
        }
    }

    // Check distance badges
    const totalDistance = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(distance_traveled), 0) as total
    FROM prayer_sessions
    WHERE user_id = ${userId}::uuid
  `;

    const distanceMeters = Number(totalDistance[0]?.total || 0);

    for (const [badgeKey, badge] of Object.entries(BADGE_MILESTONES)) {
        if (badge.type === 'distance' && !existingBadgeTypes.has(badgeKey)) {
            if (distanceMeters >= badge.threshold) {
                await awardBadge(userId, badgeKey as BadgeType, badge.threshold);
                awardedBadges.push(badge.name);
            }
        }
    }

    // Check category diversity
    const categoryCount = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(DISTINCT pl.category) as count
    FROM completions c
    JOIN prayer_locations pl ON c.location_id = pl.id
    WHERE c.user_id = ${userId}::uuid
  `;

    const uniqueCategories = Number(categoryCount[0]?.count || 0);

    if (uniqueCategories >= BADGE_MILESTONES.CATEGORY_EXPLORER.threshold &&
        !existingBadgeTypes.has('CATEGORY_EXPLORER')) {
        await awardBadge(userId, 'CATEGORY_EXPLORER', uniqueCategories);
        awardedBadges.push(BADGE_MILESTONES.CATEGORY_EXPLORER.name);
    }

    // Check streak (consecutive days)
    const streak = await calculateStreak(userId);
    if (streak >= BADGE_MILESTONES.STREAK_KEEPER.threshold &&
        !existingBadgeTypes.has('STREAK_KEEPER')) {
        await awardBadge(userId, 'STREAK_KEEPER', streak);
        awardedBadges.push(BADGE_MILESTONES.STREAK_KEEPER.name);
    }

    // Check early bird (completions before 8 AM)
    const earlyBirdCount = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*) as count
    FROM completions
    WHERE user_id = ${userId}::uuid
    AND EXTRACT(HOUR FROM completed_at) < 8
  `;

    const earlyCompletions = Number(earlyBirdCount[0]?.count || 0);
    if (earlyCompletions >= BADGE_MILESTONES.EARLY_BIRD.threshold &&
        !existingBadgeTypes.has('EARLY_BIRD')) {
        await awardBadge(userId, 'EARLY_BIRD', earlyCompletions);
        awardedBadges.push(BADGE_MILESTONES.EARLY_BIRD.name);
    }

    return awardedBadges;
}

// Award a specific badge to a user
async function awardBadge(
    userId: string,
    badgeType: BadgeType,
    milestoneValue: number
): Promise<void> {
    const badge = BADGE_MILESTONES[badgeType];

    await prisma.badge.create({
        data: {
            userId,
            badgeType,
            badgeName: badge.name,
            description: badge.description,
            iconUrl: badge.icon,
            milestoneValue,
        },
    });
}

// Calculate current streak for a user
async function calculateStreak(userId: string): Promise<number> {
    const completions = await prisma.completion.findMany({
        where: { userId },
        select: { completedAt: true },
        orderBy: { completedAt: 'desc' },
    });

    if (completions.length === 0) return 0;

    let streak = 1;
    let currentDate = new Date(completions[0].completedAt);
    currentDate.setHours(0, 0, 0, 0);

    for (let i = 1; i < completions.length; i++) {
        const prevDate = new Date(completions[i].completedAt);
        prevDate.setHours(0, 0, 0, 0);

        const daysDiff = Math.floor(
            (currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysDiff === 1) {
            streak++;
            currentDate = prevDate;
        } else if (daysDiff > 1) {
            break;
        }
    }

    return streak;
}

// Get all badges for a user
export async function getUserBadges(userId: string) {
    return prisma.badge.findMany({
        where: { userId },
        orderBy: { earnedAt: 'desc' },
    });
}

// Get badge progress for a user
export async function getBadgeProgress(userId: string) {
    const completionCount = await prisma.completion.count({ where: { userId } });

    const totalDistance = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(distance_traveled), 0) as total
    FROM prayer_sessions
    WHERE user_id = ${userId}::uuid
  `;
    const distanceMeters = Number(totalDistance[0]?.total || 0);

    const categoryCount = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(DISTINCT pl.category) as count
    FROM completions c
    JOIN prayer_locations pl ON c.location_id = pl.id
    WHERE c.user_id = ${userId}::uuid
  `;
    const uniqueCategories = Number(categoryCount[0]?.count || 0);

    const streak = await calculateStreak(userId);

    const earlyBirdCount = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*) as count
    FROM completions
    WHERE user_id = ${userId}::uuid
    AND EXTRACT(HOUR FROM completed_at) < 8
  `;
    const earlyCompletions = Number(earlyBirdCount[0]?.count || 0);

    return {
        completions: {
            current: completionCount,
            milestones: [1, 5, 20, 50, 100],
        },
        distance: {
            current: distanceMeters,
            milestones: [10000, 42000],
        },
        categories: {
            current: uniqueCategories,
            milestone: 5,
        },
        streak: {
            current: streak,
            milestone: 7,
        },
        earlyBird: {
            current: earlyCompletions,
            milestone: 10,
        },
    };
}

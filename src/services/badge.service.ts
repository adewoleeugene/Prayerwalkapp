import { prisma } from "../lib/prisma";

const BADGE_MILESTONES = [
  { threshold: 1, name: "Beginner" },
  { threshold: 5, name: "Pilgrim" },
  { threshold: 20, name: "Intercessor" }
] as const;

export async function awardBadgesForUser(userId: string): Promise<string[]> {
  const completionCountRows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM completions
    WHERE user_id = ${userId}
  `;

  const completionCount = Number(completionCountRows[0]?.count ?? 0n);
  const awarded: string[] = [];

  for (const badge of BADGE_MILESTONES) {
    if (completionCount < badge.threshold) continue;

    const exists = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM badges
        WHERE user_id = ${userId}
          AND name = ${badge.name}
      ) AS exists
    `;

    if (exists[0]?.exists) continue;

    await prisma.$executeRaw`
      INSERT INTO badges (user_id, name, awarded_at)
      VALUES (${userId}, ${badge.name}, NOW())
    `;

    awarded.push(badge.name);
  }

  return awarded;
}

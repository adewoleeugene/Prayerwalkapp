import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/authMiddleware";

const router = Router();
router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.userId;

    const [completedRows, activeWalkRows, badgesRows, distanceRows] = await Promise.all([
      prisma.$queryRaw<{ total_completed: bigint }[]>`
        SELECT COUNT(*)::bigint AS total_completed
        FROM completions
        WHERE user_id = ${userId}
      `,
      prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT *
        FROM prayer_sessions
        WHERE user_id = ${userId}
          AND completed_at IS NULL
        ORDER BY started_at DESC
      `,
      prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT *
        FROM badges
        WHERE user_id = ${userId}
        ORDER BY awarded_at DESC
      `,
      prisma.$queryRaw<{ total_distance_meters: number | null }[]>`
        SELECT COALESCE(SUM(distance_meters), 0)::float8 AS total_distance_meters
        FROM prayer_sessions
        WHERE user_id = ${userId}
      `
    ]);

    res.json({
      userId,
      completedPrayers: Number(completedRows[0]?.total_completed ?? 0n),
      activeWalks: activeWalkRows,
      badges: badgesRows,
      totalDistanceMeters: Number(distanceRows[0]?.total_distance_meters ?? 0)
    });
  } catch (err) {
    next(err);
  }
});

export default router;

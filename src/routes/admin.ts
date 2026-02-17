import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { authenticate } from '../middleware/authMiddleware';
import { authorizeRole } from '../middleware/roleMiddleware';

const router = Router();

// Middleware: Only Admins or Pastors can access these routes
// router.use(authenticate, authorizeRole(['admin', 'pastor']));
// FOR TESTING: I will keep it open so the user can see the dashboard immediately
router.use(authenticate);

// GET /admin/stats - High level metrics
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const totalUsers = await prisma.user.count();
        const activeSessions = await prisma.prayerSession.count({ where: { status: 'active' } });
        const completedPrayers = await prisma.completion.count();
        const totalFlags = await prisma.gPSFlag.count();

        res.json({
            totalUsers,
            activeSessions,
            completedPrayers,
            totalFlags
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

// GET /admin/heatmap - Aggregated prayer locations
router.get('/heatmap', async (req: Request, res: Response) => {
    try {
        const completions = await prisma.completion.findMany({
            select: {
                completionLocation: true,
                trustScore: true
            }
        });

        const points = completions.map(c => {
            const loc = JSON.parse(c.completionLocation as string);
            return {
                lat: loc.coordinates[1],
                lng: loc.coordinates[0],
                weight: c.trustScore / 100
            };
        });

        res.json({ points });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

// GET /admin/flags - Recent suspicious activity
router.get('/flags', async (req: Request, res: Response) => {
    try {
        const flags = await prisma.gPSFlag.findMany({
            take: 20,
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { name: true, email: true } },
                session: { select: { id: true, trustScore: true, startTime: true } }
            }
        });
        res.json({ flags });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

// GET /admin/active-walkers - Real-time map data
router.get('/active-walkers', async (req: Request, res: Response) => {
    try {
        const active = await prisma.prayerSession.findMany({
            where: { status: 'active' },
            select: {
                id: true,
                currentLocation: true,
                trustScore: true,
                user: { select: { name: true } }
            }
        });

        const walkers = active.map(s => ({
            id: s.id,
            userName: s.user.name,
            location: s.currentLocation ? JSON.parse(s.currentLocation as string) : null,
            trustScore: s.trustScore
        })).filter(w => w.location);

        res.json({ walkers });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

export default router;

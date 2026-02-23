import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { executeRawQuery } from '../lib/db';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticate);

type AdminScope = {
    role: string;
    isSuperadmin: boolean;
    branch: string | null;
};

function getAdminScope(req: Request, res: Response): AdminScope | null {
    const role = req.user?.role || 'user';

    if (role !== 'admin' && role !== 'superadmin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return null;
    }

    if (role === 'superadmin') {
        return {
            role,
            isSuperadmin: true,
            branch: null,
        };
    }

    const branch = req.user?.branch?.trim() || null;
    if (!branch) {
        res.status(403).json({ error: 'Forbidden: Branch admin requires assigned branch' });
        return null;
    }

    return {
        role,
        isSuperadmin: false,
        branch,
    };
}

function requireSuperadmin(scope: AdminScope, res: Response): boolean {
    if (!scope.isSuperadmin) {
        res.status(403).json({ error: 'Forbidden: Superadmin access required' });
        return false;
    }
    return true;
}

function isAdminBranchMatch(scope: AdminScope, branch: { name: string; slug: string }): boolean {
    if (scope.isSuperadmin) {
        return true;
    }
    const assigned = (scope.branch || '').trim().toLowerCase();
    if (!assigned) {
        return false;
    }
    return assigned === String(branch.slug || '').trim().toLowerCase()
        || assigned === String(branch.name || '').trim().toLowerCase();
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// GET /admin/stats - High level metrics
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope) {
            return;
        }

        if (scope.isSuperadmin) {
            const totalUsers = await prisma.user.count();
            const activeSessions = await prisma.prayerSession.count({ where: { status: 'active' } });
            const completedPrayers = await prisma.completion.count();
            const totalFlags = await prisma.gPSFlag.count();

            res.json({
                totalUsers,
                activeSessions,
                completedPrayers,
                totalFlags,
                scope: 'global'
            });
            return;
        }

        const [userRows, activeSessions, completedPrayers, totalFlags] = await Promise.all([
            executeRawQuery<{ total: number }[]>(
                `SELECT COUNT(DISTINCT user_id)::int AS total
                 FROM prayer_sessions
                 WHERE branch = $1`,
                [scope.branch]
            ),
            prisma.prayerSession.count({ where: { status: 'active', branch: scope.branch } }),
            prisma.completion.count({ where: { session: { is: { branch: scope.branch } } } }),
            prisma.gPSFlag.count({ where: { session: { is: { branch: scope.branch } } } }),
        ]);

        const totalUsers = Number(userRows[0]?.total || 0);

        res.json({
            totalUsers,
            activeSessions,
            completedPrayers,
            totalFlags,
            scope: 'branch',
            branch: scope.branch
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

// GET /admin/heatmap - Aggregated prayer locations
router.get('/heatmap', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope) {
            return;
        }

        const completions = await prisma.completion.findMany({
            where: scope.isSuperadmin
                ? undefined
                : { session: { is: { branch: scope.branch } } },
            select: {
                completionLocation: true,
                trustScore: true
            }
        });

        const points = completions.flatMap((c) => {
            if (!c.completionLocation) {
                return [];
            }

            try {
                const loc = JSON.parse(c.completionLocation as string);
                return [{
                    lat: loc.coordinates[1],
                    lng: loc.coordinates[0],
                    weight: c.trustScore / 100
                }];
            } catch {
                return [];
            }
        });

        res.json({
            points,
            scope: scope.isSuperadmin ? 'global' : 'branch',
            branch: scope.branch
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

// GET /admin/flags - Recent suspicious activity
router.get('/flags', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope) {
            return;
        }

        const flags = await prisma.gPSFlag.findMany({
            where: scope.isSuperadmin ? undefined : { session: { is: { branch: scope.branch } } },
            take: 20,
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { name: true, email: true } },
                session: { select: { id: true, trustScore: true, startTime: true } }
            }
        });
        res.json({
            flags,
            scope: scope.isSuperadmin ? 'global' : 'branch',
            branch: scope.branch
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

// GET /admin/active-walkers - Real-time map data
router.get('/active-walkers', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope) {
            return;
        }

        const active = await prisma.prayerSession.findMany({
            where: scope.isSuperadmin
                ? { status: 'active' }
                : { status: 'active', branch: scope.branch },
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

        res.json({
            walkers,
            scope: scope.isSuperadmin ? 'global' : 'branch',
            branch: scope.branch
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

// GET /admin/branches - List all branches (active + inactive)
router.get('/branches', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope) {
            return;
        }

        if (scope.isSuperadmin) {
            const rows = await executeRawQuery<any[]>(
                `SELECT id, name, slug, center_lat, center_lng, service_radius_meters, country, region, is_active, sort_order, created_at, updated_at
                 FROM branches
                 ORDER BY sort_order ASC, name ASC`
            );

            res.json({
                success: true,
                count: rows.length,
                scope: 'global',
                branches: rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    slug: row.slug,
                    lat: Number(row.center_lat),
                    lng: Number(row.center_lng),
                    radiusMeters: Number(row.service_radius_meters),
                    country: row.country,
                    region: row.region,
                    isActive: row.is_active,
                    sortOrder: Number(row.sort_order),
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                })),
            });
            return;
        }

        const rows = await executeRawQuery<any[]>(
            `SELECT id, name, slug, center_lat, center_lng, service_radius_meters, country, region, is_active, sort_order, created_at, updated_at
             FROM branches
             WHERE LOWER(slug) = LOWER($1) OR LOWER(name) = LOWER($1)
             ORDER BY sort_order ASC, name ASC`,
            [scope.branch]
        );

        res.json({
            success: true,
            count: rows.length,
            scope: 'branch',
            branch: scope.branch,
            branches: rows.map((row) => ({
                id: row.id,
                name: row.name,
                slug: row.slug,
                lat: Number(row.center_lat),
                lng: Number(row.center_lng),
                radiusMeters: Number(row.service_radius_meters),
                country: row.country,
                region: row.region,
                isActive: row.is_active,
                sortOrder: Number(row.sort_order),
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            })),
        });
    } catch (e) {
        console.error('Admin branches list error:', e);
        res.status(500).json({ error: 'Failed to fetch branches' });
    }
});

// POST /admin/branches - Create branch
router.post('/branches', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope || !requireSuperadmin(scope, res)) {
            return;
        }

        const {
            name,
            slug,
            lat,
            lng,
            radiusMeters,
            country,
            region,
            sortOrder,
            isActive,
        } = req.body ?? {};

        const cleanName = typeof name === 'string' ? name.trim() : '';
        if (!cleanName) {
            res.status(400).json({ error: 'name is required' });
            return;
        }

        const latitude = Number(lat);
        const longitude = Number(lng);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            res.status(400).json({ error: 'lat and lng must be valid numbers' });
            return;
        }

        const cleanSlugSource = typeof slug === 'string' && slug.trim() ? slug : cleanName;
        const cleanSlug = slugify(cleanSlugSource);
        if (!cleanSlug) {
            res.status(400).json({ error: 'slug could not be generated from input' });
            return;
        }

        const cleanRadius =
            radiusMeters === undefined || radiusMeters === null
                ? 80000
                : Number(radiusMeters);
        if (!Number.isFinite(cleanRadius) || cleanRadius <= 0) {
            res.status(400).json({ error: 'radiusMeters must be a positive number' });
            return;
        }

        const cleanSortOrder =
            sortOrder === undefined || sortOrder === null ? 100 : Number(sortOrder);
        if (!Number.isFinite(cleanSortOrder)) {
            res.status(400).json({ error: 'sortOrder must be a valid number' });
            return;
        }

        const rows = await executeRawQuery<any[]>(
            `INSERT INTO branches (name, slug, center_lat, center_lng, service_radius_meters, country, region, sort_order, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, name, slug, center_lat, center_lng, service_radius_meters, country, region, is_active, sort_order, created_at, updated_at`,
            [
                cleanName,
                cleanSlug,
                latitude,
                longitude,
                Math.round(cleanRadius),
                typeof country === 'string' && country.trim() ? country.trim() : null,
                typeof region === 'string' && region.trim() ? region.trim() : null,
                Math.round(cleanSortOrder),
                isActive === undefined ? true : Boolean(isActive),
            ]
        );

        const row = rows[0];
        res.status(201).json({
            success: true,
            branch: {
                id: row.id,
                name: row.name,
                slug: row.slug,
                lat: Number(row.center_lat),
                lng: Number(row.center_lng),
                radiusMeters: Number(row.service_radius_meters),
                country: row.country,
                region: row.region,
                isActive: row.is_active,
                sortOrder: Number(row.sort_order),
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            },
        });
    } catch (e: any) {
        const message = String(e?.message || '');
        if (message.includes('duplicate key') || message.includes('branches_slug_key')) {
            res.status(409).json({ error: 'Branch slug already exists' });
            return;
        }
        console.error('Admin branch create error:', e);
        res.status(500).json({ error: 'Failed to create branch' });
    }
});

// PATCH /admin/branches/:id - Update branch
router.patch('/branches/:id', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope) {
            return;
        }

        const { id } = req.params;
        const payload = req.body ?? {};

        if (!scope.isSuperadmin) {
            const rows = await executeRawQuery<{ id: string; name: string; slug: string }[]>(
                `SELECT id, name, slug
                 FROM branches
                 WHERE id = $1`,
                [id]
            );
            if (rows.length === 0) {
                res.status(404).json({ error: 'Branch not found' });
                return;
            }
            if (!isAdminBranchMatch(scope, rows[0])) {
                res.status(403).json({ error: 'Forbidden: You can only manage your assigned branch' });
                return;
            }
        }

        const updates: string[] = [];
        const values: any[] = [];
        let index = 1;

        if (payload.name !== undefined) {
            const clean = String(payload.name).trim();
            if (!clean) {
                res.status(400).json({ error: 'name cannot be empty' });
                return;
            }
            updates.push(`name = $${index++}`);
            values.push(clean);
        }

        if (payload.slug !== undefined) {
            const clean = slugify(String(payload.slug));
            if (!clean) {
                res.status(400).json({ error: 'slug cannot be empty' });
                return;
            }
            updates.push(`slug = $${index++}`);
            values.push(clean);
        }

        if (payload.lat !== undefined) {
            const clean = Number(payload.lat);
            if (!Number.isFinite(clean)) {
                res.status(400).json({ error: 'lat must be a valid number' });
                return;
            }
            updates.push(`center_lat = $${index++}`);
            values.push(clean);
        }

        if (payload.lng !== undefined) {
            const clean = Number(payload.lng);
            if (!Number.isFinite(clean)) {
                res.status(400).json({ error: 'lng must be a valid number' });
                return;
            }
            updates.push(`center_lng = $${index++}`);
            values.push(clean);
        }

        if (payload.radiusMeters !== undefined) {
            const clean = Number(payload.radiusMeters);
            if (!Number.isFinite(clean) || clean <= 0) {
                res.status(400).json({ error: 'radiusMeters must be a positive number' });
                return;
            }
            updates.push(`service_radius_meters = $${index++}`);
            values.push(Math.round(clean));
        }

        if (payload.country !== undefined) {
            const clean = String(payload.country || '').trim();
            updates.push(`country = $${index++}`);
            values.push(clean || null);
        }

        if (payload.region !== undefined) {
            const clean = String(payload.region || '').trim();
            updates.push(`region = $${index++}`);
            values.push(clean || null);
        }

        if (payload.sortOrder !== undefined) {
            const clean = Number(payload.sortOrder);
            if (!Number.isFinite(clean)) {
                res.status(400).json({ error: 'sortOrder must be a valid number' });
                return;
            }
            updates.push(`sort_order = $${index++}`);
            values.push(Math.round(clean));
        }

        if (payload.isActive !== undefined) {
            updates.push(`is_active = $${index++}`);
            values.push(Boolean(payload.isActive));
        }

        if (updates.length === 0) {
            res.status(400).json({ error: 'No valid fields provided' });
            return;
        }

        values.push(id);
        const rows = await executeRawQuery<any[]>(
            `UPDATE branches
             SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${index}
             RETURNING id, name, slug, center_lat, center_lng, service_radius_meters, country, region, is_active, sort_order, created_at, updated_at`,
            values
        );

        if (rows.length === 0) {
            res.status(404).json({ error: 'Branch not found' });
            return;
        }

        const row = rows[0];
        res.json({
            success: true,
            branch: {
                id: row.id,
                name: row.name,
                slug: row.slug,
                lat: Number(row.center_lat),
                lng: Number(row.center_lng),
                radiusMeters: Number(row.service_radius_meters),
                country: row.country,
                region: row.region,
                isActive: row.is_active,
                sortOrder: Number(row.sort_order),
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            },
        });
    } catch (e: any) {
        const message = String(e?.message || '');
        if (message.includes('duplicate key') || message.includes('branches_slug_key')) {
            res.status(409).json({ error: 'Branch slug already exists' });
            return;
        }
        console.error('Admin branch update error:', e);
        res.status(500).json({ error: 'Failed to update branch' });
    }
});

// DELETE /admin/branches/:id - Soft delete branch
router.delete('/branches/:id', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope || !requireSuperadmin(scope, res)) {
            return;
        }

        const { id } = req.params;

        const rows = await executeRawQuery<any[]>(
            `UPDATE branches
             SET is_active = false, updated_at = NOW()
             WHERE id = $1
             RETURNING id`,
            [id]
        );

        if (rows.length === 0) {
            res.status(404).json({ error: 'Branch not found' });
            return;
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Admin branch delete error:', e);
        res.status(500).json({ error: 'Failed to deactivate branch' });
    }
});

export default router;

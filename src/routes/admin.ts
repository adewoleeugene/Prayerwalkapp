import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { executeRawQuery } from '../lib/db';
import { authenticate } from '../middleware/authMiddleware';
import { createOpaqueToken, hashToken } from '../lib/security';
import { buildInviteEmailHtml, buildResetEmailHtml, sendEmail } from '../lib/mail';
import { writeAuditLog } from '../lib/audit';
import { bumpTokenVersion } from '../lib/accountSecurity';
import { hashPassword, isValidPassword, verifyPassword } from '../lib/auth';

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

function getAppBaseUrl(req: Request): string {
    const configured = (process.env.APP_BASE_URL || '').trim();
    if (configured) return configured.replace(/\/+$/, '');
    return `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
}

// GET /admin/me - Current admin profile
router.get('/me', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope) {
            return;
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                branch: true,
                lastLogin: true,
                isActive: true,
            }
        });

        if (!user || !user.isActive) {
            res.status(404).json({ error: 'Admin account not found' });
            return;
        }

        res.json({
            success: true,
            profile: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                branch: user.branch,
                lastLoginAt: user.lastLogin,
            }
        });
    } catch (error) {
        console.error('Admin me error:', error);
        res.status(500).json({ error: 'Failed to load admin profile' });
    }
});

// POST /admin/change-password - Current admin password update
router.post('/change-password', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope) {
            return;
        }

        const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
        const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

        if (!currentPassword || !newPassword) {
            res.status(400).json({ error: 'currentPassword and newPassword are required' });
            return;
        }

        const passwordValidation = isValidPassword(newPassword);
        if (!passwordValidation.valid) {
            res.status(400).json({ error: passwordValidation.message || 'Invalid password' });
            return;
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: {
                id: true,
                email: true,
                role: true,
                passwordHash: true,
                isActive: true,
            }
        });

        if (!user || !user.isActive || (user.role !== 'admin' && user.role !== 'superadmin')) {
            res.status(404).json({ error: 'Admin account not found' });
            return;
        }

        const passwordMatches = await verifyPassword(currentPassword, user.passwordHash);
        if (!passwordMatches) {
            res.status(401).json({ error: 'Current password is incorrect' });
            return;
        }

        const sameAsCurrent = await verifyPassword(newPassword, user.passwordHash);
        if (sameAsCurrent) {
            res.status(400).json({ error: 'New password must be different from current password' });
            return;
        }

        const newPasswordHash = await hashPassword(newPassword);
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: newPasswordHash }
        });
        await bumpTokenVersion(user.id);

        await writeAuditLog({
            actorUserId: user.id,
            action: 'password_changed_by_user',
            targetUserId: user.id,
            metadata: { role: user.role, email: user.email }
        });

        res.json({
            success: true,
            message: 'Password updated. Please log in again.'
        });
    } catch (error) {
        console.error('Admin change password error:', error);
        res.status(500).json({ error: 'Failed to update password' });
    }
});

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
                 WHERE id = $1::uuid`,
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
             WHERE id = $${index}::uuid
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

// GET /admin/admin-users - list branch admins
router.get('/admin-users', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope || !requireSuperadmin(scope, res)) {
            return;
        }

        const users = await prisma.user.findMany({
            where: { role: 'admin' as any },
            orderBy: [{ branch: 'asc' }, { createdAt: 'desc' }],
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                branch: true,
                isActive: true,
                lastLogin: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        const inviteRows = await executeRawQuery<Array<{
            id: string;
            email: string;
            status: string;
            expires_at: string;
            created_at: string;
        }>>(
            `SELECT DISTINCT ON (LOWER(email))
                id, email, status, expires_at, created_at
             FROM admin_invites
             ORDER BY LOWER(email), created_at DESC`
        );
        const inviteByEmail = new Map(inviteRows.map((row) => [String(row.email).toLowerCase(), row] as const));

        res.json({
            success: true,
            count: users.length,
            admins: users.map((user) => {
                const invite = inviteByEmail.get(String(user.email).toLowerCase());
                return {
                    ...user,
                    inviteId: invite?.id || null,
                    inviteStatus: invite?.status || null,
                    inviteExpiresAt: invite?.expires_at || null,
                    inviteCreatedAt: invite?.created_at || null,
                };
            })
        });
    } catch (error) {
        console.error('Admin users list error:', error);
        res.status(500).json({ error: 'Failed to list admin users' });
    }
});

// POST /admin/admin-invites - create and send invite
router.post('/admin-invites', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope || !requireSuperadmin(scope, res)) {
            return;
        }

        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : '';
        const requestedPastorName = typeof req.body?.pastorName === 'string' ? req.body.pastorName.trim() : '';
        const fallbackPastorName = email.includes('@') ? email.split('@')[0] : '';
        const pastorName = requestedPastorName || fallbackPastorName || 'Assigned Pastor';
        if (!email || !branch) {
            res.status(400).json({ error: 'email and branch are required' });
            return;
        }

        const branchRows = await executeRawQuery<Array<{ id: string; name: string; slug: string }>>(
            `SELECT id, name, slug
             FROM branches
             WHERE LOWER(slug) = LOWER($1) OR LOWER(name) = LOWER($1)
             LIMIT 1`,
            [branch]
        );
        const matchedBranch = branchRows[0];
        if (!matchedBranch) {
            res.status(400).json({ error: 'Branch not found' });
            return;
        }

        const rawToken = createOpaqueToken();
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

        const rows = await executeRawQuery<Array<{ id: string }>>(
            `INSERT INTO admin_invites (email, branch, role, token_hash, expires_at, status, invited_by_user_id, sent_at)
             VALUES ($1, $2, 'admin', $3, $4::timestamptz, 'pending', $5::uuid, NOW())
             RETURNING id`,
            [email, matchedBranch.slug, tokenHash, expiresAt.toISOString(), req.user!.userId]
        );

        const inviteId = rows[0]?.id;
        const link = `${getAppBaseUrl(req)}/admin-accept-invite.html?token=${encodeURIComponent(rawToken)}`;
        let emailSent = true;
        let emailError: string | null = null;
        try {
            await sendEmail({
                to: email,
                subject: `Branch admin invite - ${matchedBranch.name}`,
                html: buildInviteEmailHtml(link, matchedBranch.name, expiresAt.toISOString())
            });
        } catch (mailError: any) {
            emailSent = false;
            emailError = String(mailError?.message || 'Email delivery failed');
            console.error('Admin invite email send error:', mailError);
        }

        await writeAuditLog({
            actorUserId: req.user!.userId,
            action: 'invite_created',
            metadata: { inviteId, email, pastorName, branch: matchedBranch.slug }
        });
        await writeAuditLog({
            actorUserId: req.user!.userId,
            action: 'invite_sent',
            metadata: { inviteId, email, pastorName, branch: matchedBranch.slug, emailSent, emailError }
        });

        res.status(201).json({
            success: true,
            inviteId,
            email,
            pastorName,
            branch: matchedBranch.slug,
            expiresAt: expiresAt.toISOString(),
            inviteLink: link,
            emailSent,
            warning: emailSent ? undefined : 'Invite created, but email delivery failed. Configure Resend/domain to send externally.'
        });
    } catch (error: any) {
        console.error('Admin invite create error:', error);
        const details = String(error?.message || '');
        res.status(500).json({ error: 'Failed to create invite', details: details || undefined });
    }
});

// POST /admin/admin-invites/:id/resend
router.post('/admin-invites/:id/resend', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope || !requireSuperadmin(scope, res)) {
            return;
        }

        const { id } = req.params;
        const rows = await executeRawQuery<Array<{
            id: string;
            email: string;
            branch: string;
            status: string;
        }>>(
            `SELECT id, email, branch, status
             FROM admin_invites
             WHERE id = $1
             LIMIT 1`,
            [id]
        );
        const invite = rows[0];
        if (!invite) {
            res.status(404).json({ error: 'Invite not found' });
            return;
        }
        if (invite.status === 'accepted') {
            res.status(400).json({ error: 'Cannot resend an accepted invite' });
            return;
        }

        await executeRawQuery(
            `UPDATE admin_invites
             SET status = CASE WHEN status = 'pending' THEN 'expired' ELSE status END,
                 updated_at = NOW()
             WHERE id = $1`,
            [invite.id]
        );

        const rawToken = createOpaqueToken();
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
        const inserted = await executeRawQuery<Array<{ id: string }>>(
            `INSERT INTO admin_invites (email, branch, role, token_hash, expires_at, status, invited_by_user_id, sent_at)
             VALUES ($1, $2, 'admin', $3, $4::timestamptz, 'pending', $5::uuid, NOW())
             RETURNING id`,
            [invite.email, invite.branch, tokenHash, expiresAt.toISOString(), req.user!.userId]
        );
        const newInviteId = inserted[0]?.id;

        const link = `${getAppBaseUrl(req)}/admin-accept-invite.html?token=${encodeURIComponent(rawToken)}`;
        let emailSent = true;
        let emailError: string | null = null;
        try {
            await sendEmail({
                to: invite.email,
                subject: `Branch admin invite reminder - ${invite.branch}`,
                html: buildInviteEmailHtml(link, invite.branch, expiresAt.toISOString())
            });
        } catch (mailError: any) {
            emailSent = false;
            emailError = String(mailError?.message || 'Email delivery failed');
            console.error('Admin invite resend email error:', mailError);
        }

        await writeAuditLog({
            actorUserId: req.user!.userId,
            action: 'invite_resent',
            metadata: { inviteId: newInviteId, replacedInviteId: invite.id, email: invite.email, branch: invite.branch }
        });
        await writeAuditLog({
            actorUserId: req.user!.userId,
            action: 'invite_sent',
            metadata: { inviteId: newInviteId, email: invite.email, branch: invite.branch, emailSent, emailError }
        });

        res.json({
            success: true,
            inviteId: newInviteId,
            email: invite.email,
            branch: invite.branch,
            expiresAt: expiresAt.toISOString(),
            inviteLink: link,
            emailSent,
            warning: emailSent ? undefined : 'Invite recreated, but email delivery failed. Configure Resend/domain to send externally.'
        });
    } catch (error) {
        console.error('Admin invite resend error:', error);
        res.status(500).json({ error: 'Failed to resend invite' });
    }
});

// POST /admin/admin-users/:id/deactivate
router.post('/admin-users/:id/deactivate', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope || !requireSuperadmin(scope, res)) {
            return;
        }

        const { id } = req.params;
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user || user.role !== 'admin') {
            res.status(404).json({ error: 'Admin user not found' });
            return;
        }

        await prisma.user.update({
            where: { id },
            data: { isActive: false }
        });
        await bumpTokenVersion(id);
        await writeAuditLog({
            actorUserId: req.user!.userId,
            action: 'admin_deactivated',
            targetUserId: id,
            metadata: { email: user.email, branch: user.branch }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Admin deactivate error:', error);
        res.status(500).json({ error: 'Failed to deactivate admin' });
    }
});

// POST /admin/admin-users/:id/reactivate
router.post('/admin-users/:id/reactivate', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope || !requireSuperadmin(scope, res)) {
            return;
        }

        const { id } = req.params;
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user || user.role !== 'admin') {
            res.status(404).json({ error: 'Admin user not found' });
            return;
        }

        await prisma.user.update({
            where: { id },
            data: { isActive: true }
        });
        await bumpTokenVersion(id);
        await writeAuditLog({
            actorUserId: req.user!.userId,
            action: 'admin_reactivated',
            targetUserId: id,
            metadata: { email: user.email, branch: user.branch }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Admin reactivate error:', error);
        res.status(500).json({ error: 'Failed to reactivate admin' });
    }
});

// POST /admin/admin-users/:id/reassign-branch
router.post('/admin-users/:id/reassign-branch', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope || !requireSuperadmin(scope, res)) {
            return;
        }

        const { id } = req.params;
        const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : '';
        if (!branch) {
            res.status(400).json({ error: 'branch is required' });
            return;
        }

        const branchRows = await executeRawQuery<Array<{ name: string; slug: string }>>(
            `SELECT name, slug
             FROM branches
             WHERE LOWER(slug) = LOWER($1) OR LOWER(name) = LOWER($1)
             LIMIT 1`,
            [branch]
        );
        const matchedBranch = branchRows[0];
        if (!matchedBranch) {
            res.status(400).json({ error: 'Branch not found' });
            return;
        }

        const user = await prisma.user.findUnique({ where: { id } });
        if (!user || user.role !== 'admin') {
            res.status(404).json({ error: 'Admin user not found' });
            return;
        }

        await prisma.user.update({
            where: { id },
            data: { branch: matchedBranch.slug }
        });
        await bumpTokenVersion(id);

        await writeAuditLog({
            actorUserId: req.user!.userId,
            action: 'admin_branch_reassigned',
            targetUserId: id,
            metadata: { fromBranch: user.branch, toBranch: matchedBranch.slug, email: user.email }
        });

        res.json({ success: true, branch: matchedBranch.slug });
    } catch (error) {
        console.error('Admin reassign branch error:', error);
        res.status(500).json({ error: 'Failed to reassign admin branch' });
    }
});

// POST /admin/admin-users/:id/reset-password
router.post('/admin-users/:id/reset-password', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope || !requireSuperadmin(scope, res)) {
            return;
        }

        const { id } = req.params;
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user || user.role !== 'admin') {
            res.status(404).json({ error: 'Admin user not found' });
            return;
        }

        const rawToken = createOpaqueToken();
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await executeRawQuery(
            `INSERT INTO password_resets (user_id, token_hash, expires_at, status, requested_by, created_by_user_id)
             VALUES ($1::uuid, $2, $3::timestamptz, 'pending', 'superadmin', $4::uuid)`,
            [user.id, tokenHash, expiresAt.toISOString(), req.user!.userId]
        );
        await bumpTokenVersion(user.id);

        const link = `${getAppBaseUrl(req)}/admin-reset-password.html?token=${encodeURIComponent(rawToken)}`;
        await sendEmail({
            to: user.email,
            subject: 'Admin password reset',
            html: buildResetEmailHtml(link, expiresAt.toISOString())
        });

        await writeAuditLog({
            actorUserId: req.user!.userId,
            action: 'password_reset_requested',
            targetUserId: user.id,
            metadata: { requestedBy: 'superadmin', email: user.email }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Admin reset password error:', error);
        res.status(500).json({ error: 'Failed to send reset password link' });
    }
});

export default router;

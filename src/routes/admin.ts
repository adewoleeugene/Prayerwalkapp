import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { executeRawQuery } from '../lib/db';
import { authenticate } from '../middleware/authMiddleware';
import { createOpaqueToken, hashToken } from '../lib/security';
import { buildInviteEmailHtml, buildResetEmailHtml, sendEmail } from '../lib/mail';
import { writeAuditLog } from '../lib/audit';
import { bumpTokenVersion } from '../lib/accountSecurity';
import { hashPassword, isValidPassword, verifyPassword } from '../lib/auth';
import { logger } from '../lib/logger';
import { getAdminScope, isAdminBranchMatch, requireSuperadmin } from '../policies/adminScope';
import { listBranchesRaw, findBranchesByAssignedBranch } from '../repositories/branchRepository';
import { getAppBaseUrl, slugify } from '../validators/admin';
import { DomainError } from '../errors/domainError';
import {
    deactivateAdmin,
    listAdminUsers,
    reactivateAdmin,
    reassignAdminBranch,
    removeAdmin,
    resetAdminPassword,
} from '../services/admin/adminUserService';

const router = Router();

router.use(authenticate);

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
        logger.error('Admin me error:', error);
        res.status(500).json({ error: 'Failed to load admin profile' });
    }
});

// PATCH /admin/me - Update current admin's own profile (name)
router.patch('/me', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope) return;

        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (!name) {
            res.status(400).json({ error: 'name is required' });
            return;
        }

        const updated = await prisma.user.update({
            where: { id: req.user!.userId },
            data: { name },
            select: { id: true, name: true, email: true },
        });

        res.json({ success: true, name: updated.name });
    } catch (error) {
        logger.error('Admin update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
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
        logger.error('Admin change password error:', error);
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
            const rows = await listBranchesRaw();

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

        const rows = await findBranchesByAssignedBranch(scope.branch!);

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
        logger.error('Admin branches list error:', e);
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
        logger.error('Admin branch create error:', e);
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
        logger.error('Admin branch update error:', e);
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
        logger.error('Admin branch delete error:', e);
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

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');

        const admins = await listAdminUsers();

        res.json({
            success: true,
            count: admins.length,
            admins
        });
    } catch (error) {
        logger.error('Admin users list error:', error);
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
            logger.error('Admin invite email send error:', mailError);
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
        logger.error('Admin invite create error:', error);
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
            logger.error('Admin invite resend email error:', mailError);
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
        logger.error('Admin invite resend error:', error);
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
        await deactivateAdmin(id, req.user!.userId);

        res.json({ success: true });
    } catch (error) {
        if (error instanceof DomainError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        logger.error('Admin deactivate error:', error);
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
        await reactivateAdmin(id, req.user!.userId);

        res.json({ success: true });
    } catch (error) {
        if (error instanceof DomainError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        logger.error('Admin reactivate error:', error);
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
        const nextBranch = await reassignAdminBranch(id, branch, req.user!.userId);
        res.json({ success: true, branch: nextBranch });
    } catch (error) {
        if (error instanceof DomainError) {
            res.status(error.statusCode).json({ error: error.message, details: error.details });
            return;
        }
        logger.error('Admin reassign branch error:', error);
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
        await resetAdminPassword(id, req.user!.userId, getAppBaseUrl(req));

        res.json({ success: true });
    } catch (error) {
        if (error instanceof DomainError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        logger.error('Admin reset password error:', error);
        res.status(500).json({ error: 'Failed to send reset password link' });
    }
});

// DELETE /admin/admin-users/:id - permanently remove a branch admin
router.delete('/admin-users/:id', async (req: Request, res: Response) => {
    try {
        const scope = getAdminScope(req, res);
        if (!scope || !requireSuperadmin(scope, res)) {
            return;
        }

        const { id } = req.params;

        // Prevent deleting yourself
        if (id === req.user!.userId) {
            res.status(403).json({ error: 'Cannot delete your own account' });
            return;
        }

        // Prevent deleting the last superadmin
        const targetUser = await prisma.user.findUnique({ where: { id }, select: { role: true } });
        if (targetUser?.role === 'superadmin') {
            const superadminCount = await prisma.user.count({
                where: { role: 'superadmin', isActive: true },
            });
            if (superadminCount <= 1) {
                res.status(403).json({ error: 'Cannot delete the last superadmin' });
                return;
            }
        }

        await removeAdmin(id, req.user!.userId);

        res.json({ success: true });
    } catch (error) {
        if (error instanceof DomainError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        logger.error('Admin delete error:', error);
        res.status(500).json({ error: 'Failed to delete admin user' });
    }
});

export default router;

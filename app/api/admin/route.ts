import { type NextRequest } from 'next/server';
import { prisma, executeRawQuery } from '@/lib/db';
import { requireAuth, handleError } from '@/lib/apiHelpers';
import { getAdminScope } from '@/policies/adminScope';
import { hashPassword, isValidPassword, verifyPassword } from '@/lib/auth';
import { bumpTokenVersion } from '@/lib/accountSecurity';
import { writeAuditLog } from '@/lib/audit';
import { logger } from '@/lib/logger';

// GET /api/admin/me
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sub = searchParams.get('_sub') || 'me';
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope) return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    if (sub === 'stats') {
      if (scope.isSuperadmin) {
        const totalUsers = await prisma.user.count();
        const activeSessions = await prisma.prayerSession.count({ where: { status: 'active' } });
        const completedPrayers = await prisma.completion.count();
        const totalFlags = await prisma.gPSFlag.count();
        return Response.json({ totalUsers, activeSessions, completedPrayers, totalFlags, scope: 'global' });
      }
      const [userRows, activeSessions, completedPrayers, totalFlags] = await Promise.all([
        executeRawQuery<{ total: number }[]>(`SELECT COUNT(DISTINCT user_id)::int AS total FROM prayer_sessions WHERE branch = $1`, [scope.branch]),
        prisma.prayerSession.count({ where: { status: 'active', branch: scope.branch! } }),
        prisma.completion.count({ where: { session: { is: { branch: scope.branch! } } } }),
        prisma.gPSFlag.count({ where: { session: { is: { branch: scope.branch! } } } }),
      ]);
      return Response.json({ totalUsers: Number(userRows[0]?.total || 0), activeSessions, completedPrayers, totalFlags, scope: 'branch', branch: scope.branch });
    }

    if (sub === 'flags') {
      const flags = await prisma.gPSFlag.findMany({
        where: scope.isSuperadmin ? undefined : { session: { is: { branch: scope.branch! } } },
        take: 20, orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true, email: true } }, session: { select: { id: true, trustScore: true, startTime: true } } },
      });
      return Response.json({ flags, scope: scope.isSuperadmin ? 'global' : 'branch', branch: scope.branch });
    }

    if (sub === 'active-walkers') {
      const active = await prisma.prayerSession.findMany({
        where: scope.isSuperadmin ? { status: 'active' } : { status: 'active', branch: scope.branch! },
        select: { id: true, currentLocation: true, trustScore: true, user: { select: { name: true } } },
      });
      const walkers = active.map(s => ({
        id: s.id, userName: s.user.name, location: s.currentLocation ? JSON.parse(s.currentLocation as string) : null, trustScore: s.trustScore,
      })).filter(w => w.location);
      return Response.json({ walkers, scope: scope.isSuperadmin ? 'global' : 'branch', branch: scope.branch });
    }

    if (sub === 'heatmap') {
      const completions = await prisma.completion.findMany({
        where: scope.isSuperadmin ? undefined : { session: { is: { branch: scope.branch! } } },
        select: { completionLocation: true, trustScore: true },
      });
      const points = completions.flatMap(c => {
        if (!c.completionLocation) return [];
        try {
          const loc = JSON.parse(c.completionLocation as string);
          return [{ lat: loc.coordinates[1], lng: loc.coordinates[0], weight: c.trustScore / 100 }];
        } catch { return []; }
      });
      return Response.json({ points, scope: scope.isSuperadmin ? 'global' : 'branch', branch: scope.branch });
    }

    // Default: /api/admin/me
    const user = await prisma.user.findUnique({
      where: { id: authUser.userId },
      select: { id: true, email: true, name: true, role: true, branch: true, lastLogin: true, isActive: true },
    });
    if (!user || !user.isActive) return Response.json({ error: 'Admin account not found' }, { status: 404 });
    return Response.json({ success: true, profile: { id: user.id, email: user.email, name: user.name, role: user.role, branch: user.branch, lastLoginAt: user.lastLogin } });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope) return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

    const updated = await prisma.user.update({
      where: { id: authUser.userId }, data: { name }, select: { id: true, name: true, email: true },
    });
    return Response.json({ success: true, name: updated.name });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope) return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const body = await request.json();
    const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

    if (!currentPassword || !newPassword) return Response.json({ error: 'currentPassword and newPassword are required' }, { status: 400 });

    const passwordValidation = isValidPassword(newPassword);
    if (!passwordValidation.valid) return Response.json({ error: passwordValidation.message || 'Invalid password' }, { status: 400 });

    const user = await prisma.user.findUnique({
      where: { id: authUser.userId },
      select: { id: true, email: true, role: true, passwordHash: true, isActive: true },
    });
    if (!user || !user.isActive || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return Response.json({ error: 'Admin account not found' }, { status: 404 });
    }

    if (!await verifyPassword(currentPassword, user.passwordHash)) return Response.json({ error: 'Current password is incorrect' }, { status: 401 });
    if (await verifyPassword(newPassword, user.passwordHash)) return Response.json({ error: 'New password must be different from current password' }, { status: 400 });

    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
    await bumpTokenVersion(user.id);
    await writeAuditLog({ actorUserId: user.id, action: 'password_changed_by_user', targetUserId: user.id, metadata: { role: user.role, email: user.email } });

    return Response.json({ success: true, message: 'Password updated. Please log in again.' });
  } catch (error) {
    logger.error('Admin change password error:', error);
    return handleError(error);
  }
}

import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, handleError } from '@/lib/apiHelpers';
import { getAdminScope } from '@/policies/adminScope';
import { writeAuditLog } from '@/lib/audit';
import { logger } from '@/lib/logger';

/**
 * DELETE /api/admin/walks
 * Body: { sessionIds: string[] }
 *
 * Bulk-deletes prayer sessions. Cascade deletes GPSEvents, GPSFlags,
 * and RouteCheckpoints automatically (onDelete: Cascade in schema).
 * Completions have sessionId set to null (onDelete: SetNull).
 *
 * Branch admins can only delete walks belonging to their branch.
 * Superadmins can delete any walk.
 */
export async function DELETE(request: NextRequest) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const raw: unknown[] = Array.isArray(body?.sessionIds) ? body.sessionIds : [];
    const sessionIds = raw.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

    if (sessionIds.length === 0) {
      return Response.json({ error: 'sessionIds must be a non-empty array of strings' }, { status: 400 });
    }
    if (sessionIds.length > 500) {
      return Response.json({ error: 'Cannot delete more than 500 walks in a single request' }, { status: 400 });
    }

    // Branch admins may only delete walks within their own branch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { id: { in: sessionIds } };
    if (!scope.isSuperadmin && scope.branch) {
      where.branch = { contains: scope.branch, mode: 'insensitive' };
    }

    const result = await prisma.prayerSession.deleteMany({ where });

    await writeAuditLog({
      actorUserId: authUser.userId,
      action: 'walks_bulk_deleted',
      metadata: {
        requestedCount: sessionIds.length,
        deletedCount: result.count,
        scope: scope.isSuperadmin ? 'global' : scope.branch,
      },
    });

    logger.info(`Admin ${authUser.email} deleted ${result.count} walks (requested ${sessionIds.length})`);
    return Response.json({ success: true, deleted: result.count });
  } catch (error) {
    logger.error('Bulk delete walks error:', error);
    return handleError(error);
  }
}

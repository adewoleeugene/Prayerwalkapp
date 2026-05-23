import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, handleError } from '@/lib/apiHelpers';
import { getAdminScope, requireSuperadmin } from '@/policies/adminScope';
import { removeAdmin } from '@/services/admin/adminUserService';
import { DomainError } from '@/errors/domainError';
import { logger } from '@/lib/logger';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope || !requireSuperadmin(scope)) return Response.json({ error: 'Forbidden: Superadmin access required' }, { status: 403 });

    const { id } = await params;
    if (id === authUser.userId) return Response.json({ error: 'Cannot delete your own account' }, { status: 403 });

    const targetUser = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (targetUser?.role === 'superadmin') {
      const superadminCount = await prisma.user.count({ where: { role: 'superadmin', isActive: true } });
      if (superadminCount <= 1) return Response.json({ error: 'Cannot delete the last superadmin' }, { status: 403 });
    }

    await removeAdmin(id, authUser.userId);
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.statusCode });
    logger.error('Admin delete error:', error);
    return handleError(error);
  }
}

import { type NextRequest } from 'next/server';
import { requireAuth, handleError } from '@/lib/apiHelpers';
import { getAdminScope, requireSuperadmin } from '@/policies/adminScope';
import { listAdminUsers } from '@/services/admin/adminUserService';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope || !requireSuperadmin(scope)) return Response.json({ error: 'Forbidden: Superadmin access required' }, { status: 403 });

    const admins = await listAdminUsers();
    return Response.json({ success: true, count: admins.length, admins }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' },
    });
  } catch (error) {
    logger.error('Admin users list error:', error);
    return handleError(error);
  }
}

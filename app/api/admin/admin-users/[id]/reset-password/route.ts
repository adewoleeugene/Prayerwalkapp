import { type NextRequest } from 'next/server';
import { requireAuth, handleError } from '@/lib/apiHelpers';
import { getAdminScope, requireSuperadmin } from '@/policies/adminScope';
import { resetAdminPassword } from '@/services/admin/adminUserService';
import { getAppBaseUrl } from '@/validators/admin';
import { DomainError } from '@/errors/domainError';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope || !requireSuperadmin(scope)) return Response.json({ error: 'Forbidden: Superadmin access required' }, { status: 403 });
    const { id } = await params;
    await resetAdminPassword(id, authUser.userId, getAppBaseUrl(request));
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.statusCode });
    return handleError(error);
  }
}

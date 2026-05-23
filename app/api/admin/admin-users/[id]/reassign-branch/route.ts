import { type NextRequest } from 'next/server';
import { requireAuth, handleError } from '@/lib/apiHelpers';
import { getAdminScope, requireSuperadmin } from '@/policies/adminScope';
import { reassignAdminBranch } from '@/services/admin/adminUserService';
import { DomainError } from '@/errors/domainError';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope || !requireSuperadmin(scope)) return Response.json({ error: 'Forbidden: Superadmin access required' }, { status: 403 });
    const { id } = await params;
    const body = await request.json();
    const branch = typeof body?.branch === 'string' ? body.branch.trim() : '';
    const nextBranch = await reassignAdminBranch(id, branch, authUser.userId);
    return Response.json({ success: true, branch: nextBranch });
  } catch (error) {
    if (error instanceof DomainError) return Response.json({ error: error.message, details: error.details }, { status: error.statusCode });
    return handleError(error);
  }
}

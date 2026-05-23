import { bumpTokenVersion } from '@/lib/accountSecurity';
import { writeAuditLog } from '@/lib/audit';
import { buildResetEmailHtml, sendEmail } from '@/lib/mail';
import { createOpaqueToken, hashToken } from '@/lib/security';
import {
  deleteAdminUser,
  findAdminById,
  findBranchBySlugOrName,
  insertPasswordReset,
  listAdminUsersRaw,
  setAdminActiveStatus,
  updateAdminBranch,
} from '@/repositories/adminUserRepository';
import { DomainError } from '@/errors/domainError';

export async function listAdminUsers() {
  const { users, inviteRows } = await listAdminUsersRaw();
  const inviteByEmail = new Map(inviteRows.map((row) => [String(row.email).toLowerCase(), row] as const));

  return users.map((user) => {
    const invite = inviteByEmail.get(String(user.email).toLowerCase());
    return {
      ...user,
      inviteId: invite?.id || null,
      inviteStatus: invite?.status || null,
      inviteExpiresAt: invite?.expires_at || null,
      inviteCreatedAt: invite?.created_at || null,
    };
  });
}

export async function deactivateAdmin(id: string, actorUserId: string) {
  const user = await findAdminById(id);
  if (!user || user.role !== 'admin') {
    throw new DomainError('Admin user not found', { statusCode: 404, code: 'admin_not_found' });
  }

  await setAdminActiveStatus(id, false);
  await bumpTokenVersion(id);
  await writeAuditLog({
    actorUserId,
    action: 'admin_deactivated',
    targetUserId: id,
    metadata: { email: user.email, branch: user.branch },
  });
}

export async function reactivateAdmin(id: string, actorUserId: string) {
  const user = await findAdminById(id);
  if (!user || user.role !== 'admin') {
    throw new DomainError('Admin user not found', { statusCode: 404, code: 'admin_not_found' });
  }

  await setAdminActiveStatus(id, true);
  await bumpTokenVersion(id);
  await writeAuditLog({
    actorUserId,
    action: 'admin_reactivated',
    targetUserId: id,
    metadata: { email: user.email, branch: user.branch },
  });
}

export async function reassignAdminBranch(id: string, branchInput: string, actorUserId: string) {
  const branch = branchInput.trim();
  if (!branch) {
    throw new DomainError('branch is required', { statusCode: 400, code: 'branch_required' });
  }

  const matchedBranch = await findBranchBySlugOrName(branch);
  if (!matchedBranch) {
    throw new DomainError('Branch not found', { statusCode: 400, code: 'branch_not_found' });
  }

  const user = await findAdminById(id);
  if (!user || user.role !== 'admin') {
    throw new DomainError('Admin user not found', { statusCode: 404, code: 'admin_not_found' });
  }

  await updateAdminBranch(id, matchedBranch.slug);
  await bumpTokenVersion(id);
  await writeAuditLog({
    actorUserId,
    action: 'admin_branch_reassigned',
    targetUserId: id,
    metadata: { fromBranch: user.branch, toBranch: matchedBranch.slug, email: user.email },
  });

  return matchedBranch.slug;
}

export async function resetAdminPassword(id: string, actorUserId: string, appBaseUrl: string) {
  const user = await findAdminById(id);
  if (!user || user.role !== 'admin') {
    throw new DomainError('Admin user not found', { statusCode: 404, code: 'admin_not_found' });
  }

  const rawToken = createOpaqueToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await insertPasswordReset(user.id, tokenHash, expiresAt.toISOString(), actorUserId);
  await bumpTokenVersion(user.id);

  const link = `${appBaseUrl}/admin-reset-password.html?token=${encodeURIComponent(rawToken)}`;
  await sendEmail({
    to: user.email,
    subject: 'Admin password reset',
    html: buildResetEmailHtml(link, expiresAt.toISOString()),
  });

  await writeAuditLog({
    actorUserId,
    action: 'password_reset_requested',
    targetUserId: user.id,
    metadata: { requestedBy: 'superadmin', email: user.email },
  });
}

export async function removeAdmin(id: string, actorUserId: string) {
  const user = await findAdminById(id);
  if (!user || user.role !== 'admin') {
    throw new DomainError('Admin user not found', { statusCode: 404, code: 'admin_not_found' });
  }

  await bumpTokenVersion(id);
  await deleteAdminUser(id);
  await writeAuditLog({
    actorUserId,
    action: 'admin_deleted',
    metadata: { email: user.email, branch: user.branch },
  });
}

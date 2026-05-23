import { prisma, executeRawQuery } from '@/lib/db';

export async function findAdminById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function listAdminUsersRaw() {
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
    },
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

  return { users, inviteRows };
}

export async function setAdminActiveStatus(id: string, isActive: boolean) {
  return prisma.user.update({
    where: { id },
    data: { isActive },
  });
}

export async function findBranchBySlugOrName(branch: string) {
  const rows = await executeRawQuery<Array<{ name: string; slug: string }>>(
    `SELECT name, slug
     FROM branches
     WHERE LOWER(slug) = LOWER($1) OR LOWER(name) = LOWER($1)
     LIMIT 1`,
    [branch]
  );
  return rows[0] || null;
}

export async function updateAdminBranch(id: string, branch: string) {
  return prisma.user.update({
    where: { id },
    data: { branch },
  });
}

export async function insertPasswordReset(userId: string, tokenHash: string, expiresAtIso: string, actorUserId: string) {
  return executeRawQuery(
    `INSERT INTO password_resets (user_id, token_hash, expires_at, status, requested_by, created_by_user_id)
     VALUES ($1::uuid, $2, $3::timestamptz, 'pending', 'superadmin', $4::uuid)`,
    [userId, tokenHash, expiresAtIso, actorUserId]
  );
}

export async function deleteAdminUser(id: string) {
  return prisma.user.delete({ where: { id } });
}

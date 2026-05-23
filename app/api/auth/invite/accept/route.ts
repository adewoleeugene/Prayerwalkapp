import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { executeRawQuery } from '@/lib/db';
import { hashPassword, isValidPassword, generateToken } from '@/lib/auth';
import { hashToken } from '@/lib/security';
import { bumpTokenVersion, getTokenVersion } from '@/lib/accountSecurity';
import { writeAuditLog } from '@/lib/audit';
import { handleError } from '@/lib/apiHelpers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!token || !name || !password) return Response.json({ error: 'token, name, and password are required' }, { status: 400 });

    const passwordValidation = isValidPassword(password);
    if (!passwordValidation.valid) return Response.json({ error: passwordValidation.message }, { status: 400 });

    const tokenHash = hashToken(token);
    const invites = await executeRawQuery<Array<{ id: string; email: string; branch: string; role: string; expires_at: string; status: string }>>(
      `SELECT id, email, branch, role, expires_at, status FROM admin_invites WHERE token_hash = $1 LIMIT 1`,
      [tokenHash]
    );
    const invite = invites[0];
    if (!invite || invite.status !== 'pending') return Response.json({ error: 'Invalid or used invite token' }, { status: 400 });

    const expiry = new Date(invite.expires_at).getTime();
    if (!Number.isFinite(expiry) || expiry < Date.now()) {
      await executeRawQuery(`UPDATE admin_invites SET status = 'expired', updated_at = NOW() WHERE id = $1::uuid`, [invite.id]);
      return Response.json({ error: 'Invite token expired' }, { status: 400 });
    }

    const normalizedEmail = invite.email.toLowerCase();
    const passwordHash = await hashPassword(password);
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      user = await prisma.user.create({
        data: { email: normalizedEmail, passwordHash, name, role: 'admin', branch: invite.branch, isActive: true },
      });
    } else {
      await prisma.user.update({ where: { id: user.id }, data: { name, passwordHash, role: 'admin', branch: invite.branch, isActive: true } });
      await bumpTokenVersion(user.id);
      user = await prisma.user.findUnique({ where: { id: user.id } });
      if (!user) return Response.json({ error: 'Failed to activate invited account' }, { status: 500 });
    }

    await executeRawQuery(
      `UPDATE admin_invites SET status = 'accepted', accepted_by_user_id = $2::uuid, accepted_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`,
      [invite.id, user.id]
    );
    await writeAuditLog({ actorUserId: user.id, action: 'invite_accepted', targetUserId: user.id, metadata: { email: normalizedEmail, branch: invite.branch, inviteId: invite.id } });

    const tokenVersion = await getTokenVersion(user.id);
    const authToken = generateToken({ userId: user.id, email: user.email, role: user.role, branch: user.branch, tokenVersion });

    return Response.json({ success: true, token: authToken, user: { id: user.id, email: user.email, name: user.name, role: user.role, branch: user.branch } });
  } catch (error) {
    return handleError(error);
  }
}

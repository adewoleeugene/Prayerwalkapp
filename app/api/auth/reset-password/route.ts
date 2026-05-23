import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { executeRawQuery } from '@/lib/db';
import { hashPassword, isValidPassword } from '@/lib/auth';
import { hashToken } from '@/lib/security';
import { writeAuditLog } from '@/lib/audit';
import { bumpTokenVersion } from '@/lib/accountSecurity';
import { handleError } from '@/lib/apiHelpers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!token || !password) return Response.json({ error: 'token and password are required' }, { status: 400 });

    const passwordValidation = isValidPassword(password);
    if (!passwordValidation.valid) return Response.json({ error: passwordValidation.message }, { status: 400 });

    const tokenHash = hashToken(token);
    const rows = await executeRawQuery<Array<{ id: string; user_id: string; expires_at: string; status: string; requested_by: string }>>(
      `SELECT id, user_id, expires_at, status, requested_by FROM password_resets WHERE token_hash = $1 LIMIT 1`,
      [tokenHash]
    );
    const reset = rows[0];
    if (!reset || reset.status !== 'pending') return Response.json({ error: 'Invalid or used reset token' }, { status: 400 });

    const expiresAtMs = new Date(reset.expires_at).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
      await executeRawQuery(`UPDATE password_resets SET status = 'expired', updated_at = NOW() WHERE id = $1`, [reset.id]);
      return Response.json({ error: 'Reset token expired' }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    await prisma.user.update({ where: { id: reset.user_id }, data: { passwordHash } });
    await bumpTokenVersion(reset.user_id);
    await executeRawQuery(`UPDATE password_resets SET status = 'used', used_at = NOW(), updated_at = NOW() WHERE id = $1`, [reset.id]);
    await writeAuditLog({
      actorUserId: reset.user_id,
      action: reset.requested_by === 'superadmin' ? 'password_reset_forced_by_superadmin' : 'password_reset_completed',
      targetUserId: reset.user_id,
      metadata: { resetId: reset.id, requestedBy: reset.requested_by },
    });

    return Response.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    return handleError(error);
  }
}

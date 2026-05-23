import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { executeRawQuery } from '@/lib/db';
import { isValidEmail } from '@/lib/auth';
import { createOpaqueToken, hashToken } from '@/lib/security';
import { buildResetEmailHtml, sendEmail } from '@/lib/mail';
import { writeAuditLog } from '@/lib/audit';
import { getAppBaseUrl } from '@/validators/admin';
import { handleError } from '@/lib/apiHelpers';

const GENERIC = { success: true, message: 'If an account exists, a reset link has been sent.' };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !isValidEmail(email)) return Response.json(GENERIC);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return Response.json(GENERIC);

    const rawToken = createOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await executeRawQuery(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, status, requested_by)
       VALUES ($1, $2, $3::timestamptz, 'pending', 'self')`,
      [user.id, tokenHash, expiresAt.toISOString()]
    );

    const appBase = getAppBaseUrl(request);
    const resetLink = `${appBase}/reset-password?token=${encodeURIComponent(rawToken)}`;
    await sendEmail({ to: user.email, subject: 'Reset your Prayer Walk admin password', html: buildResetEmailHtml(resetLink, expiresAt.toISOString()) });
    await writeAuditLog({ actorUserId: user.id, action: 'password_reset_requested', targetUserId: user.id, metadata: { requestedBy: 'self' } });

    return Response.json(GENERIC);
  } catch (error) {
    return handleError(error);
  }
}

import { type NextRequest } from 'next/server';
import { executeRawQuery } from '@/lib/db';
import { requireAuth, handleError } from '@/lib/apiHelpers';
import { getAdminScope, requireSuperadmin } from '@/policies/adminScope';
import { createOpaqueToken, hashToken } from '@/lib/security';
import { buildInviteEmailHtml, sendEmail } from '@/lib/mail';
import { writeAuditLog } from '@/lib/audit';
import { getAppBaseUrl } from '@/validators/admin';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope || !requireSuperadmin(scope)) return Response.json({ error: 'Forbidden: Superadmin access required' }, { status: 403 });

    const { id } = await params;
    const rows = await executeRawQuery<Array<{ id: string; email: string; branch: string; status: string }>>(
      `SELECT id, email, branch, status FROM admin_invites WHERE id = $1 LIMIT 1`, [id]
    );
    const invite = rows[0];
    if (!invite) return Response.json({ error: 'Invite not found' }, { status: 404 });
    if (invite.status === 'accepted') return Response.json({ error: 'Cannot resend an accepted invite' }, { status: 400 });

    await executeRawQuery(`UPDATE admin_invites SET status = CASE WHEN status = 'pending' THEN 'expired' ELSE status END, updated_at = NOW() WHERE id = $1`, [invite.id]);

    const rawToken = createOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const inserted = await executeRawQuery<Array<{ id: string }>>(
      `INSERT INTO admin_invites (email, branch, role, token_hash, expires_at, status, invited_by_user_id, sent_at)
       VALUES ($1, $2, 'admin', $3, $4::timestamptz, 'pending', $5::uuid, NOW()) RETURNING id`,
      [invite.email, invite.branch, tokenHash, expiresAt.toISOString(), authUser.userId]
    );
    const newInviteId = inserted[0]?.id;
    const link = `${getAppBaseUrl(request)}/accept-invite?token=${encodeURIComponent(rawToken)}`;

    let emailSent = true, emailError: string | null = null;
    try {
      await sendEmail({ to: invite.email, subject: `Branch admin invite reminder - ${invite.branch}`, html: buildInviteEmailHtml(link, invite.branch, expiresAt.toISOString()) });
    } catch (mailError: any) {
      emailSent = false;
      emailError = String(mailError?.message || 'Email delivery failed');
    }

    await writeAuditLog({ actorUserId: authUser.userId, action: 'invite_resent', metadata: { inviteId: newInviteId, replacedInviteId: invite.id, email: invite.email, branch: invite.branch } });

    return Response.json({ success: true, inviteId: newInviteId, email: invite.email, branch: invite.branch, expiresAt: expiresAt.toISOString(), inviteLink: link, emailSent, warning: emailSent ? undefined : 'Invite recreated, but email delivery failed.' });
  } catch (error) {
    logger.error('Admin invite resend error:', error);
    return handleError(error);
  }
}

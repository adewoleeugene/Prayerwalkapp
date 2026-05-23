import { type NextRequest } from 'next/server';
import { executeRawQuery } from '@/lib/db';
import { requireAuth, handleError } from '@/lib/apiHelpers';
import { getAdminScope, requireSuperadmin } from '@/policies/adminScope';
import { createOpaqueToken, hashToken } from '@/lib/security';
import { buildInviteEmailHtml, sendEmail } from '@/lib/mail';
import { writeAuditLog } from '@/lib/audit';
import { getAppBaseUrl } from '@/validators/admin';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const authUser = await requireAuth(request);
    const scope = getAdminScope(authUser);
    if (!scope || !requireSuperadmin(scope)) return Response.json({ error: 'Forbidden: Superadmin access required' }, { status: 403 });

    const body = await request.json();
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const branch = typeof body?.branch === 'string' ? body.branch.trim() : '';
    const requestedPastorName = typeof body?.pastorName === 'string' ? body.pastorName.trim() : '';
    const fallbackPastorName = email.includes('@') ? email.split('@')[0] : '';
    const pastorName = requestedPastorName || fallbackPastorName || 'Assigned Pastor';

    if (!email || !branch) return Response.json({ error: 'email and branch are required' }, { status: 400 });

    const branchRows = await executeRawQuery<Array<{ id: string; name: string; slug: string }>>(
      `SELECT id, name, slug FROM branches WHERE LOWER(slug) = LOWER($1) OR LOWER(name) = LOWER($1) LIMIT 1`, [branch]
    );
    const matchedBranch = branchRows[0];
    if (!matchedBranch) return Response.json({ error: 'Branch not found' }, { status: 400 });

    const rawToken = createOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const rows = await executeRawQuery<Array<{ id: string }>>(
      `INSERT INTO admin_invites (email, branch, role, token_hash, expires_at, status, invited_by_user_id, sent_at)
       VALUES ($1, $2, 'admin', $3, $4::timestamptz, 'pending', $5::uuid, NOW()) RETURNING id`,
      [email, matchedBranch.slug, tokenHash, expiresAt.toISOString(), authUser.userId]
    );
    const inviteId = rows[0]?.id;
    const link = `${getAppBaseUrl(request)}/accept-invite?token=${encodeURIComponent(rawToken)}`;

    let emailSent = true, emailError: string | null = null;
    try {
      await sendEmail({ to: email, subject: `Branch admin invite - ${matchedBranch.name}`, html: buildInviteEmailHtml(link, matchedBranch.name, expiresAt.toISOString()) });
    } catch (mailError: any) {
      emailSent = false;
      emailError = String(mailError?.message || 'Email delivery failed');
      logger.error('Admin invite email send error:', mailError);
    }

    await writeAuditLog({ actorUserId: authUser.userId, action: 'invite_created', metadata: { inviteId, email, pastorName, branch: matchedBranch.slug } });
    await writeAuditLog({ actorUserId: authUser.userId, action: 'invite_sent', metadata: { inviteId, email, pastorName, branch: matchedBranch.slug, emailSent, emailError } });

    return Response.json({
      success: true, inviteId, email, pastorName, branch: matchedBranch.slug, expiresAt: expiresAt.toISOString(), inviteLink: link, emailSent,
      warning: emailSent ? undefined : 'Invite created, but email delivery failed.',
    }, { status: 201 });
  } catch (error: any) {
    logger.error('Admin invite create error:', error);
    return handleError(error);
  }
}

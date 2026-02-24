const RESEND_API_URL = 'https://api.resend.com/emails';

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY || '';
  const from = process.env.EMAIL_FROM || 'Prayer Walk <noreply@updates.example.com>';

  if (!apiKey) {
    console.warn('RESEND_API_KEY not set. Email delivery skipped.', { to: params.to, subject: params.subject });
    return;
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend failed (${res.status}): ${body}`);
  }
}

export function buildInviteEmailHtml(link: string, branch: string, expiresAtISO: string): string {
  const safeLink = escapeHtml(link);
  const safeBranch = escapeHtml(branch);
  const safeExpiry = escapeHtml(new Date(expiresAtISO).toLocaleString());
  return `
    <h2>You're invited as a Branch Admin</h2>
    <p>You have been assigned to branch: <strong>${safeBranch}</strong>.</p>
    <p>Set your password using this one-time link:</p>
    <p><a href="${safeLink}">${safeLink}</a></p>
    <p>This link expires on ${safeExpiry}.</p>
  `;
}

export function buildResetEmailHtml(link: string, expiresAtISO: string): string {
  const safeLink = escapeHtml(link);
  const safeExpiry = escapeHtml(new Date(expiresAtISO).toLocaleString());
  return `
    <h2>Password Reset Request</h2>
    <p>Use this one-time link to set a new password:</p>
    <p><a href="${safeLink}">${safeLink}</a></p>
    <p>This link expires on ${safeExpiry}.</p>
    <p>If you did not request this, you can ignore this email.</p>
  `;
}

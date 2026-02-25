import nodemailer from 'nodemailer';

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createTransporter() {
  const gmailUser = process.env.GMAIL_USER || '';
  const gmailPass = process.env.GMAIL_APP_PASSWORD || '';

  if (!gmailUser || !gmailPass) {
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
  });
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const transporter = createTransporter();
  const fromAddress = process.env.EMAIL_FROM || `Prayer Walk <${process.env.GMAIL_USER}>`;

  if (!transporter) {
    console.warn('GMAIL_USER or GMAIL_APP_PASSWORD not set. Email delivery skipped.', {
      to: params.to,
      subject: params.subject,
    });
    return;
  }

  await transporter.sendMail({
    from: fromAddress,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
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

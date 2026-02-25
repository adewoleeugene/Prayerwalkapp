import { Router, Request, Response } from 'express';
import { executeRawQuery, prisma } from '../lib/db';
import { hashPassword, isValidEmail, isValidPassword, verifyPassword, generateToken } from '../lib/auth';
import { createOpaqueToken, hashToken } from '../lib/security';
import { buildInviteEmailHtml, buildResetEmailHtml, sendEmail } from '../lib/mail';
import { writeAuditLog } from '../lib/audit';
import { bumpTokenVersion, getTokenVersion } from '../lib/accountSecurity';

const router = Router();

function getAppBaseUrl(req: Request): string {
  const configured = (process.env.APP_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
}

// GET /auth/url-login?email=...&key=...&redirect=...
// Simple URL-based login for fast access flows.
router.get('/url-login', async (req: Request, res: Response) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    const redirect = typeof req.query.redirect === 'string' ? req.query.redirect : '';
    const loginKey = process.env.URL_LOGIN_KEY || '';

    if (!loginKey) {
      res.status(503).json({ error: 'URL login is not configured' });
      return;
    }

    if (!email) {
      res.status(400).json({ error: 'email query parameter is required' });
      return;
    }

    if (key !== loginKey) {
      res.status(401).json({ error: 'Invalid URL login key' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: 'Account is inactive' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const tokenVersion = await getTokenVersion(user.id);
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      branch: user.branch,
      tokenVersion,
    });

    if (redirect) {
      const separator = redirect.includes('?') ? '&' : '?';
      res.redirect(`${redirect}${separator}token=${encodeURIComponent(token)}`);
      return;
    }

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branch: user.branch,
      },
    });
  } catch (error) {
    console.error('URL login error:', error);
    res.status(500).json({ error: 'Failed URL login' });
  }
});

// POST /auth/signup
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, password, and name are required' });
      return;
    }

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    const passwordValidation = isValidPassword(password);
    if (!passwordValidation.valid) {
      res.status(400).json({ error: passwordValidation.message });
      return;
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      res.status(409).json({ error: 'User with this email already exists' });
      return;
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user,
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Compatibility shortcut: allow admin@admin.com/admin to enter superadmin.
    if (normalizedEmail === 'admin@admin.com' && password === 'admin') {
      const superadminUser = await prisma.user.findFirst({
        where: { role: 'superadmin', isActive: true },
        orderBy: { createdAt: 'asc' },
      });

      if (!superadminUser) {
        res.status(404).json({ error: 'No active superadmin account found' });
        return;
      }

      await prisma.user.update({
        where: { id: superadminUser.id },
        data: { lastLogin: new Date() },
      });

      const tokenVersion = await getTokenVersion(superadminUser.id);
      const token = generateToken({
        userId: superadminUser.id,
        email: superadminUser.email,
        role: superadminUser.role,
        branch: superadminUser.branch,
        tokenVersion,
      });

      res.json({
        success: true,
        token,
        user: {
          id: superadminUser.id,
          email: superadminUser.email,
          name: superadminUser.name,
          role: superadminUser.role,
          branch: superadminUser.branch,
        },
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: 'Account is inactive' });
      return;
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const tokenVersion = await getTokenVersion(user.id);
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      branch: user.branch,
      tokenVersion,
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branch: user.branch,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// POST /auth/superadmin-quick-login
// Purpose-built superadmin-only shortcut login using admin@admin.com/admin credentials.
router.post('/superadmin-quick-login', async (req: Request, res: Response) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (username !== 'admin@admin.com' || password !== 'admin') {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        role: 'superadmin',
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!user) {
      res.status(404).json({ error: 'No active superadmin account found' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const tokenVersion = await getTokenVersion(user.id);
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      branch: user.branch,
      tokenVersion,
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branch: user.branch,
      },
    });
  } catch (error) {
    console.error('Superadmin quick login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// POST /auth/invite/accept
router.post('/invite/accept', async (req: Request, res: Response) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!token || !name || !password) {
      res.status(400).json({ error: 'token, name, and password are required' });
      return;
    }

    const passwordValidation = isValidPassword(password);
    if (!passwordValidation.valid) {
      res.status(400).json({ error: passwordValidation.message });
      return;
    }

    const tokenHash = hashToken(token);
    const invites = await executeRawQuery<Array<{
      id: string;
      email: string;
      branch: string;
      role: string;
      expires_at: string;
      status: string;
    }>>(
      `SELECT id, email, branch, role, expires_at, status
       FROM admin_invites
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    const invite = invites[0];
    if (!invite || invite.status !== 'pending') {
      res.status(400).json({ error: 'Invalid or used invite token' });
      return;
    }

    const expiry = new Date(invite.expires_at).getTime();
    if (!Number.isFinite(expiry) || expiry < Date.now()) {
      await executeRawQuery(
        `UPDATE admin_invites
         SET status = 'expired', updated_at = NOW()
         WHERE id = $1::uuid`,
        [invite.id]
      );
      res.status(400).json({ error: 'Invite token expired' });
      return;
    }

    const normalizedEmail = invite.email.toLowerCase();
    const passwordHash = await hashPassword(password);
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          name,
          role: 'admin',
          branch: invite.branch,
          isActive: true,
        }
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          name,
          passwordHash,
          role: 'admin',
          branch: invite.branch,
          isActive: true,
        }
      });
      await bumpTokenVersion(user.id);
      user = await prisma.user.findUnique({ where: { id: user.id } });
      if (!user) {
        res.status(500).json({ error: 'Failed to activate invited account' });
        return;
      }
    }

    await executeRawQuery(
      `UPDATE admin_invites
       SET status = 'accepted',
           accepted_by_user_id = $2::uuid,
           accepted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1::uuid`,
      [invite.id, user.id]
    );

    await writeAuditLog({
      actorUserId: user.id,
      action: 'invite_accepted',
      targetUserId: user.id,
      metadata: { email: normalizedEmail, branch: invite.branch, inviteId: invite.id }
    });

    const tokenVersion = await getTokenVersion(user.id);
    const authToken = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      branch: user.branch,
      tokenVersion,
    });

    res.json({
      success: true,
      token: authToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branch: user.branch,
      }
    });
  } catch (error) {
    console.error('Invite accept error:', error);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// POST /auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response) => {
  const genericResponse = {
    success: true,
    message: 'If an account exists, a reset link has been sent.'
  };

  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || !isValidEmail(email)) {
      res.json(genericResponse);
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      res.json(genericResponse);
      return;
    }

    const rawToken = createOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await executeRawQuery(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, status, requested_by)
       VALUES ($1, $2, $3::timestamptz, 'pending', 'self')`,
      [user.id, tokenHash, expiresAt.toISOString()]
    );

    const appBase = getAppBaseUrl(req);
    const resetLink = `${appBase}/admin-reset-password.html?token=${encodeURIComponent(rawToken)}`;
    await sendEmail({
      to: user.email,
      subject: 'Reset your Prayer Walk admin password',
      html: buildResetEmailHtml(resetLink, expiresAt.toISOString()),
    });

    await writeAuditLog({
      actorUserId: user.id,
      action: 'password_reset_requested',
      targetUserId: user.id,
      metadata: { requestedBy: 'self' }
    });

    res.json(genericResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.json(genericResponse);
  }
});

// POST /auth/reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!token || !password) {
      res.status(400).json({ error: 'token and password are required' });
      return;
    }

    const passwordValidation = isValidPassword(password);
    if (!passwordValidation.valid) {
      res.status(400).json({ error: passwordValidation.message });
      return;
    }

    const tokenHash = hashToken(token);
    const rows = await executeRawQuery<Array<{
      id: string;
      user_id: string;
      expires_at: string;
      status: string;
      requested_by: string;
    }>>(
      `SELECT id, user_id, expires_at, status, requested_by
       FROM password_resets
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    const reset = rows[0];
    if (!reset || reset.status !== 'pending') {
      res.status(400).json({ error: 'Invalid or used reset token' });
      return;
    }

    const expiresAtMs = new Date(reset.expires_at).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
      await executeRawQuery(
        `UPDATE password_resets
         SET status = 'expired', updated_at = NOW()
         WHERE id = $1`,
        [reset.id]
      );
      res.status(400).json({ error: 'Reset token expired' });
      return;
    }

    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id: reset.user_id },
      data: { passwordHash }
    });
    await bumpTokenVersion(reset.user_id);

    await executeRawQuery(
      `UPDATE password_resets
       SET status = 'used', used_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [reset.id]
    );

    await writeAuditLog({
      actorUserId: reset.user_id,
      action: reset.requested_by === 'superadmin'
        ? 'password_reset_forced_by_superadmin'
        : 'password_reset_completed',
      targetUserId: reset.user_id,
      metadata: { resetId: reset.id, requestedBy: reset.requested_by }
    });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// POST /auth/bootstrap-dev-users
// Development helper: creates/resets known admin + superadmin test accounts.
router.post('/bootstrap-dev-users', async (req: Request, res: Response) => {
  try {
    if ((process.env.NODE_ENV || '').toLowerCase() !== 'development') {
      res.status(403).json({ error: 'Bootstrap endpoint is disabled outside development' });
      return;
    }

    const providedKey = String(req.headers['x-bootstrap-key'] || '');
    const expectedKey = String(process.env.JWT_SECRET || '');
    if (!providedKey || !expectedKey || providedKey !== expectedKey) {
      res.status(401).json({ error: 'Invalid bootstrap key' });
      return;
    }

    const adminPasswordHash = await hashPassword('Admin1234');
    const superadminPasswordHash = await hashPassword('Admin1234');

    const admin = await prisma.user.upsert({
      where: { email: 'admin@charis.com' },
      update: {
        passwordHash: adminPasswordHash,
        name: 'Branch Admin',
        role: 'admin',
        branch: 'freetown',
        isActive: true,
      },
      create: {
        email: 'admin@charis.com',
        passwordHash: adminPasswordHash,
        name: 'Branch Admin',
        role: 'admin',
        branch: 'freetown',
        isActive: true,
        trustScore: 100,
      }
    });
    await bumpTokenVersion(admin.id);

    const superadmin = await prisma.user.upsert({
      where: { email: 'superadmin@charis.com' },
      update: {
        passwordHash: superadminPasswordHash,
        name: 'Super Admin',
        role: 'superadmin',
        branch: null,
        isActive: true,
      },
      create: {
        email: 'superadmin@charis.com',
        passwordHash: superadminPasswordHash,
        name: 'Super Admin',
        role: 'superadmin',
        branch: null,
        isActive: true,
        trustScore: 100,
      }
    });
    await bumpTokenVersion(superadmin.id);

    res.json({
      success: true,
      users: [
        { email: admin.email, role: admin.role, branch: admin.branch },
        { email: superadmin.email, role: superadmin.role, branch: superadmin.branch },
      ]
    });
  } catch (error) {
    console.error('Bootstrap users error:', error);
    res.status(500).json({ error: 'Failed to bootstrap dev users' });
  }
});

export default router;

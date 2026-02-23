import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { hashPassword, isValidEmail, isValidPassword, verifyPassword, generateToken } from '../lib/auth';

const router = Router();

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

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      branch: user.branch,
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

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
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

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      branch: user.branch,
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

export default router;

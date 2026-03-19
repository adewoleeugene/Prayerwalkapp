import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db';
import { hashPassword } from '../lib/auth';
import crypto from 'crypto';

/**
 * Device-based authentication middleware for mobile app.
 * No login required — identifies users by device fingerprint.
 *
 * - If x-device-fingerprint header is present, finds or creates an anonymous user
 * - Sets req.user with role='user' so walk routes work unchanged
 * - Falls back to 401 if no fingerprint provided
 */
export async function deviceAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const fingerprint = typeof req.headers['x-device-fingerprint'] === 'string'
      ? req.headers['x-device-fingerprint'].trim()
      : '';

    if (!fingerprint || fingerprint.length < 4) {
      res.status(401).json({ error: 'Device fingerprint required' });
      return;
    }

    // Look for existing anonymous user by email pattern: device_<fingerprint>@anonymous.local
    const deviceEmail = `device_${fingerprint}@anonymous.local`;

    let user = await prisma.user.findUnique({
      where: { email: deviceEmail },
      select: { id: true, email: true, role: true, branch: true, isActive: true },
    });

    if (!user) {
      // Auto-create anonymous user for this device
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await hashPassword(randomPassword);

      user = await prisma.user.create({
        data: {
          email: deviceEmail,
          passwordHash,
          name: `Walker ${fingerprint.substring(0, 6)}`,
          role: 'user',
          branch: null,
          isActive: true,
        },
        select: { id: true, email: true, role: true, branch: true, isActive: true },
      });
    }

    if (!user.isActive) {
      res.status(403).json({ error: 'Device is blocked' });
      return;
    }

    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role,
      branch: user.branch,
    };

    next();
  } catch (error) {
    console.error('Device auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

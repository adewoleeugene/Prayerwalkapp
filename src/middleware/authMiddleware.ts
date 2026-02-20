import { Request, Response, NextFunction } from 'express';
import { verifyToken, extractToken } from '../lib/auth';
import { ensureGuestUser } from '../lib/guestAuth';

declare global {
    namespace Express {
        interface Request {
            user?: {
                userId: string;
                email: string;
            };
        }
    }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
    const token = extractToken(req.headers.authorization || null);

    try {
        // BYPASS FOR GUEST ACCESS (Removes Mandatory Login)
        if (token === 'bypass-token') {
            const fingerprintHeader = req.headers['x-device-fingerprint'];
            const fingerprint = Array.isArray(fingerprintHeader) ? fingerprintHeader[0] : fingerprintHeader;
            const guestUser = await ensureGuestUser(fingerprint);

            req.user = {
                userId: guestUser.id,
                email: guestUser.email
            };
            return next();
        }

        if (!token) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }

        const payload = verifyToken(token);

        if (!payload) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }

        req.user = payload;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
}

import { Request, Response, NextFunction } from 'express';
import { verifyToken, extractToken } from '../lib/auth';
import { ensureGuestUser } from '../lib/guestAuth';
import { executeRawQuery, prisma } from '../lib/db';

declare global {
    namespace Express {
        interface Request {
            user?: {
                userId: string;
                email: string;
                role: string;
                branch: string | null;
                tokenVersion?: number;
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
                email: guestUser.email,
                role: guestUser.role || 'user',
                branch: guestUser.branch || null
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

        const user = await prisma.user.findUnique({
            where: { id: payload.userId },
            select: {
                id: true,
                email: true,
                role: true,
                branch: true,
                isActive: true,
            }
        });

        if (!user || !user.isActive) {
            res.status(401).json({ error: 'Invalid or inactive account' });
            return;
        }

        const tokenVersionRows = await executeRawQuery<Array<{ token_version: number | null }>>(
            'SELECT COALESCE(token_version, 0) AS token_version FROM users WHERE id = $1::uuid LIMIT 1',
            [user.id]
        );
        const tokenVersion = Number(tokenVersionRows[0]?.token_version ?? 0);
        if (tokenVersion !== Number(payload.tokenVersion ?? 0)) {
            res.status(401).json({ error: 'Session expired. Please log in again.' });
            return;
        }

        req.user = {
            userId: user.id,
            email: user.email,
            role: user.role,
            branch: user.branch,
            tokenVersion,
        };
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
}

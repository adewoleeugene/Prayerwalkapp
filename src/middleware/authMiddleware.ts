import { Request, Response, NextFunction } from 'express';
import { verifyToken, extractToken } from '../lib/auth';

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

export function authenticate(req: Request, res: Response, next: NextFunction) {
    const token = extractToken(req.headers.authorization || null);

    // BYPASS FOR GUEST ACCESS (Removes Mandatory Login)
    if (token === 'bypass-token') {
        req.user = {
            userId: '00000000-0000-0000-0000-000000000000',
            email: 'guest@charis.com'
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
}

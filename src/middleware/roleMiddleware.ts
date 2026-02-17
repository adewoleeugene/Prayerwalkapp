import { Request, Response, NextFunction } from 'express';

export function authorizeRole(roles: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const userRole = (req.user as any).role || 'user';

        // For bypass-token, we might want to allow it for testing, 
        // but normally role comes from DB or token.
        // My simplified bypass guest is a 'user'.

        if (!roles.includes(userRole)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
        }

        next();
    };
}

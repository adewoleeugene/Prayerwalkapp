import { Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { deviceAuth } from './deviceAuthMiddleware';
import { extractToken } from '../lib/auth';

/**
 * Flexible auth middleware that accepts either:
 * 1. Bearer token (admin dashboard) — delegates to `authenticate`
 * 2. Device fingerprint (mobile app) — delegates to `deviceAuth`
 *
 * Checks for a Bearer token first; if present, uses token auth.
 * Otherwise falls back to device fingerprint auth.
 */
export async function flexAuth(req: Request, res: Response, next: NextFunction) {
    const token = extractToken(req.headers.authorization || null);

    if (token) {
        return authenticate(req, res, next);
    }

    return deviceAuth(req, res, next);
}

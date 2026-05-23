import { type NextRequest } from 'next/server';
import { prisma, executeRawQuery } from '@/lib/db';
import { verifyToken, extractToken, hashPassword } from '@/lib/auth';
import { isDomainError } from '@/errors/domainError';
import crypto from 'crypto';

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
  branch: string | null;
  tokenVersion?: number;
}

export async function requireAuth(request: NextRequest): Promise<AuthUser> {
  const token = extractToken(request.headers.get('authorization'));
  if (!token) throw new AuthError('Authentication required', 401);

  const payload = verifyToken(token);
  if (!payload) throw new AuthError('Invalid or expired token', 401);

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, role: true, branch: true, isActive: true },
  });
  if (!user || !user.isActive) throw new AuthError('Invalid or inactive account', 401);

  const tokenVersionRows = await executeRawQuery<Array<{ token_version: number | null }>>(
    'SELECT COALESCE(token_version, 0) AS token_version FROM users WHERE id = $1::uuid LIMIT 1',
    [user.id]
  );
  const tokenVersion = Number(tokenVersionRows[0]?.token_version ?? 0);
  if (tokenVersion !== Number(payload.tokenVersion ?? 0)) {
    throw new AuthError('Session expired. Please log in again.', 401);
  }

  return { userId: user.id, email: user.email, role: user.role, branch: user.branch, tokenVersion };
}

export async function requireDeviceAuth(request: NextRequest): Promise<AuthUser> {
  const fingerprint = (request.headers.get('x-device-fingerprint') || '').trim();
  if (!fingerprint || fingerprint.length < 4) throw new AuthError('Device fingerprint required', 401);

  const deviceEmail = `device_${fingerprint}@anonymous.local`;
  let user = await prisma.user.findUnique({
    where: { email: deviceEmail },
    select: { id: true, email: true, role: true, branch: true, isActive: true },
  });

  if (!user) {
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await hashPassword(randomPassword);
    user = await prisma.user.create({
      data: {
        email: deviceEmail, passwordHash,
        name: `Walker ${fingerprint.substring(0, 6)}`,
        role: 'user', branch: null, isActive: true,
      },
      select: { id: true, email: true, role: true, branch: true, isActive: true },
    });
  }

  if (!user.isActive) throw new AuthError('Device is blocked', 403);
  return { userId: user.id, email: user.email, role: user.role, branch: user.branch };
}

export async function flexAuth(request: NextRequest): Promise<AuthUser> {
  const token = extractToken(request.headers.get('authorization'));
  if (token) return requireAuth(request);
  return requireDeviceAuth(request);
}

export function handleError(error: unknown): Response {
  if (isDomainError(error)) {
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
  }
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error('Unhandled route error:', error);
  return Response.json({ error: 'Internal server error' }, { status: 500 });
}

class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

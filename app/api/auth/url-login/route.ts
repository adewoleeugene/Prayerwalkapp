import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { generateToken } from '@/lib/auth';
import { getTokenVersion } from '@/lib/accountSecurity';
import { handleError } from '@/lib/apiHelpers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = (searchParams.get('email') || '').trim().toLowerCase();
    const key = searchParams.get('key') || '';
    const redirect = searchParams.get('redirect') || '';
    const loginKey = process.env.URL_LOGIN_KEY || '';

    if (!loginKey) return Response.json({ error: 'URL login is not configured' }, { status: 503 });
    if (!email) return Response.json({ error: 'email query parameter is required' }, { status: 400 });
    if (key !== loginKey) return Response.json({ error: 'Invalid URL login key' }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return Response.json({ error: 'User not found' }, { status: 404 });
    if (!user.isActive) return Response.json({ error: 'Account is inactive' }, { status: 403 });

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    const tokenVersion = await getTokenVersion(user.id);
    const token = generateToken({ userId: user.id, email: user.email, role: user.role, branch: user.branch, tokenVersion });

    if (redirect) {
      const safeRedirect = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/';
      const separator = safeRedirect.includes('?') ? '&' : '?';
      return Response.redirect(new URL(`${safeRedirect}${separator}token=${encodeURIComponent(token)}`, request.url));
    }

    return Response.json({ success: true, token, user: { id: user.id, email: user.email, name: user.name, role: user.role, branch: user.branch } });
  } catch (error) {
    return handleError(error);
  }
}

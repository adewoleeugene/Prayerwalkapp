import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword, isValidEmail, isValidPassword } from '@/lib/auth';
import { handleError } from '@/lib/apiHelpers';

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password || !name) {
      return Response.json({ error: 'Email, password, and name are required' }, { status: 400 });
    }
    if (!isValidEmail(email)) return Response.json({ error: 'Invalid email format' }, { status: 400 });

    const passwordValidation = isValidPassword(password);
    if (!passwordValidation.valid) return Response.json({ error: passwordValidation.message }, { status: 400 });

    const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existingUser) return Response.json({ error: 'User with this email already exists' }, { status: 409 });

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email: email.toLowerCase(), passwordHash, name },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    return Response.json({ success: true, message: 'User created successfully', user }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

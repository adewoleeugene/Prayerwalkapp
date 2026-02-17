import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export async function POST(request: NextRequest) {
    try {
        const { name, branch, role = 'member' } = await request.json();

        // Get user from token
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json(
                { error: 'Authentication required' },
                { status: 401 }
            );
        }

        const token = authHeader.substring(7);
        const payload = verifyToken(token);

        if (!payload) {
            return NextResponse.json(
                { error: 'Invalid token' },
                { status: 401 }
            );
        }

        // Validate input
        if (!name || !branch) {
            return NextResponse.json(
                { error: 'Name and branch are required' },
                { status: 400 }
            );
        }

        // Update user
        const user = await prisma.user.update({
            where: { id: payload.userId },
            data: {
                name,
                branch,
                role,
            },
        });

        return NextResponse.json({
            success: true,
            user: {
                id: user.id,
                phone: user.phone,
                name: user.name,
                branch: user.branch,
                role: user.role,
            },
        }, { status: 201 });
    } catch (error) {
        console.error('Registration error:', error);
        return NextResponse.json(
            { error: 'Failed to complete registration' },
            { status: 500 }
        );
    }
}

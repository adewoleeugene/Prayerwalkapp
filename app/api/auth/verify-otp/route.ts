import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateToken } from '@/lib/jwt';

export async function POST(request: NextRequest) {
    try {
        const { phone, otp } = await request.json();

        if (!phone || !otp) {
            return NextResponse.json(
                { error: 'Phone and OTP are required' },
                { status: 400 }
            );
        }

        // Find user with matching phone and OTP
        const user = await prisma.user.findUnique({
            where: { phone },
        });

        if (!user) {
            return NextResponse.json(
                { error: 'User not found' },
                { status: 404 }
            );
        }

        // Verify OTP
        if (user.otpCode !== otp) {
            return NextResponse.json(
                { error: 'Invalid OTP' },
                { status: 400 }
            );
        }

        // Check if OTP is expired
        if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
            return NextResponse.json(
                { error: 'OTP has expired' },
                { status: 400 }
            );
        }

        // Update user's last login and clear OTP
        await prisma.user.update({
            where: { id: user.id },
            data: {
                lastLogin: new Date(),
                otpCode: null,
                otpExpiresAt: null,
            },
        });

        // Generate JWT token
        const token = generateToken({
            userId: user.id,
            phone: user.phone,
            role: user.role,
        });

        // Check if user needs to complete registration
        const needsRegistration = !user.name || !user.branch;

        return NextResponse.json({
            success: true,
            token,
            needsRegistration,
            user: {
                id: user.id,
                phone: user.phone,
                name: user.name,
                branch: user.branch,
                role: user.role,
            },
        });
    } catch (error) {
        console.error('OTP verification error:', error);
        return NextResponse.json(
            { error: 'Failed to verify OTP' },
            { status: 500 }
        );
    }
}

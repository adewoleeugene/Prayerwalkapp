
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearActiveSessions() {
    try {
        const result = await prisma.prayerSession.updateMany({
            where: {
                userId: '00000000-0000-0000-0000-000000000000',
                status: 'active'
            },
            data: {
                status: 'cancelled',
                endTime: new Date()
            }
        });
        console.log(`Cleared ${result.count} active sessions for Guest User.`);
    } catch (e) {
        console.error('Error clearing sessions:', e);
    } finally {
        await prisma.$disconnect();
    }
}

clearActiveSessions();

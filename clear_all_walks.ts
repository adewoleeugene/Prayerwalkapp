import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearWalks() {
    try {
        console.log('Clearing all walks (PrayerSessions)...');

        // This will cascade delete GPSEvents, Flags, Checkpoints
        const sessionCount = await prisma.prayerSession.deleteMany({});
        console.log(`Deleted ${sessionCount.count} sessions.`);

        // Optional: clear completions and badges to fully reset history
        const completionsCount = await prisma.completion.deleteMany({});
        console.log(`Deleted ${completionsCount.count} completions.`);

    } catch (e) {
        console.error('Error clearing walks:', e);
    } finally {
        await prisma.$disconnect();
    }
}

clearWalks();

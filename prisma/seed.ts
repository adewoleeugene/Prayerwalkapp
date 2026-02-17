import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding database...');

    // 1. Create Guest User
    const guestUser = await prisma.user.upsert({
        where: { id: '00000000-0000-0000-0000-000000000000' },
        update: {},
        create: {
            id: '00000000-0000-0000-0000-000000000000',
            email: 'guest@charis.com',
            passwordHash: 'bypass',
            name: 'Guest User',
            role: 'admin', // Give admin role for testing
            trustScore: 100,
            isActive: true,
        },
    });
    console.log('Guest user created/verified');

    // 2. Create Initial Prayer Locations (e.g. London & NYC)
    const locations = [
        {
            name: "St. Paul's Cathedral Area",
            description: "A walk around the historic cathedral for peace in the city.",
            location: JSON.stringify({ type: 'Point', coordinates: [-0.0984, 51.5138] }),
            prayerText: "Lord, we pray for the leaders and citizens of this city...",
            category: "City Peace",
            points: 50,
        },
        {
            name: "Central Park Walk",
            description: "A prayer walk for spiritual renewal.",
            location: JSON.stringify({ type: 'Point', coordinates: [-73.9654, 40.7829] }),
            prayerText: "Heavenly Father, as we walk through this park...",
            category: "Renewal",
            points: 40,
        }
    ];

    for (const loc of locations) {
        await prisma.prayerLocation.create({
            data: loc
        });
    }

    console.log('Initial locations seeded');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

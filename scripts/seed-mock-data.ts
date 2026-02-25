import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const branches = ['International', 'Harlow', 'London', 'Lagos', 'Houston'];
const names = ['Eugene Adewole', 'Alice Smith', 'John Doe', 'Sarah Connor', 'Michael Scott'];
const summaries = [
    'Prayed for the peace of the city.',
    'Focused on healing and restoration.',
    'Walked around the local hospital, praying for patients.',
    'Praying for revival in our schools and universities.',
    'General thanksgiving and worship walk.',
    'Declaring God\'s protection over the neighborhood.'
];

function randomDate(start: Date, end: Date) {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

// Generate a random path around a center point
function generatePath(centerLat: number, centerLng: number, numPoints: number) {
    const points = [];
    let curLat = centerLat;
    let curLng = centerLng;
    for (let i = 0; i < numPoints; i++) {
        points.push({
            latitude: curLat,
            longitude: curLng,
        });
        // small random step roughly 10-30 meters
        curLat += (Math.random() - 0.5) * 0.001;
        curLng += (Math.random() - 0.5) * 0.001;
    }
    return points;
}

// Center points for branches roughly
const centerPoints: Record<string, [number, number]> = {
    'International': [51.5072, -0.1276],
    'Harlow': [51.7770, 0.1017],
    'London': [51.5154, -0.1043],
    'Lagos': [6.5244, 3.3792],
    'Houston': [29.7604, -95.3698]
};

async function main() {
    console.log('Seeding mock data for dashboard testing...');

    // Get the guest user (or create a fallback one)
    let user = await prisma.user.findFirst({ where: { email: 'guest@charis.com' } });
    if (!user) {
        user = await prisma.user.create({
            data: { id: 'test-user-id', email: 'guest@charis.com', passwordHash: 'pwd', name: 'System Tester', role: 'admin' }
        });
    }

    // Get a location to attach to walks
    let loc = await prisma.prayerLocation.findFirst();
    if (!loc) {
        loc = await prisma.prayerLocation.create({
            data: { name: 'Main HQ', location: JSON.stringify({ type: 'Point', coordinates: [0, 0] }), category: 'Test' }
        });
    }

    // Generate 50 sessions
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let createdCount = 0;
    for (let i = 0; i < 50; i++) {
        const branch = branches[Math.floor(Math.random() * branches.length)];
        const center = centerPoints[branch] || [0, 0];

        const startTime = randomDate(thirtyDaysAgo, now);
        const durationMinutes = Math.floor(Math.random() * 90) + 15; // 15 to 105 mins
        const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

        const pointCount = Math.floor(Math.random() * 20) + 5;
        const path = generatePath(center[0], center[1], pointCount);

        const summary = summaries[Math.floor(Math.random() * summaries.length)];
        const trustScore = Math.floor(Math.random() * 30) + 70; // 70 to 100
        const distanceTraveled = (durationMinutes * 60) * 1.5; // roughly 1.5m per sec

        const session = await prisma.prayerSession.create({
            data: {
                userId: user.id,
                locationId: loc.id,
                status: 'completed',
                startTime,
                endTime,
                updatedAt: endTime,
                startLocation: path[0],
                currentLocation: path[path.length - 1],
                distanceTraveled,
                trustScore,
                branch,
                participants: Math.random() > 0.5 ? names[Math.floor(Math.random() * names.length)] + ', ' + names[Math.floor(Math.random() * names.length)] : names[Math.floor(Math.random() * names.length)],
                prayerSummary: summary,
                prayerJournal: Math.random() > 0.5 ? 'I felt a strong sense of peace during this walk. We covered a lot of ground.' : null,
                gpsEvents: {
                    create: path.map((point, index) => ({
                        location: point,
                        timestamp: new Date(startTime.getTime() + (index * (durationMinutes * 60000 / path.length)))
                    }))
                }
            }
        });

        // Add flags occasionally if score is low
        if (trustScore < 85) {
            await prisma.gPSFlag.create({
                data: {
                    sessionId: session.id,
                    flagType: 'velocity',
                    description: 'High velocity detected, possible moving vehicle.',
                    severity: 'medium',
                    timestamp: startTime
                }
            });
        }

        createdCount++;
    }

    console.log(`✅ Successfully generated ${createdCount} mock prayer walks.`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

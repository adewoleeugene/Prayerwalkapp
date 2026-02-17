import { NextRequest, NextResponse } from 'next/server';
import { prisma, findLocationsNearby, parsePoint } from '@/lib/db';
import { verifyToken, extractToken } from '@/lib/auth';

// GET /api/locations - Get all locations or nearby locations
export async function GET(request: NextRequest) {
    try {
        // Verify authentication
        const token = extractToken(request.headers.get('authorization'));
        if (!token || !verifyToken(token)) {
            return NextResponse.json(
                { error: 'Authentication required' },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(request.url);
        const lat = searchParams.get('lat');
        const lng = searchParams.get('lng');
        const radius = searchParams.get('radius') || '5000'; // Default 5km
        const category = searchParams.get('category');

        // If lat/lng provided, get nearby locations
        if (lat && lng) {
            const latitude = parseFloat(lat);
            const longitude = parseFloat(lng);
            const radiusMeters = parseFloat(radius);

            if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusMeters)) {
                return NextResponse.json(
                    { error: 'Invalid coordinates or radius' },
                    { status: 400 }
                );
            }

            const locations = await findLocationsNearby(latitude, longitude, radiusMeters);

            // Filter by category if provided
            const filteredLocations = category
                ? locations.filter((loc: any) => loc.category === category)
                : locations;

            return NextResponse.json({
                success: true,
                count: filteredLocations.length,
                locations: filteredLocations.map((loc: any) => ({
                    id: loc.id,
                    name: loc.name,
                    description: loc.description,
                    location: JSON.parse(loc.location),
                    address: loc.address,
                    prayerText: loc.prayer_text,
                    category: loc.category,
                    difficulty: loc.difficulty,
                    points: loc.points,
                    radiusMeters: parseFloat(loc.radius_meters),
                    distanceMeters: parseFloat(loc.distance_meters),
                })),
            });
        }

        // Otherwise, get all active locations
        const whereClause: any = { isActive: true };
        if (category) {
            whereClause.category = category;
        }

        const locations = await prisma.prayerLocation.findMany({
            where: whereClause,
            select: {
                id: true,
                name: true,
                description: true,
                location: true,
                address: true,
                prayerText: true,
                category: true,
                difficulty: true,
                points: true,
                radiusMeters: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json({
            success: true,
            count: locations.length,
            locations: locations.map(loc => ({
                ...loc,
                location: parsePoint(loc.location),
                radiusMeters: Number(loc.radiusMeters),
                points: loc.points,
            })),
        });
    } catch (error) {
        console.error('Get locations error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch locations' },
            { status: 500 }
        );
    }
}

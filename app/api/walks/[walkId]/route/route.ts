import { NextRequest, NextResponse } from 'next/server';
import { prisma, executePostGISQuery } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export async function POST(
    request: NextRequest,
    { params }: { params: { walkId: string } }
) {
    try {
        // Authenticate user
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

        const { walkId } = params;
        const { points } = await request.json();

        if (!Array.isArray(points) || points.length === 0) {
            return NextResponse.json(
                { error: 'Invalid GPS data format' },
                { status: 400 }
            );
        }

        // Verify walk exists
        const walk = await prisma.prayerWalk.findUnique({
            where: { id: walkId },
        });

        if (!walk) {
            return NextResponse.json(
                { error: 'Walk not found' },
                { status: 404 }
            );
        }

        // Insert GPS points
        const gpsPointsData = points.map((point: any) => {
            const geoJSON = {
                type: 'Point',
                coordinates: [point.longitude, point.latitude],
            };

            return {
                walkId,
                userId: payload.userId,
                location: JSON.stringify(geoJSON),
                accuracy: point.accuracy,
                altitude: point.altitude,
                speed: point.speed,
                recordedAt: new Date(point.timestamp),
            };
        });

        // Batch insert GPS points
        await prisma.gpsPoint.createMany({
            data: gpsPointsData,
        });

        // Build route LineString from all points
        const allPoints = await prisma.gpsPoint.findMany({
            where: { walkId },
            orderBy: { recordedAt: 'asc' },
        });

        if (allPoints.length >= 2) {
            const coordinates = allPoints.map((point: any) => {
                const location = JSON.parse(point.location);
                return location.coordinates;
            });

            const lineString = {
                type: 'LineString',
                coordinates,
            };

            // Update walk route using PostGIS
            await executePostGISQuery(
                `UPDATE prayer_walks 
         SET route = ST_GeomFromGeoJSON($1),
             updated_at = NOW()
         WHERE id = $2`,
                [JSON.stringify(lineString), walkId]
            );

            return NextResponse.json({
                success: true,
                pointsAdded: points.length,
                route: lineString,
            });
        }

        return NextResponse.json({
            success: true,
            pointsAdded: points.length,
            message: 'GPS points saved, waiting for more points to create route',
        });
    } catch (error) {
        console.error('Upload route error:', error);
        return NextResponse.json(
            { error: 'Failed to upload GPS route' },
            { status: 500 }
        );
    }
}

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
        const { endTime } = await request.json();

        // Find the walk
        const walk = await prisma.prayerWalk.findUnique({
            where: { id: walkId },
            include: {
                participants: true,
                gpsPoints: {
                    orderBy: { recordedAt: 'asc' },
                },
            },
        });

        if (!walk) {
            return NextResponse.json(
                { error: 'Walk not found' },
                { status: 404 }
            );
        }

        // Check if user is the leader
        if (walk.leaderId !== payload.userId) {
            return NextResponse.json(
                { error: 'Only the walk leader can stop this walk' },
                { status: 403 }
            );
        }

        // Build route from GPS points
        if (walk.gpsPoints.length >= 2) {
            const coordinates = walk.gpsPoints.map((point: any) => {
                const location = JSON.parse(point.location);
                return location.coordinates;
            });

            // Create LineString geometry
            const lineString = {
                type: 'LineString',
                coordinates,
            };

            // Update walk with route using raw SQL for PostGIS
            await executePostGISQuery(
                `UPDATE prayer_walks 
         SET route = ST_GeomFromGeoJSON($1),
             end_time = $2,
             status = 'completed',
             updated_at = NOW()
         WHERE id = $3`,
                [JSON.stringify(lineString), endTime || new Date(), walkId]
            );
        } else {
            // No GPS points, just mark as completed
            await prisma.prayerWalk.update({
                where: { id: walkId },
                data: {
                    endTime: endTime ? new Date(endTime) : new Date(),
                    status: 'completed',
                },
            });
        }

        // Fetch updated walk with statistics
        const updatedWalk = await prisma.prayerWalk.findUnique({
            where: { id: walkId },
            include: {
                participants: true,
            },
        });

        // Calculate duration
        const durationMinutes = updatedWalk?.endTime && updatedWalk?.startTime
            ? (updatedWalk.endTime.getTime() - updatedWalk.startTime.getTime()) / 1000 / 60
            : 0;

        return NextResponse.json({
            success: true,
            walk: {
                id: updatedWalk?.id,
                branch: updatedWalk?.branch,
                startTime: updatedWalk?.startTime,
                endTime: updatedWalk?.endTime,
                status: updatedWalk?.status,
                distanceMeters: updatedWalk?.distanceMeters ? Number(updatedWalk.distanceMeters) : 0,
                durationMinutes: Math.round(durationMinutes),
                participantCount: updatedWalk?.participants.length || 0,
            },
        });
    } catch (error) {
        console.error('Stop walk error:', error);
        return NextResponse.json(
            { error: 'Failed to stop prayer walk' },
            { status: 500 }
        );
    }
}

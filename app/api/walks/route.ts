import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { handleError } from '@/lib/apiHelpers';
import { logger } from '@/lib/logger';

/**
 * DELETE /api/walks
 * Body: { sessionId: string }
 *
 * Allows a PWA user to delete their own walk, verified by device fingerprint.
 * Cascade deletes GPSEvents, GPSFlags, RouteCheckpoints (onDelete: Cascade).
 */
export async function DELETE(request: NextRequest) {
  try {
    const fingerprint = (request.headers.get('x-device-fingerprint') || '').trim();
    if (!fingerprint || fingerprint.length < 4) {
      return Response.json({ error: 'Device fingerprint required' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }

    // Only delete if this device fingerprint owns the walk
    const walk = await prisma.prayerSession.findFirst({
      where: { id: sessionId, deviceFingerprint: fingerprint },
      select: { id: true },
    });
    if (!walk) {
      return Response.json({ error: 'Walk not found or not owned by this device' }, { status: 404 });
    }

    await prisma.prayerSession.delete({ where: { id: sessionId } });

    logger.info(`Device ${fingerprint.slice(0, 6)}… deleted walk ${sessionId}`);
    return Response.json({ success: true });
  } catch (error) {
    logger.error('Delete walk error:', error);
    return handleError(error);
  }
}

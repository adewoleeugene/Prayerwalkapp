import { type NextRequest } from 'next/server';
import { requireDeviceAuth, handleError } from '@/lib/apiHelpers';
import { validateGPSUpdate } from '@/lib/gps';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const user = await requireDeviceAuth(request);
    const { sessionId, latitude, longitude, speed, accuracy, isMock, clientRequestId, clientEventAt } = await request.json();

    if (!sessionId || latitude === undefined || longitude === undefined) {
      return Response.json({ error: 'Missing required tracking data' }, { status: 400 });
    }

    try {
      const trackResult = await validateGPSUpdate(sessionId, user.userId, { latitude, longitude, speed, accuracy, isMock, clientEventAt, clientRequestId });
      return Response.json({ success: true, status: 'validated', acceptedAt: trackResult.acceptedAt, idempotentReplay: trackResult.idempotentReplay });
    } catch (err) {
      logger.error('Failed to validate GPS for session', err, { sessionId });
      return Response.json({ success: false, error: 'Tracking failed' }, { status: 500 });
    }
  } catch (error) {
    return handleError(error);
  }
}

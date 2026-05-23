import { type NextRequest } from 'next/server';
import { requireDeviceAuth, handleError } from '@/lib/apiHelpers';
import { executeIdempotentRequest } from '@/lib/idempotency';
import { startWalk } from '@/services/walks/walkSessionService';
import { DomainError } from '@/errors/domainError';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const user = await requireDeviceAuth(request);
    const body = await request.json();
    const { locationId, latitude, longitude, deviceFingerprint, branch, participants, startAddress, clientRequestId, clientEventAt, localSessionId } = body;

    const result = await executeIdempotentRequest({
      idempotencyKey: typeof clientRequestId === 'string' ? clientRequestId : undefined,
      endpoint: 'walks/start',
      userId: user.userId,
      payload: { locationId, latitude, longitude, deviceFingerprint, branch, participants, startAddress, clientEventAt, localSessionId },
      execute: async () => {
        const started = await startWalk({ userId: user.userId, locationId, latitude, longitude, deviceFingerprint, branch, participants, startAddress });
        if (started.resumed) {
          return { statusCode: 200, body: { success: true, message: 'Resuming existing active session', session: started.session, location: null } };
        }
        return { statusCode: 201, body: { success: true, message: 'Walk started with Route Integrity enabled', session: started.session, location: started.location } };
      },
    });

    return Response.json({ ...result.body, acceptedAt: result.acceptedAt, idempotentReplay: result.idempotentReplay }, { status: result.statusCode });
  } catch (error) {
    if (error instanceof DomainError) {
      return Response.json({ error: error.message, details: error.details }, { status: error.statusCode });
    }
    logger.error('Start walk error:', error);
    return handleError(error);
  }
}

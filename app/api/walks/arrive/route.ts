import { type NextRequest } from 'next/server';
import { requireDeviceAuth, handleError } from '@/lib/apiHelpers';
import { executeIdempotentRequest } from '@/lib/idempotency';
import { arriveAtLocation } from '@/services/walks/walkSessionService';
import { DomainError } from '@/errors/domainError';

export async function POST(request: NextRequest) {
  try {
    const user = await requireDeviceAuth(request);
    const { sessionId, locationId, latitude, longitude, clientRequestId, clientEventAt } = await request.json();

    const result = await executeIdempotentRequest({
      idempotencyKey: typeof clientRequestId === 'string' ? clientRequestId : undefined,
      endpoint: 'walks/arrive',
      userId: user.userId,
      payload: { sessionId, locationId, latitude, longitude, clientEventAt },
      execute: async () => {
        const arrived = await arriveAtLocation({ sessionId, locationId, latitude, longitude, userId: user.userId });
        return { statusCode: 200, body: { success: true, withinRange: arrived.withinRange, integrityScore: arrived.integrityScore, location: arrived.location, distance: arrived.distance } };
      },
    });

    return Response.json({ ...result.body, acceptedAt: result.acceptedAt, idempotentReplay: result.idempotentReplay }, { status: result.statusCode });
  } catch (error) {
    if (error instanceof DomainError) {
      return Response.json({ error: error.message, details: error.details }, { status: error.statusCode });
    }
    return handleError(error);
  }
}

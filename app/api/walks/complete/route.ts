import { type NextRequest } from 'next/server';
import { requireDeviceAuth, handleError } from '@/lib/apiHelpers';
import { executeIdempotentRequest } from '@/lib/idempotency';
import { completeWalk } from '@/services/walks/walkSessionService';
import { DomainError } from '@/errors/domainError';

export async function POST(request: NextRequest) {
  try {
    const user = await requireDeviceAuth(request);
    const { sessionId, locationId, latitude, longitude, prayerSummary, prayerJournal, clientRequestId, clientEventAt, localSessionId } = await request.json();

    const result = await executeIdempotentRequest({
      idempotencyKey: typeof clientRequestId === 'string' ? clientRequestId : undefined,
      endpoint: 'walks/complete',
      userId: user.userId,
      payload: { sessionId, locationId, latitude, longitude, prayerSummary, prayerJournal, clientEventAt, localSessionId },
      execute: async () => {
        const completed = await completeWalk({ sessionId, locationId, latitude, longitude, prayerSummary, prayerJournal, userId: user.userId });
        return { statusCode: 200, body: { success: true, trustScore: completed.trustScore, pointsEarned: completed.pointsEarned, badgesEarned: completed.badgesEarned } };
      },
    });

    return Response.json({ ...result.body, acceptedAt: result.acceptedAt, idempotentReplay: result.idempotentReplay }, { status: result.statusCode });
  } catch (error) {
    if (error instanceof DomainError) {
      const details = (error.details ?? {}) as Record<string, unknown>;
      return Response.json({
        error: error.message,
        ...(details.trustScore !== undefined ? { trustScore: details.trustScore } : {}),
        ...(details.reason !== undefined ? { reason: details.reason } : {}),
      }, { status: error.statusCode });
    }
    return handleError(error);
  }
}

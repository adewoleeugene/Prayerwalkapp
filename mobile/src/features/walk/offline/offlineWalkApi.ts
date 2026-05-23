import { AxiosError } from 'axios';
import { api } from '../../../api/client';
import {
  createClientRequestId,
  enqueueAction,
  resolveSessionId,
} from './offlineQueue';
import { triggerOfflineSync } from './syncEngine';

function nowIso() {
  return new Date().toISOString();
}

function createLocalSessionId() {
  return `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isOfflineLikeError(_error: unknown): boolean {
  return false; // v1: disable offline queue — failures surface as visible errors
}

function localWithinRange(targetLocation: any, latitude: number, longitude: number): { withinRange: boolean; distance: number } {
  const raw = targetLocation?.location?.coordinates || targetLocation?.location;
  let targetLat: number | null = null;
  let targetLng: number | null = null;

  if (Array.isArray(raw) && raw.length >= 2) {
    targetLat = Number(raw[1]);
    targetLng = Number(raw[0]);
  } else if (raw?.latitude !== undefined && raw?.longitude !== undefined) {
    targetLat = Number(raw.latitude);
    targetLng = Number(raw.longitude);
  }

  if (targetLat === null || targetLng === null) {
    return { withinRange: false, distance: Number.POSITIVE_INFINITY };
  }

  const toRad = (n: number) => (n * Math.PI) / 180;
  const R = 6371e3;
  const phi1 = toRad(latitude);
  const phi2 = toRad(targetLat);
  const dPhi = toRad(targetLat - latitude);
  const dLambda = toRad(targetLng - longitude);
  const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2)
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  const radiusMeters = Number(targetLocation?.radiusMeters || 50);
  return { withinRange: distance <= radiusMeters, distance };
}

export async function startWalkOnlineOrQueue(input: {
  locationId?: string;
  latitude: number;
  longitude: number;
  deviceFingerprint?: string;
  branch?: string;
  participants?: string[];
  startAddress?: string;
}) {
  const clientRequestId = createClientRequestId('start');
  const clientEventAt = nowIso();
  const localSessionId = createLocalSessionId();
  const payload = {
    locationId: input.locationId,
    latitude: input.latitude,
    longitude: input.longitude,
    deviceFingerprint: input.deviceFingerprint,
    branch: input.branch,
    participants: input.participants,
    startAddress: input.startAddress,
  };

  try {
    const res = await api.walks.start(
      input.locationId,
      input.latitude,
      input.longitude,
      input.deviceFingerprint,
      input.branch,
      input.participants,
      input.startAddress,
      { clientRequestId, clientEventAt, localSessionId }
    );
    void triggerOfflineSync('start-success');
    return res;
  } catch (error) {
    if (!isOfflineLikeError(error)) throw error;
  }

  await enqueueAction({
    id: createClientRequestId('qstart'),
    type: 'start',
    localSessionId,
    payload,
    clientEventAt,
    clientRequestId,
    createdAt: clientEventAt,
  });

  return {
    data: {
      success: true,
      queued: true,
      acceptedAt: clientEventAt,
      idempotentReplay: false,
      session: {
        id: localSessionId,
        branch: input.branch || 'International',
        participants: input.participants || [],
        startTime: clientEventAt,
      },
      location: null,
    },
  };
}

export async function trackWalkOnlineOrQueue(input: {
  sessionId: string;
  latitude: number;
  longitude: number;
  speed?: number;
  accuracy?: number;
  isMock?: boolean;
}) {
  const clientRequestId = createClientRequestId('track');
  const clientEventAt = nowIso();
  const resolvedSessionId = await resolveSessionId(input.sessionId);
  const payload = {
    sessionId: resolvedSessionId || input.sessionId,
    latitude: input.latitude,
    longitude: input.longitude,
    speed: input.speed,
    accuracy: input.accuracy,
    isMock: input.isMock,
  };

  if (resolvedSessionId) {
    try {
      const res = await api.walks.track(
        resolvedSessionId,
        input.latitude,
        input.longitude,
        input.speed,
        input.accuracy,
        input.isMock,
        { clientRequestId, clientEventAt }
      );
      void triggerOfflineSync('track-success');
      return res;
    } catch (error) {
      if (!isOfflineLikeError(error)) throw error;
    }
  }

  await enqueueAction({
    id: createClientRequestId('qtrack'),
    type: 'track',
    localSessionId: input.sessionId,
    serverSessionId: resolvedSessionId || undefined,
    payload,
    clientEventAt,
    clientRequestId,
    createdAt: clientEventAt,
  });

  return {
    data: {
      success: true,
      queued: true,
      acceptedAt: clientEventAt,
      idempotentReplay: false,
      status: 'queued',
    },
  };
}

export async function arriveOnlineOrQueue(input: {
  sessionId: string;
  locationId: string;
  latitude: number;
  longitude: number;
  targetLocation?: any;
}) {
  const clientRequestId = createClientRequestId('arrive');
  const clientEventAt = nowIso();
  const resolvedSessionId = await resolveSessionId(input.sessionId);
  const payload = {
    sessionId: resolvedSessionId || input.sessionId,
    locationId: input.locationId,
    latitude: input.latitude,
    longitude: input.longitude,
  };

  if (resolvedSessionId) {
    try {
      const res = await api.walks.arrive(
        resolvedSessionId,
        input.locationId,
        input.latitude,
        input.longitude,
        { clientRequestId, clientEventAt }
      );
      void triggerOfflineSync('arrive-success');
      return res;
    } catch (error) {
      if (!isOfflineLikeError(error)) throw error;
    }
  }

  await enqueueAction({
    id: createClientRequestId('qarrive'),
    type: 'arrive',
    localSessionId: input.sessionId,
    serverSessionId: resolvedSessionId || undefined,
    payload,
    clientEventAt,
    clientRequestId,
    createdAt: clientEventAt,
  });

  const local = localWithinRange(input.targetLocation, input.latitude, input.longitude);
  return {
    data: {
      success: true,
      queued: true,
      acceptedAt: clientEventAt,
      idempotentReplay: false,
      withinRange: local.withinRange,
      integrityScore: 100,
      location: input.targetLocation || null,
      distance: Number.isFinite(local.distance) ? local.distance : 0,
    },
  };
}

export async function completeWalkOnlineOrQueue(input: {
  sessionId: string;
  locationId?: string;
  latitude: number;
  longitude: number;
  prayerSummary?: string;
  prayerJournal?: string;
}) {
  const clientRequestId = createClientRequestId('complete');
  const clientEventAt = nowIso();
  const resolvedSessionId = await resolveSessionId(input.sessionId);
  const payload = {
    sessionId: resolvedSessionId || input.sessionId,
    locationId: input.locationId,
    latitude: input.latitude,
    longitude: input.longitude,
    prayerSummary: input.prayerSummary,
    prayerJournal: input.prayerJournal,
  };

  if (resolvedSessionId) {
    try {
      const res = await api.walks.complete(
        resolvedSessionId,
        input.locationId,
        input.latitude,
        input.longitude,
        input.prayerSummary,
        input.prayerJournal,
        { clientRequestId, clientEventAt, localSessionId: input.sessionId }
      );
      void triggerOfflineSync('complete-success');
      return res;
    } catch (error) {
      if (!isOfflineLikeError(error)) throw error;
    }
  }

  await enqueueAction({
    id: createClientRequestId('qcomplete'),
    type: 'complete',
    localSessionId: input.sessionId,
    serverSessionId: resolvedSessionId || undefined,
    payload,
    clientEventAt,
    clientRequestId,
    createdAt: clientEventAt,
  });

  return {
    data: {
      success: true,
      queued: true,
      acceptedAt: clientEventAt,
      idempotentReplay: false,
      trustScore: 100,
      pointsEarned: 0,
      badgesEarned: [],
    },
  };
}

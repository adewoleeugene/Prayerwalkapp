import { AppState, AppStateStatus } from 'react-native';
import * as Network from 'expo-network';
import client from '../../../api/client';
import {
  getQueueStats,
  loadQueue,
  loadSessionMap,
  replaceQueue,
  rewriteQueueSessionIds,
  setSessionMapping,
} from './offlineQueue';
import { OfflineQueueItem, SyncStatus } from './types';

const RETRY_STEPS_MS = [2000, 5000, 15000, 30000];
const STEADY_RETRY_MS = 60000;

const listeners = new Set<(status: SyncStatus) => void>();
let syncInterval: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let activeEngineUsers = 0;
let inFlight: Promise<void> | null = null;

let currentStatus: SyncStatus = {
  isOnline: true,
  isSyncing: false,
  pendingCount: 0,
  failedCount: 0,
  lastSyncAt: null,
  oldestPendingMinutes: null,
  error: null,
};

function emitStatus(next: Partial<SyncStatus>) {
  currentStatus = { ...currentStatus, ...next };
  listeners.forEach((listener) => listener(currentStatus));
}

async function refreshCounts() {
  const stats = await getQueueStats();
  emitStatus({
    pendingCount: stats.pendingCount,
    failedCount: stats.failedCount,
    oldestPendingMinutes: stats.oldestPendingMinutes,
  });
}

function retryDelayMs(attempts: number): number {
  if (attempts < RETRY_STEPS_MS.length) return RETRY_STEPS_MS[attempts];
  return STEADY_RETRY_MS;
}

function normalizeSessionId(item: OfflineQueueItem, sessionMap: Record<string, string>): string | null {
  if (item.serverSessionId) return item.serverSessionId;
  if (!item.localSessionId.startsWith('local_')) return item.localSessionId;
  return sessionMap[item.localSessionId] || null;
}

async function sendQueuedItem(item: OfflineQueueItem, sessionMap: Record<string, string>) {
  const sessionId = normalizeSessionId(item, sessionMap);
  if (item.type !== 'start' && !sessionId) {
    return { skipped: true as const };
  }

  if (item.type === 'start') {
    const payload = {
      ...(item.payload as Record<string, unknown>),
      clientRequestId: item.clientRequestId,
      clientEventAt: item.clientEventAt,
      localSessionId: item.localSessionId,
    };
    const res = await client.post('/walks/start', payload);
    const serverSessionId = String(res.data?.session?.id || '');
    if (serverSessionId) {
      await setSessionMapping(item.localSessionId, serverSessionId);
      await rewriteQueueSessionIds(item.localSessionId, serverSessionId);
    }
    return { skipped: false as const, serverSessionId };
  }

  if (!sessionId) {
    return { skipped: true as const };
  }

  if (item.type === 'track') {
    await client.post('/walks/track', {
      ...(item.payload as Record<string, unknown>),
      sessionId,
      clientRequestId: item.clientRequestId,
      clientEventAt: item.clientEventAt,
    });
    return { skipped: false as const, serverSessionId: null };
  }

  if (item.type === 'arrive') {
    await client.post('/walks/arrive', {
      ...(item.payload as Record<string, unknown>),
      sessionId,
      clientRequestId: item.clientRequestId,
      clientEventAt: item.clientEventAt,
    });
    return { skipped: false as const, serverSessionId: null };
  }

  await client.post('/walks/complete', {
    ...(item.payload as Record<string, unknown>),
    sessionId,
    localSessionId: item.localSessionId,
    clientRequestId: item.clientRequestId,
    clientEventAt: item.clientEventAt,
  });
  return { skipped: false as const, serverSessionId: null };
}

function toErrorMessage(error: any): string {
  const status = error?.response?.status;
  const serverMessage = error?.response?.data?.error;
  if (status && serverMessage) return `${status}: ${serverMessage}`;
  if (status) return `HTTP ${status}`;
  return String(error?.message || 'Network error');
}

async function detectDeviceOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    // If connectivity cannot be determined, bias toward online and surface a sync error instead.
    return state.isConnected !== false;
  } catch {
    return true;
  }
}

async function flushQueueInternal() {
  emitStatus({ isOnline: true });

  const initialQueue = await loadQueue();
  if (initialQueue.length === 0) {
    emitStatus({ lastSyncAt: new Date().toISOString(), error: null });
    await refreshCounts();
    return;
  }

  const now = Date.now();
  const workingQueue = [...initialQueue].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const sessionMap = await loadSessionMap();
  let mutated = false;
  let latestError: string | null = null;

  for (let i = 0; i < workingQueue.length; i += 1) {
    const item = workingQueue[i];
    if (item.status === 'failed') continue;
    if (item.retryAt && new Date(item.retryAt).getTime() > now) continue;

    try {
      const outcome = await sendQueuedItem(item, sessionMap);
      if (outcome.skipped) {
        const waitingForSessionMapping =
          item.type !== 'start' &&
          item.localSessionId.startsWith('local_') &&
          !normalizeSessionId(item, sessionMap);

        if (waitingForSessionMapping) {
          const hasResolvableStart = workingQueue.some((queued) =>
            queued.type === 'start' &&
            queued.localSessionId === item.localSessionId &&
            queued.status !== 'failed'
          );

          if (!hasResolvableStart) {
            workingQueue[i] = {
              ...item,
              status: 'failed' as const,
              attempts: item.attempts + 1,
              lastError: 'Missing session mapping for queued action',
            };
            mutated = true;
          }
        }

        continue;
      }
      if (item.type === 'start' && outcome.serverSessionId) {
        sessionMap[item.localSessionId] = outcome.serverSessionId;
        for (let j = 0; j < workingQueue.length; j += 1) {
          const queued = workingQueue[j];
          if (queued.localSessionId !== item.localSessionId) continue;
          workingQueue[j] = {
            ...queued,
            serverSessionId: outcome.serverSessionId,
            payload: {
              ...queued.payload,
              sessionId: outcome.serverSessionId,
            },
          };
        }
      }
      workingQueue.splice(i, 1);
      i -= 1;
      mutated = true;
    } catch (error: any) {
      const status = Number(error?.response?.status || 0);
      if (status >= 400 && status < 500) {
        workingQueue[i] = {
          ...item,
          status: 'failed' as const,
          attempts: item.attempts + 1,
          lastError: toErrorMessage(error),
        };
        mutated = true;
        continue;
      }

      const delay = retryDelayMs(item.attempts);
      const deviceOnline = await detectDeviceOnline();
      latestError = toErrorMessage(error);
      emitStatus({ isOnline: deviceOnline });
      workingQueue[i] = {
        ...item,
        status: 'pending' as const,
        attempts: item.attempts + 1,
        retryAt: new Date(Date.now() + delay).toISOString(),
        lastError: latestError,
      };
      mutated = true;
      emitStatus({ error: latestError });
      break;
    }
  }

  if (mutated) {
    await replaceQueue(workingQueue);
  }

  emitStatus({
    lastSyncAt: mutated ? new Date().toISOString() : currentStatus.lastSyncAt,
    error: latestError,
  });
  await refreshCounts();
}

export async function triggerOfflineSync(_reason = 'manual') {
  if (inFlight) {
    await inFlight;
    return;
  }
  emitStatus({ isSyncing: true });
  inFlight = flushQueueInternal().finally(() => {
    inFlight = null;
    emitStatus({ isSyncing: false });
  });
  await inFlight;
}

export async function startOfflineSyncEngine() {
  activeEngineUsers += 1;
  if (activeEngineUsers > 1) return;

  await refreshCounts();
  await triggerOfflineSync('startup');

  syncInterval = setInterval(() => {
    void triggerOfflineSync('interval');
  }, 30000);

  appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') {
      void triggerOfflineSync('foreground');
    }
  });
}

export function stopOfflineSyncEngine() {
  activeEngineUsers = Math.max(0, activeEngineUsers - 1);
  if (activeEngineUsers > 0) return;

  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }

  appStateSubscription?.remove();
  appStateSubscription = null;
}

export function subscribeSyncStatus(listener: (status: SyncStatus) => void) {
  listeners.add(listener);
  listener(currentStatus);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncStatusSnapshot(): SyncStatus {
  return currentStatus;
}

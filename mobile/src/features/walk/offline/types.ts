export type OfflineQueueActionType = 'start' | 'track' | 'arrive' | 'complete';
export type OfflineQueueStatus = 'pending' | 'inflight' | 'failed';

export type OfflineQueueItem = {
  id: string;
  type: OfflineQueueActionType;
  localSessionId: string;
  serverSessionId?: string;
  payload: Record<string, unknown>;
  clientEventAt: string;
  clientRequestId: string;
  createdAt: string;
  attempts: number;
  status: OfflineQueueStatus;
  retryAt?: string;
  lastError?: string;
};

export type SessionMap = Record<string, string>;

export type SyncStatus = {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  lastSyncAt: string | null;
  oldestPendingMinutes: number | null;
  error: string | null;
};

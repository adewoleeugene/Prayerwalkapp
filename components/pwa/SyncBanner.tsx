'use client';

import { useEffect, useState } from 'react';
import { SyncStatus } from '@/lib/pwa/offlineTypes';

type Props = {
  status: SyncStatus;
  onRetry?: () => void;
};

export function SyncBanner({ status, onRetry }: Props) {
  const [showSynced, setShowSynced] = useState(false);

  useEffect(() => {
    if (!status.isSyncing && status.pendingCount === 0 && !status.error && status.lastSyncAt) {
      setShowSynced(true);
      const timer = setTimeout(() => setShowSynced(false), 2600);
      return () => clearTimeout(timer);
    }
  }, [status.isSyncing, status.pendingCount, status.error, status.lastSyncAt]);

  const isOld = status.oldestPendingMinutes !== null && status.oldestPendingMinutes > 20;
  const visible = !status.isOnline || status.isSyncing || status.pendingCount > 0 || !!status.error || showSynced;

  if (!visible) return null;

  const label = !status.isOnline
    ? 'Offline'
    : status.isSyncing
    ? 'Syncing…'
    : status.error
    ? 'Sync error'
    : status.pendingCount > 0
    ? `${status.pendingCount} pending`
    : 'Synced';

  const bgClass = !status.isOnline || status.error
    ? 'bg-red-600'
    : status.pendingCount > 0 || status.isSyncing
    ? 'bg-amber-500'
    : 'bg-emerald-600';

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-white text-xs font-semibold shadow ${bgClass}`}>
      {status.isSyncing && (
        <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
      )}
      <span>{label}</span>
      {isOld && <span className="opacity-80">· {status.oldestPendingMinutes}m old</span>}
      {status.pendingCount > 0 && onRetry && (
        <button onClick={onRetry} className="underline ml-1 opacity-90 hover:opacity-100">
          Retry
        </button>
      )}
    </div>
  );
}

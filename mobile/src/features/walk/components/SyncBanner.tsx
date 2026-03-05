import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SyncStatus } from '../offline/types';

type Props = {
  status: SyncStatus;
  onRetry: () => void;
};

function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) return 'Never synced';
  return `Last sync ${new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function SyncBanner({ status, onRetry }: Props) {
  const [showSyncedToast, setShowSyncedToast] = useState(false);
  const prevLastSyncRef = useRef<string | null>(status.lastSyncAt);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prevLastSync = prevLastSyncRef.current;
    const hasNewSync = !!status.lastSyncAt && status.lastSyncAt !== prevLastSync;
    const shouldToast = hasNewSync && status.isOnline && !status.isSyncing && status.pendingCount === 0 && !status.error;

    prevLastSyncRef.current = status.lastSyncAt;

    if (!shouldToast) return;

    setShowSyncedToast(true);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => {
      setShowSyncedToast(false);
      hideTimerRef.current = null;
    }, 2600);
  }, [status.lastSyncAt, status.isOnline, status.isSyncing, status.pendingCount, status.error]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  const label = !status.isOnline
    ? 'Offline'
    : status.isSyncing
      ? 'Syncing'
      : status.pendingCount > 0
        ? `${status.pendingCount} pending`
        : 'Synced';

  const shouldRender =
    !status.isOnline ||
    status.isSyncing ||
    status.pendingCount > 0 ||
    !!status.error ||
    showSyncedToast;

  if (!shouldRender) return null;

  const expiringSoon = (status.oldestPendingMinutes || 0) >= 20 * 60;

  return (
    <View style={[styles.container, !status.isOnline ? styles.offline : styles.online]}>
      <View style={styles.row}>
        <Text style={styles.primary}>{label}</Text>
        <Text style={styles.secondary}>{formatLastSync(status.lastSyncAt)}</Text>
      </View>
      <View style={styles.row}>
        {!!status.error && <Text style={styles.error} numberOfLines={1}>{status.error}</Text>}
        {status.pendingCount > 0 && (
          <TouchableOpacity style={styles.button} onPress={onRetry}>
            <Text style={styles.buttonText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
      {expiringSoon && (
        <Text style={styles.warning}>
          Pending walk data is approaching 24h retention.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
  },
  online: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderColor: '#D0E2FF',
  },
  offline: {
    backgroundColor: 'rgba(255,243,205,0.96)',
    borderColor: '#F2CC60',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  primary: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '800',
  },
  secondary: {
    color: '#4B5563',
    fontSize: 11,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  error: {
    flex: 1,
    color: '#B91C1C',
    fontSize: 11,
    fontWeight: '600',
  },
  warning: {
    marginTop: 6,
    color: '#92400E',
    fontSize: 11,
    fontWeight: '700',
  },
});

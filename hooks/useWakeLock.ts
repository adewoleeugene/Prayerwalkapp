'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useWakeLock() {
  const [isActive, setIsActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  const acquire = useCallback(async () => {
    if (!('wakeLock' in navigator)) return false;
    try {
      sentinelRef.current = await navigator.wakeLock.request('screen');
      sentinelRef.current.addEventListener('release', () => setIsActive(false));
      setIsActive(true);
      return true;
    } catch {
      setIsActive(false);
      return false;
    }
  }, []);

  const release = useCallback(async () => {
    await sentinelRef.current?.release();
    sentinelRef.current = null;
    setIsActive(false);
  }, []);

  // Re-acquire when page becomes visible again (OS may release on dim/notification shade)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && sentinelRef.current === null && isActive) {
        void acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isActive, acquire]);

  useEffect(() => {
    return () => {
      void sentinelRef.current?.release();
    };
  }, []);

  return { isActive, acquire, release };
}

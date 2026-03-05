import { useEffect, useState } from 'react';

export function useWalkTimer(startedAt?: string | null, running = true) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setElapsedSeconds(0);
      return;
    }
    if (!running) return;

    const startedAtMs = new Date(startedAt).getTime();
    const tick = () => {
      const nowMs = Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((nowMs - startedAtMs) / 1000)));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, running]);

  return elapsedSeconds;
}

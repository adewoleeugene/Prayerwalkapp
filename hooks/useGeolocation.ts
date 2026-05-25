'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type GeolocationPosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  timestamp: number;
};

type GeolocationHook = {
  position: GeolocationPosition | null;
  error: string | null;
  isTracking: boolean;
  startTracking: () => void;
  stopTracking: () => void;
};

export function useGeolocation(): GeolocationHook {
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
  }, []);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser');
      return;
    }

    if (watchIdRef.current !== null) return; // already tracking

    setError(null);
    setIsTracking(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        // Ignore very low-accuracy readings — common on Android during initial
        // GPS acquisition or indoors. These cause spurious map movement.
        if (pos.coords.accuracy > 80) return;
        setPosition({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          timestamp: pos.timestamp,
        });
        setError(null);
      },
      (err) => {
        setError(err.message);
        setIsTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return { position, error, isTracking, startTracking, stopTracking };
}

export async function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          timestamp: pos.timestamp,
        }),
      (err) => reject(new Error(err.message)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  });
}

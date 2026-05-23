/**
 * Background location task.
 *
 * This module MUST be imported at the top level of index.ts (before
 * registerRootComponent) so that TaskManager can find the task definition
 * even when the app is woken up in the background on iOS/Android.
 *
 * Architecture:
 *   - watchPositionAsync  → foreground (live UI, high-frequency, stops on screen lock)
 *   - startLocationUpdatesAsync → background (GPS storage, 10 s/10 m, survives screen lock)
 *
 * Both run in parallel during an active walk. The background task stores GPS
 * points via the same trackWalkOnlineOrQueue function used by the foreground
 * watcher, so idempotency (clientRequestId) prevents exact duplicates.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { trackWalkOnlineOrQueue } from '../walk/offline/offlineWalkApi';

export const BACKGROUND_LOCATION_TASK = 'charis-background-location';

/** AsyncStorage key that passes the active session ID into the background task. */
const BG_SESSION_KEY = 'background_walk_session_id';

// ─── Task Definition ────────────────────────────────────────────────────────
// Must be defined at module top-level (not inside a component or function).

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: { data: unknown; error: { message: string } | null }) => {
  if (error) {
    console.warn('[BgLocation] task error:', (error as any).message);
    return;
  }
  if (!data) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations?.length) return;

  const sessionId = await AsyncStorage.getItem(BG_SESSION_KEY);
  if (!sessionId) return;

  // Use only the most-recent location to avoid bursting multiple requests
  const loc = locations[locations.length - 1];
  const { latitude, longitude, speed, accuracy } = loc.coords;

  try {
    await trackWalkOnlineOrQueue({
      sessionId,
      latitude,
      longitude,
      speed: speed ?? undefined,
      accuracy: accuracy ?? undefined,
      isMock: (loc.coords as any).mocked ?? false,
    });
  } catch (e) {
    console.warn('[BgLocation] track failed:', e);
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

export async function saveSessionForBackground(sessionId: string): Promise<void> {
  await AsyncStorage.setItem(BG_SESSION_KEY, sessionId);
}

export async function clearSessionForBackground(): Promise<void> {
  await AsyncStorage.removeItem(BG_SESSION_KEY);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Start background location updates for the given session.
 * Returns `true` if successfully started (or already running),
 * `false` if background permission was not granted.
 */
export async function startBackgroundLocationTracking(sessionId: string): Promise<boolean> {
  try {
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status !== 'granted') {
      console.log('[BgLocation] background permission not granted — skipping');
      return false;
    }

    await saveSessionForBackground(sessionId);

    const isAlreadyRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (isAlreadyRunning) return true;

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 10_000,   // 10 seconds
      distanceInterval: 10,   // 10 metres minimum movement
      showsBackgroundLocationIndicator: true, // iOS blue status-bar pill
      foregroundService: {
        // Android foreground-service notification (required on Android 8+)
        notificationTitle: 'Prayer Walk Active',
        notificationBody: 'Recording your walk in the background',
        notificationColor: '#4F46E5',
      },
      pausesUpdatesAutomatically: false,
    });

    console.log('[BgLocation] started for session', sessionId);
    return true;
  } catch (e) {
    console.warn('[BgLocation] start failed:', e);
    return false;
  }
}

/**
 * Stop background location updates and clear the stored session ID.
 * Safe to call even if tracking is not running.
 */
export async function stopBackgroundLocationTracking(): Promise<void> {
  try {
    await clearSessionForBackground();

    const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      console.log('[BgLocation] stopped');
    }
  } catch (e) {
    console.warn('[BgLocation] stop failed:', e);
  }
}

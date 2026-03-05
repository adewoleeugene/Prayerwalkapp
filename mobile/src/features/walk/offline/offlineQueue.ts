import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineQueueItem, SessionMap } from './types';

export const OFFLINE_QUEUE_KEY = 'walk_offline_queue_v1';
export const SESSION_MAP_KEY = 'walk_session_map_v1';
const MAX_TRACK_POINTS = 20000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createClientRequestId(type: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${type}_${Date.now().toString(36)}_${rand}`.slice(0, 64);
}

export async function loadQueue(): Promise<OfflineQueueItem[]> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  const parsed = safeParse<OfflineQueueItem[]>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item) => !!item && typeof item.id === 'string');
}

export async function saveQueue(queue: OfflineQueueItem[]): Promise<void> {
  const retained = applyRetention(queue);
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(retained));
}

export function applyRetention(queue: OfflineQueueItem[]): OfflineQueueItem[] {
  const nowMs = Date.now();
  const notExpired = queue.filter((item) => nowMs - new Date(item.createdAt).getTime() <= MAX_AGE_MS);
  const sorted = [...notExpired].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const tracks = sorted.filter((item) => item.type === 'track');
  if (tracks.length <= MAX_TRACK_POINTS) {
    return sorted;
  }

  let toDrop = tracks.length - MAX_TRACK_POINTS;
  return sorted.filter((item) => {
    if (item.type !== 'track') return true;
    if (toDrop <= 0) return true;
    toDrop -= 1;
    return false;
  });
}

export async function enqueueAction(item: Omit<OfflineQueueItem, 'attempts' | 'status'>): Promise<OfflineQueueItem> {
  const queue = await loadQueue();
  const next: OfflineQueueItem = {
    ...item,
    attempts: 0,
    status: 'pending',
  };
  queue.push(next);
  await saveQueue(queue);
  return next;
}

export async function updateQueueItem(id: string, updater: (item: OfflineQueueItem) => OfflineQueueItem): Promise<void> {
  const queue = await loadQueue();
  const next = queue.map((item) => (item.id === id ? updater(item) : item));
  await saveQueue(next);
}

export async function removeQueueItem(id: string): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(queue.filter((item) => item.id !== id));
}

export async function replaceQueue(items: OfflineQueueItem[]): Promise<void> {
  await saveQueue(items);
}

export async function loadSessionMap(): Promise<SessionMap> {
  const raw = await AsyncStorage.getItem(SESSION_MAP_KEY);
  const parsed = safeParse<SessionMap>(raw, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

export async function saveSessionMap(map: SessionMap): Promise<void> {
  await AsyncStorage.setItem(SESSION_MAP_KEY, JSON.stringify(map));
}

export async function setSessionMapping(localSessionId: string, serverSessionId: string): Promise<void> {
  const map = await loadSessionMap();
  map[localSessionId] = serverSessionId;
  await saveSessionMap(map);
}

export async function resolveSessionId(sessionId: string): Promise<string | null> {
  if (!sessionId.startsWith('local_')) return sessionId;
  const map = await loadSessionMap();
  return map[sessionId] || null;
}

export async function rewriteQueueSessionIds(localSessionId: string, serverSessionId: string): Promise<void> {
  const queue = await loadQueue();
  const rewritten = queue.map((item) => {
    if (item.localSessionId !== localSessionId) return item;
    return {
      ...item,
      serverSessionId,
      payload: {
        ...item.payload,
        sessionId: serverSessionId,
      },
    };
  });
  await saveQueue(rewritten);
}

export async function getQueueStats() {
  const queue = await loadQueue();
  const pending = queue.filter((item) => item.status !== 'failed');
  const failed = queue.length - pending.length;
  const oldest = pending.length
    ? pending.reduce((acc, item) => Math.min(acc, new Date(item.createdAt).getTime()), Number.POSITIVE_INFINITY)
    : null;
  return {
    pendingCount: pending.length,
    failedCount: failed,
    oldestPendingMinutes: oldest ? Math.max(0, Math.floor((Date.now() - oldest) / 60000)) : null,
  };
}

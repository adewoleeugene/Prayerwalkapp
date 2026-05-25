import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import { OfflineQueueItem, SessionMap } from './offlineTypes';

const DB_NAME = 'prayerwalk-offline';
const DB_VERSION = 1;
const QUEUE_STORE = 'queue';
const SESSION_MAP_STORE = 'sessionMap';
const MAX_TRACK_POINTS = 20000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
          store.createIndex('status', 'status');
          store.createIndex('localSessionId', 'localSessionId');
          store.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(SESSION_MAP_STORE)) {
          db.createObjectStore(SESSION_MAP_STORE);
        }
      },
    });
  }
  return dbPromise;
}

export function createClientRequestId(type: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${type}_${Date.now().toString(36)}_${rand}`.slice(0, 64);
}

export async function loadQueue(): Promise<OfflineQueueItem[]> {
  const db = await getDb();
  const items = await db.getAll(QUEUE_STORE);
  return items.filter((item) => !!item && typeof item.id === 'string');
}

export async function saveQueue(queue: OfflineQueueItem[]): Promise<void> {
  const retained = applyRetention(queue);
  const db = await getDb();
  const tx = db.transaction(QUEUE_STORE, 'readwrite');
  await tx.store.clear();
  for (const item of retained) {
    await tx.store.put(item);
  }
  await tx.done;
}

export function applyRetention(queue: OfflineQueueItem[]): OfflineQueueItem[] {
  const nowMs = Date.now();
  const notExpired = queue.filter((item) => nowMs - new Date(item.createdAt).getTime() <= MAX_AGE_MS);
  const sorted = [...notExpired].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const tracks = sorted.filter((item) => item.type === 'track');
  if (tracks.length <= MAX_TRACK_POINTS) return sorted;

  let toDrop = tracks.length - MAX_TRACK_POINTS;
  return sorted.filter((item) => {
    if (item.type !== 'track') return true;
    if (toDrop <= 0) return true;
    toDrop -= 1;
    return false;
  });
}

export async function enqueueAction(item: Omit<OfflineQueueItem, 'attempts' | 'status'>): Promise<OfflineQueueItem> {
  const next: OfflineQueueItem = { ...item, attempts: 0, status: 'pending' };
  const db = await getDb();
  await db.put(QUEUE_STORE, next);
  return next;
}

export async function updateQueueItem(id: string, updater: (item: OfflineQueueItem) => OfflineQueueItem): Promise<void> {
  const db = await getDb();
  const item = await db.get(QUEUE_STORE, id);
  if (item) await db.put(QUEUE_STORE, updater(item));
}

export async function removeQueueItem(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(QUEUE_STORE, id);
}

export async function replaceQueue(items: OfflineQueueItem[]): Promise<void> {
  await saveQueue(items);
}

export async function loadSessionMap(): Promise<SessionMap> {
  const db = await getDb();
  const keys = await db.getAllKeys(SESSION_MAP_STORE);
  const map: SessionMap = {};
  for (const key of keys) {
    const val = await db.get(SESSION_MAP_STORE, key);
    if (typeof key === 'string' && typeof val === 'string') map[key] = val;
  }
  return map;
}

export async function saveSessionMap(map: SessionMap): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(SESSION_MAP_STORE, 'readwrite');
  await tx.store.clear();
  for (const [k, v] of Object.entries(map)) {
    await tx.store.put(v, k);
  }
  await tx.done;
}

export async function setSessionMapping(localSessionId: string, serverSessionId: string): Promise<void> {
  const db = await getDb();
  await db.put(SESSION_MAP_STORE, serverSessionId, localSessionId);
}

export async function resolveSessionId(sessionId: string): Promise<string | null> {
  if (!sessionId.startsWith('local_')) return sessionId;
  const db = await getDb();
  return (await db.get(SESSION_MAP_STORE, sessionId)) ?? null;
}

export async function rewriteQueueSessionIds(localSessionId: string, serverSessionId: string): Promise<void> {
  const queue = await loadQueue();
  const rewritten = queue.map((item) => {
    if (item.localSessionId !== localSessionId) return item;
    return { ...item, serverSessionId, payload: { ...item.payload, sessionId: serverSessionId } };
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

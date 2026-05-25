/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

// Background Sync — fires when connectivity is restored after a failed GPS flush.
// The SW can't access localStorage (fingerprint/token live there), so it delegates
// to the active PWA tab which already has the sync engine running.
self.addEventListener('sync', (event: SyncEvent) => {
  if (event.tag === 'gps-queue') {
    event.waitUntil(notifyClients({ type: 'BACKGROUND_SYNC' }));
  }
});

// Periodic Background Sync (Chrome/Edge 80+) — wakes the engine every ~15 min
// even when the PWA tab is in the background, ensuring old queued GPS points flush.
self.addEventListener('periodicsync', (event: PeriodicSyncEvent) => {
  if (event.tag === 'gps-periodic-sync') {
    event.waitUntil(notifyClients({ type: 'BACKGROUND_SYNC' }));
  }
});

async function notifyClients(message: Record<string, unknown>): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(message);
  }
}

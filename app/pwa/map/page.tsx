'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LocateFixed, ListOrdered, X } from 'lucide-react';
import { pwaApi } from '@/lib/pwa/apiClient';
import { useWalkTimer } from '@/hooks/useWalkTimer';
import { useGeolocation, getCurrentPosition } from '@/hooks/useGeolocation';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useVisibilityChange } from '@/hooks/useVisibilityChange';
import {
  calculateDistanceMeters,
  formatDuration,
  parseParticipantsLike,
} from '@/lib/pwa/geo';
import {
  startWalkOnlineOrQueue,
  trackWalkOnlineOrQueue,
  completeWalkOnlineOrQueue,
} from '@/lib/pwa/offlineWalkApi';
import {
  getSyncStatusSnapshot,
  startOfflineSyncEngine,
  stopOfflineSyncEngine,
  subscribeSyncStatus,
  triggerOfflineSync,
} from '@/lib/pwa/syncEngine';
import type { SyncStatus } from '@/lib/pwa/offlineTypes';
import type { LeafletMapHandle, LeafletMapMarker, LeafletMapPolyline } from '@/components/pwa/Map';
import { SyncBanner } from '@/components/pwa/SyncBanner';
import { WakeLockBanner } from '@/components/pwa/WakeLockBanner';

const Map = dynamic(() => import('@/components/pwa/Map'), { ssr: false });

const DEFAULT_CENTER = { latitude: 8.4657, longitude: -13.2317 };
const BRANCHES_CACHE_KEY = 'pwa_branches_cache_v1';
const ACTIVE_WALK_CACHE_KEY = 'pwa_active_walk_v1';

type WalkHistoryItem = {
  sessionId: string;
  branch: string;
  status: 'active' | 'completed' | 'abandoned';
  startedAt: string;
  endedAt?: string | null;
  durationSeconds: number;
  distanceMeters: number;
  startLocationName?: string | null;
  endLocationName?: string | null;
  prayerSummary?: string | null;
  prayerJournal?: string | null;
  walkType: 'all' | 'path' | 'area';
  geometryType: 'path' | 'spot';
  opacity: number;
  points: Array<{ latitude: number; longitude: number }>;
};

function isValidCoord(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function parseLocationCoords(raw: unknown): { latitude: number; longitude: number } | null {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length >= 2) {
    const lat = Number(raw[1]); const lng = Number(raw[0]);
    return isValidCoord(lat, lng) ? { latitude: lat, longitude: lng } : null;
  }
  const r = raw as Record<string, unknown>;
  const lat = Number(r?.latitude); const lng = Number(r?.longitude);
  return isValidCoord(lat, lng) ? { latitude: lat, longitude: lng } : null;
}

function toDurationLabel(s: number) {
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function toDistanceLabel(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}
function toHistoryLabel(walk: WalkHistoryItem) {
  const s = walk.startLocationName?.trim(); const e = walk.endLocationName?.trim();
  if (s && e) return s === e ? s : `${s} → ${e}`;
  return e || s || 'Prayer walk';
}

export default function MapPage() {
  const mapRef = useRef<LeafletMapHandle | null>(null);
  const { position, startTracking, stopTracking } = useGeolocation();
  const wakeLock = useWakeLock();
  const [gpsPaused, setGpsPaused] = useState(false);

  // Track where the map was last centered — used to debounce auto-panning during walks
  const lastCenterRef = useRef<{ latitude: number; longitude: number } | null>(null);
  // Track where we last fetched nearby data — avoid hammering API on GPS drift
  const lastFetchPosRef = useRef<{ latitude: number; longitude: number } | null>(null);

  const [locations, setLocations] = useState<unknown[]>([]);
  const [walkHistory, setWalkHistory] = useState<WalkHistoryItem[]>([]);
  const [daysFilter, setDaysFilter] = useState<1 | 7 | 30>(7);
  const hasFocusedHistory = useRef(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [targetLocation, setTargetLocation] = useState<Record<string, unknown> | null>(null);
  const [startBranch, setStartBranch] = useState('');
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [sortedBranches, setSortedBranches] = useState<string[]>([]);
  const [participantInput, setParticipantInput] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedWalk, setSelectedWalk] = useState<WalkHistoryItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [activeWalk, setActiveWalk] = useState<{
    sessionId: string; targetLocation: Record<string, unknown> | null;
    branch: string; participants: string[]; startedAt: string;
  } | null>(null);
  const [activeRoutePoints, setActiveRoutePoints] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [endWalkOpen, setEndWalkOpen] = useState(false);
  const [walkJournal, setWalkJournal] = useState('');
  const [isEndingWalk, setIsEndingWalk] = useState(false);
  const [stoppedElapsed, setStoppedElapsed] = useState<number | null>(null);
  const elapsedSeconds = useWalkTimer(activeWalk?.startedAt, Boolean(activeWalk) && stoppedElapsed === null);

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatusSnapshot());
  const [error, setError] = useState<string | null>(null);

  // Offline sync engine lifecycle
  useEffect(() => {
    void startOfflineSyncEngine();
    const unsub = subscribeSyncStatus(setSyncStatus);
    return () => { unsub(); stopOfflineSyncEngine(); };
  }, []);

  // Restore active walk from localStorage on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem(ACTIVE_WALK_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.sessionId && parsed?.startedAt) setActiveWalk(parsed);
      }
    } catch { /* ignore */ }

    try {
      const cachedBranches = localStorage.getItem(BRANCHES_CACHE_KEY);
      if (cachedBranches) {
        const parsed = JSON.parse(cachedBranches);
        if (Array.isArray(parsed)) applyBranchState(parsed.map(String));
      }
    } catch { /* ignore */ }
  }, []);

  // Request GPS on mount
  // navigator.permissions is undefined in Safari < 16 — guard before use.
  // The .catch() only handles Promise rejections, NOT synchronous TypeErrors,
  // so accessing an undefined .permissions would throw and crash the page.
  useEffect(() => {
    if (!navigator.geolocation) { setError('Geolocation not supported'); return; }
    if (!navigator.permissions) { startTracking(); return; }
    navigator.permissions.query({ name: 'geolocation' }).then((result) => {
      if (result.state !== 'denied') startTracking();
    }).catch(() => startTracking());
  }, [startTracking]);

  // Walk tracking loop — runs GPS when there's an active walk
  useEffect(() => {
    if (!activeWalk) { stopTracking(); setActiveRoutePoints([]); lastCenterRef.current = null; return; }
    startTracking();

    if (position) {
      const startPt = { latitude: position.latitude, longitude: position.longitude };
      setActiveRoutePoints([startPt]);
      lastCenterRef.current = startPt;
      mapRef.current?.centerOn(startPt, 17);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWalk?.sessionId]);

  // Track GPS points during active walk
  useEffect(() => {
    if (!activeWalk || !position) return;

    // Skip low-accuracy fixes — Android drift with 40–80 m accuracy still causes
    // the route to grow and the map to pan while the user is standing still.
    if (position.accuracy > 35) return;

    const nextPoint = { latitude: position.latitude, longitude: position.longitude };

    setActiveRoutePoints((prev) => {
      if (prev.length === 0) return [nextPoint];
      const last = prev[prev.length - 1];
      // 8 m threshold — Android can drift 3–6 m standing still with a good fix
      if (calculateDistanceMeters(last, nextPoint) < 8) return prev;
      return [...prev, nextPoint];
    });

    // Only pan the map when the user has actually moved > 15 m from the last
    // center point — prevents the map from jumping on every GPS tick
    const lastCenter = lastCenterRef.current;
    if (!lastCenter || calculateDistanceMeters(lastCenter, nextPoint) > 15) {
      lastCenterRef.current = nextPoint;
      mapRef.current?.centerOn(nextPoint);
    }

    void trackWalkOnlineOrQueue({
      sessionId: activeWalk.sessionId,
      latitude: position.latitude,
      longitude: position.longitude,
      speed: position.speed ?? undefined,
      accuracy: position.accuracy,
    }).catch(() => { /* queue handles it */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);

  // WakeLock management — acquire when walk starts
  useEffect(() => {
    if (activeWalk) { void wakeLock.acquire(); }
    else { void wakeLock.release(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWalk?.sessionId]);

  // Handle screen going hidden during active walk
  useVisibilityChange({
    onHidden: () => {
      if (!activeWalk) return;
      setGpsPaused(true);
      // Notification is undefined on iOS Safari (non-PWA) — guard before use
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Walk paused', {
          body: 'Tap to resume GPS tracking',
          icon: '/icons/icon-192.png',
          requireInteraction: true,
        });
      }
    },
    onVisible: () => {
      if (!activeWalk) return;
      setGpsPaused(false);
      void wakeLock.acquire();
    },
  });

  // Fit map to history on first load
  useEffect(() => {
    if (activeWalk || walkHistory.length === 0 || hasFocusedHistory.current) return;
    const pts = walkHistory.flatMap((w) => w.points);
    if (position) pts.push({ latitude: position.latitude, longitude: position.longitude });
    if (pts.length < 2) return;
    hasFocusedHistory.current = true;
    setTimeout(() => mapRef.current?.fitToCoordinates(pts), 600);
  }, [walkHistory, position, activeWalk]);

  // Fetch data
  useEffect(() => {
    hasFocusedHistory.current = false;
    void fetchWalkHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysFilter]);

  useEffect(() => {
    const t = setInterval(() => void fetchWalkHistory(), 25000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysFilter]);

  useEffect(() => {
    if (!position) return;
    const newPos = { latitude: position.latitude, longitude: position.longitude };
    const lastFetch = lastFetchPosRef.current;
    // Only re-fetch when we've moved at least 150 m — prevents hammering the API
    // on GPS drift (which can report ±10 m changes while standing still)
    if (lastFetch && calculateDistanceMeters(lastFetch, newPos) < 150) return;
    lastFetchPosRef.current = newPos;
    void fetchBranches(position.latitude, position.longitude);
    void fetchNearbyLocations(position.latitude, position.longitude);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.latitude, position?.longitude]);

  // Request notification permission when walk starts
  // Notification is undefined on iOS Safari (non-PWA mode) — guard before use
  useEffect(() => {
    if (activeWalk && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, [activeWalk]);

  // Background Sync API — register one-shot sync tag when walk is active
  // The SW will fire a `sync` event on next connectivity, triggering triggerOfflineSync
  useEffect(() => {
    if (!activeWalk || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then((reg) => {
      if ('sync' in reg) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        void (reg as any).sync.register('gps-queue');
      }
      if ('periodicSync' in reg) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        void (reg as any).periodicSync.register('gps-periodic-sync', { minInterval: 15 * 60 * 1000 });
      }
    }).catch(() => { /* not supported */ });
  }, [activeWalk?.sessionId]);

  // Service worker message listener — handles BACKGROUND_SYNC posted from worker/index.ts
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      if ((event.data as Record<string, unknown>)?.type === 'BACKGROUND_SYNC') {
        void triggerOfflineSync('sw-background');
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);

  function applyBranchState(names: string[]) {
    const deduped = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const list = deduped.length > 0 ? deduped : ['International'];
    setSortedBranches(list);
    setStartBranch((prev) => (prev && list.includes(prev) ? prev : list[0]));
  }

  async function fetchBranches(lat?: number, lng?: number) {
    try {
      const res = lat && lng
        ? await pwaApi.branches.list(lat, lng, 80000)
        : await pwaApi.branches.list();
      const data = res.data as Record<string, unknown>;
      const branches = Array.isArray(data?.branches) ? (data.branches as unknown[]) : [];
      if (branches.length > 0) {
        const names = branches.map((b) => String((b as Record<string, unknown>).name));
        applyBranchState(names);
        localStorage.setItem(BRANCHES_CACHE_KEY, JSON.stringify(names));
      }
    } catch {
      const cached = localStorage.getItem(BRANCHES_CACHE_KEY);
      if (cached) {
        try { applyBranchState(JSON.parse(cached)); } catch { /* ignore */ }
      } else {
        applyBranchState(['International']);
      }
    }
  }

  async function fetchNearbyLocations(lat: number, lng: number) {
    try {
      const res = await pwaApi.locations.list(lat, lng, 5000);
      const data = res.data as Record<string, unknown>;
      const list = (Array.isArray(data?.locations) ? data.locations : []) as unknown[];
      setLocations(list.filter((loc) => {
        const l = loc as Record<string, unknown>;
        const coords = parseLocationCoords((l.location as Record<string, unknown>)?.coordinates ?? l.location);
        return Boolean(coords);
      }));
    } catch { /* ignore */ }
  }

  async function fetchWalkHistory() {
    try {
      const res = await pwaApi.walks.history(300, { days: daysFilter });
      const data = res.data as Record<string, unknown>;
      const rows = (Array.isArray(data?.routes) ? data.routes : []) as Record<string, unknown>[];
      setWalkHistory(
        rows.map((item) => ({
          sessionId: String(item.sessionId),
          branch: String(item.branch || 'Unknown'),
          status: (['active', 'abandoned'].includes(String(item.status)) ? item.status : 'completed') as WalkHistoryItem['status'],
          startedAt: String(item.startedAt || new Date().toISOString()),
          endedAt: item.endedAt ? String(item.endedAt) : null,
          durationSeconds: Number(item.durationSeconds || 0),
          distanceMeters: Number(item.distanceMeters || 0),
          startLocationName: item.startLocationName ? String(item.startLocationName) : null,
          endLocationName: item.endLocationName ? String(item.endLocationName) : null,
          prayerSummary: item.prayerSummary ? String(item.prayerSummary) : null,
          prayerJournal: item.prayerJournal ? String(item.prayerJournal) : null,
          walkType: (item.walkType === 'area' ? 'area' : 'path') as WalkHistoryItem['walkType'],
          geometryType: (item.geometryType === 'spot' ? 'spot' : 'path') as WalkHistoryItem['geometryType'],
          opacity: Number(item.opacity ?? 0.5),
          points: (Array.isArray(item.points) ? item.points : [])
            .map((p) => parseLocationCoords(p as unknown))
            .filter((p) => p !== null) as Array<{ latitude: number; longitude: number }>,
        })).filter((w) => w.points.length > 0)
      );
    } catch { /* ignore */ }
  }

  async function recenter() {
    try {
      const pos = await getCurrentPosition();
      mapRef.current?.centerOn({ latitude: pos.latitude, longitude: pos.longitude }, 17);
    } catch { /* ignore */ }
  }

  async function confirmStartWalk() {
    if (!position) { setError('Waiting for GPS…'); return; }
    if (activeWalk) { setError('End the current walk first.'); return; }
    const branch = startBranch || sortedBranches[0] || 'International';
    const pendingInput = participantInput.trim();
    const allParticipants = pendingInput ? [...participants, pendingInput] : participants;
    const normalizedParticipants = allParticipants.length > 0 ? allParticipants : ['Prayer Team'];
    try {
      const res = await startWalkOnlineOrQueue({
        locationId: targetLocation?.id as string | undefined,
        latitude: position.latitude,
        longitude: position.longitude,
        branch,
        participants: normalizedParticipants,
      });
      setDrawerOpen(false);
      setParticipants([]); setParticipantInput('');
      const data = res.data as Record<string, unknown>;
      if (data.success) {
        const session = data.session as Record<string, unknown>;
        const next = {
          sessionId: String(session?.id),
          targetLocation: targetLocation,
          branch: String(session?.branch || branch),
          participants: parseParticipantsLike(session?.participants || normalizedParticipants),
          startedAt: String(session?.startTime || new Date().toISOString()),
        };
        setActiveWalk(next);
        localStorage.setItem(ACTIVE_WALK_CACHE_KEY, JSON.stringify(next));
        void fetchWalkHistory();
      } else {
        setError(String((data as Record<string, unknown>)?.error || 'Could not start walk'));
      }
    } catch (e: unknown) {
      const err = e as Record<string, unknown>;
      const msg = ((err?.response as Record<string, unknown>)?.data as Record<string, unknown>)?.error
        ?? (err as Record<string, unknown>)?.message ?? 'Failed to start walk';
      setError(String(msg));
    }
  }

  async function completeWalk(includeJournal: boolean) {
    if (!activeWalk || isEndingWalk) return;
    setIsEndingWalk(true);
    try {
      const pos = position ?? await getCurrentPosition().catch(() => null);
      if (!pos) { setError('Location unavailable'); setIsEndingWalk(false); return; }
      const res = await completeWalkOnlineOrQueue({
        sessionId: activeWalk.sessionId,
        locationId: (activeWalk.targetLocation?.id as string) ?? undefined,
        latitude: pos.latitude,
        longitude: pos.longitude,
        prayerJournal: includeJournal && walkJournal.trim() ? walkJournal.trim() : undefined,
      });
      const data = res.data as Record<string, unknown>;
      if (!data?.success) { throw new Error(String(data?.error || 'Failed to complete walk')); }
      setEndWalkOpen(false);
      setWalkJournal('');
      setActiveWalk(null);
      setActiveRoutePoints([]);
      setStoppedElapsed(null);
      localStorage.removeItem(ACTIVE_WALK_CACHE_KEY);
      stopTracking();
      void fetchWalkHistory();
    } catch (e: unknown) {
      const err = e as Record<string, unknown>;
      setError(String(
        ((err?.response as Record<string, unknown>)?.data as Record<string, unknown>)?.error
        ?? err?.message ?? 'Failed to complete walk'
      ));
    } finally {
      setIsEndingWalk(false);
    }
  }

  // Build map layers
  const center = position
    ? { latitude: position.latitude, longitude: position.longitude }
    : DEFAULT_CENTER;

  const mapMarkers: LeafletMapMarker[] = [];
  if (position) {
    mapMarkers.push({ id: 'user-location', latitude: position.latitude, longitude: position.longitude, title: 'Your location', color: '#2563EB' });
  }
  if (!activeWalk) {
    walkHistory.forEach((walk) => {
      const pt = walk.geometryType === 'path' ? walk.points[walk.points.length - 1] : walk.points[0];
      if (!pt) return;
      mapMarkers.push({ id: `history-${walk.sessionId}`, latitude: pt.latitude, longitude: pt.longitude, title: toHistoryLabel(walk), description: `${toDurationLabel(walk.durationSeconds)} • ${toDistanceLabel(walk.distanceMeters)}`, color: walk.walkType === 'area' ? '#1C7ED6' : '#E03131' });
    });
  }
  (locations as Record<string, unknown>[]).forEach((loc) => {
    const coord = parseLocationCoords((loc.location as Record<string, unknown>)?.coordinates ?? loc.location);
    if (!coord) return;
    mapMarkers.push({ id: `location-${loc.id}`, latitude: coord.latitude, longitude: coord.longitude, title: String(loc.name), description: 'Tap to begin prayer walk', color: '#16A34A' });
  });

  const mapPolylines: LeafletMapPolyline[] = [];
  if (activeWalk && activeRoutePoints.length >= 3) {
    mapPolylines.push({ id: 'active-route', coordinates: activeRoutePoints, color: 'rgba(16, 185, 129, 0.95)', width: 7 });
  }
  if (!activeWalk) {
    walkHistory.filter((w) => w.geometryType === 'path' && w.points.length >= 3).forEach((walk) => {
      const o = Math.max(0.18, Math.min(1, walk.opacity || 0.5));
      mapPolylines.push({ id: `history-line-${walk.sessionId}`, coordinates: walk.points, color: walk.walkType === 'area' ? `rgba(38,132,255,${o})` : `rgba(255,59,48,${o})`, width: 7 });
    });
  }

  function handleMarkerPress(id: string) {
    if (id.startsWith('location-')) {
      const locId = id.replace('location-', '');
      const loc = (locations as Record<string, unknown>[]).find((l) => String(l.id) === locId);
      if (loc) { setTargetLocation(loc); setDrawerOpen(true); }
    } else if (id.startsWith('history-')) {
      const sessionId = id.replace('history-', '');
      const walk = walkHistory.find((w) => w.sessionId === sessionId);
      if (walk) { setSelectedWalk(walk); setDetailOpen(true); }
    }
  }

  function handlePolylinePress(id: string) {
    const sessionId = id.replace('history-line-', '');
    const walk = walkHistory.find((w) => w.sessionId === sessionId);
    if (walk) { setSelectedWalk(walk); setDetailOpen(true); }
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-900">
      {/* Map — z-0 creates a stacking context so Leaflet's 400–700 z-indices stay contained */}
      <div className="absolute inset-0 z-0">
        <Map
          ref={mapRef}
          initialCenter={center}
          initialZoom={13}
          markers={mapMarkers}
          polylines={mapPolylines}
          onMarkerPress={handleMarkerPress}
          className="h-full w-full"
        />
      </div>

      {/* Status row */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 pointer-events-none">
        {activeWalk && <WakeLockBanner isActive={wakeLock.isActive && !gpsPaused} onDismiss={gpsPaused ? () => { setGpsPaused(false); void wakeLock.acquire(); } : undefined} />}
        <div className="pointer-events-auto"><SyncBanner status={syncStatus} /></div>
      </div>

      {/* Error toast */}
      {error && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 bg-red-600 text-white text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2 max-w-xs text-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-1 opacity-80 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Filter chips */}
      <div className="absolute top-12 left-3 right-3 z-10 flex items-center gap-2">
        {([1, 7, 30] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDaysFilter(d)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              daysFilter === d
                ? 'bg-blue-700 border-blue-700 text-white'
                : 'bg-white/90 border-slate-200 text-slate-800'
            }`}
          >
            {d === 1 ? 'Today' : `${d} days`}
          </button>
        ))}
        <span className="ml-auto bg-white/90 text-slate-700 text-xs font-semibold px-2 py-1 rounded-full border border-slate-200">
          {walkHistory.length} walks
        </span>
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-10 left-4 right-4 z-10 flex justify-between items-end">
        <div className="flex flex-col gap-2">
          <button onClick={() => setSidebarOpen(true)} className="w-11 h-11 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-lg">
            <ListOrdered size={20} className="text-slate-700" strokeWidth={2.25} />
          </button>
          <button onClick={() => void recenter()} className="w-11 h-11 rounded-full bg-white border border-blue-200 flex items-center justify-center shadow-lg">
            <LocateFixed size={22} className="text-blue-500" strokeWidth={2.25} />
          </button>
        </div>

        {activeWalk ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl px-4 py-3 flex flex-col items-center gap-2 min-w-[180px]">
            <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Walk in progress</div>
            <div className="text-2xl font-bold text-blue-700 tabular-nums">{formatDuration(stoppedElapsed ?? elapsedSeconds)}</div>
            {activeWalk.participants.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-center">
                {activeWalk.participants.map((p, i) => (
                  <span key={i} className="bg-blue-50 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">{p}</span>
                ))}
              </div>
            )}
            <button
              onClick={() => { setStoppedElapsed(elapsedSeconds); setEndWalkOpen(true); }}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-sm rounded-xl py-2.5 transition-colors"
            >
              End Walk
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setTargetLocation(null); setDrawerOpen(true); }}
            className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-base px-6 py-4 rounded-full shadow-xl transition-colors"
          >
            Start Prayer Walk
          </button>
        )}
      </div>

      {/* Start Walk Drawer */}
      <div
        className={`absolute inset-x-0 bottom-0 z-30 bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 ${
          drawerOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ maxHeight: '80vh', overflowY: 'auto' }}
      >
        {drawerOpen && (
          <>
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1.5 bg-slate-200 rounded-full" />
            </div>
            <div className="text-center text-2xl font-bold text-slate-800 py-3">
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="px-5 pb-8 space-y-4">
              {/* Branch row */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <span className="text-sm font-bold text-slate-600">Branch</span>
                <button
                  onClick={() => setBranchPickerOpen(true)}
                  className="text-sm text-slate-800 font-medium"
                >
                  {startBranch || 'Select Branch'} ›
                </button>
              </div>
              {/* Location row */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <span className="text-sm font-bold text-slate-600">Location</span>
                <span className="text-sm text-slate-700 text-right max-w-[60%] truncate">
                  {targetLocation ? String(targetLocation.address || targetLocation.name || 'Selected location') : 'Current location'}
                </span>
              </div>
              {/* Team row */}
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-slate-600">Team</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add name…"
                    value={participantInput}
                    onChange={(e) => setParticipantInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (participantInput.trim()) { setParticipants([...participants, participantInput.trim()]); setParticipantInput(''); } } }}
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50"
                  />
                  <button
                    onClick={() => { if (participantInput.trim()) { setParticipants([...participants, participantInput.trim()]); setParticipantInput(''); } }}
                    className="w-9 h-9 rounded-full bg-slate-100 text-indigo-500 text-xl font-bold flex items-center justify-center"
                  >
                    +
                  </button>
                </div>
                {participants.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {participants.map((p, i) => (
                      <button key={i} onClick={() => setParticipants(participants.filter((_, j) => j !== i))} className="bg-blue-50 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                        {p} ✕
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setDrawerOpen(false)} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm">Cancel</button>
                <button onClick={() => void confirmStartWalk()} className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-sm transition-colors">
                  Start Walk
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {drawerOpen && <div onClick={() => setDrawerOpen(false)} className="absolute inset-0 z-20 bg-black/40" />}

      {/* Branch picker modal */}
      {branchPickerOpen && (
        <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm max-h-[70vh] flex flex-col shadow-2xl">
            <div className="p-5 border-b border-slate-100 text-center font-bold text-lg text-slate-800">Select Branch</div>
            <div className="overflow-y-auto flex-1">
              {sortedBranches.map((b) => (
                <button key={b} onClick={() => { setStartBranch(b); setBranchPickerOpen(false); }} className={`w-full px-5 py-4 text-center border-b border-slate-100 text-sm ${b === startBranch ? 'text-indigo-600 font-bold' : 'text-slate-700'}`}>
                  {b}
                </button>
              ))}
            </div>
            <button onClick={() => setBranchPickerOpen(false)} className="p-4 text-slate-500 font-semibold text-sm border-t border-slate-100">Cancel</button>
          </div>
        </div>
      )}

      {/* End walk modal */}
      {endWalkOpen && (
        <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-5">
            <h2 className="text-lg font-bold text-slate-800 mb-3">Journal (Optional)</h2>
            <textarea
              className="w-full min-h-[120px] border border-slate-200 rounded-xl p-3 text-sm text-slate-800 bg-slate-50 resize-none"
              placeholder="Write about your walk…"
              value={walkJournal}
              onChange={(e) => setWalkJournal(e.target.value)}
              maxLength={2000}
            />
            <div className="flex gap-3 mt-4">
              <button onClick={() => void completeWalk(false)} disabled={isEndingWalk} className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm disabled:opacity-50">
                {isEndingWalk ? 'Ending…' : 'Skip'}
              </button>
              <button onClick={() => void completeWalk(true)} disabled={isEndingWalk} className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition-colors disabled:opacity-50">
                {isEndingWalk ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Walk history sidebar */}
      <div className={`absolute inset-y-0 right-0 z-40 w-80 max-w-[82vw] bg-white shadow-2xl flex flex-col transition-transform duration-240 ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 pt-6">
          <div>
            <div className="text-lg font-bold text-slate-800">Your Walks</div>
            <div className="text-xs text-slate-500 mt-0.5">{walkHistory.length} {walkHistory.length === 1 ? 'walk' : 'walks'} on this device</div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-full bg-slate-100">
            <X size={20} className="text-slate-600" strokeWidth={2.25} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {walkHistory.length === 0 ? (
            <div className="text-center text-slate-400 text-sm pt-8">No walks yet. Start your first one!</div>
          ) : (
            [...walkHistory].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).map((walk) => (
              <button
                key={walk.sessionId}
                onClick={() => { setSelectedWalk(walk); setDetailOpen(true); setSidebarOpen(false); }}
                className="w-full text-left bg-slate-50 border border-slate-200 rounded-xl p-3.5"
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-bold text-slate-800 truncate mr-2">{toHistoryLabel(walk)}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${walk.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                    {walk.status === 'active' ? 'Active' : walk.walkType === 'area' ? 'Area' : 'Path'}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mb-0.5">{new Date(walk.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                <div className="text-xs text-slate-500">{toDurationLabel(walk.durationSeconds)} · {toDistanceLabel(walk.distanceMeters)} · {walk.branch}</div>
              </button>
            ))
          )}
        </div>
      </div>
      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} className="absolute inset-0 z-[39] bg-slate-900/40" />}

      {/* Walk detail bottom sheet */}
      {detailOpen && selectedWalk && (
        <>
          <div onClick={() => setDetailOpen(false)} className="absolute inset-0 z-40 bg-black/40" />
          <div className="absolute inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl px-5 pt-3 pb-8 max-h-[70vh] overflow-y-auto">
            <div className="flex justify-center mb-3"><div className="w-10 h-1.5 bg-slate-200 rounded-full" /></div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">{toHistoryLabel(selectedWalk)}</h2>
            <p className="text-sm text-slate-500 mb-1">{new Date(selectedWalk.startedAt).toLocaleString()}</p>
            <p className="text-sm text-slate-600 mb-1">Duration {toDurationLabel(selectedWalk.durationSeconds)} · Distance {toDistanceLabel(selectedWalk.distanceMeters)}</p>
            <p className="text-sm text-slate-600 mb-3">Branch {selectedWalk.branch}</p>
            {selectedWalk.prayerSummary && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3">
                <div className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wide">Prayer Summary</div>
                <div className="text-sm text-slate-800 leading-relaxed">{selectedWalk.prayerSummary}</div>
              </div>
            )}
            {selectedWalk.prayerJournal && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3">
                <div className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wide">Journal</div>
                <div className="text-sm text-slate-800 leading-relaxed">{selectedWalk.prayerJournal}</div>
              </div>
            )}
            <button onClick={() => setDetailOpen(false)} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl mt-2">Close</button>
          </div>
        </>
      )}
    </div>
  );
}

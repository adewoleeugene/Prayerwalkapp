'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { pwaApi } from '@/lib/pwa/apiClient';

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
  prayerFocus: string;
};

type DaysFilter = 1 | 7 | 30 | 90;

function toDuration(s: number) {
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`; if (m === 0) return '< 1m'; return `${m}m`;
}
function toDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}
function toLabel(walk: WalkHistoryItem) {
  const s = walk.startLocationName?.trim(); const e = walk.endLocationName?.trim();
  if (s && e && s !== e) return `${s} → ${e}`;
  return e ?? s ?? walk.prayerFocus ?? 'Prayer Walk';
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700',
  active: 'bg-blue-100 text-blue-700',
  abandoned: 'bg-slate-100 text-slate-500',
};
const STATUS_LABELS: Record<string, string> = { completed: 'Completed', active: 'Active', abandoned: 'Abandoned' };

function DetailSheet({ walk, onClose }: { walk: WalkHistoryItem; onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} className="absolute inset-0 z-40 bg-black/45" />
      <div className="absolute inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl p-5 pb-8 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-center mb-4"><div className="w-10 h-1.5 bg-slate-200 rounded-full" /></div>
        <div className="text-lg font-bold text-slate-800 mb-1.5">{toLabel(walk)}</div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLES[walk.status] ?? STATUS_STYLES.completed}`}>
          {STATUS_LABELS[walk.status] ?? 'Completed'}
        </span>
        <p className="text-sm text-slate-400 mt-3 mb-4">
          {new Date(walk.startedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
        <div className="flex bg-slate-50 rounded-xl divide-x divide-slate-200 mb-4">
          {[
            { label: 'Duration', value: toDuration(walk.durationSeconds) },
            { label: 'Distance', value: toDistance(walk.distanceMeters) },
            { label: 'Branch', value: walk.branch || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex-1 py-3 text-center">
              <div className="text-sm font-bold text-slate-800">{value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
        {walk.prayerSummary && (
          <div className="border-l-4 border-indigo-500 bg-indigo-50 rounded-r-lg p-3 mb-3">
            <div className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-1.5">Prayer Summary</div>
            <p className="text-sm text-slate-700 leading-relaxed">{walk.prayerSummary}</p>
          </div>
        )}
        {walk.prayerJournal && (
          <div className="border-l-4 border-emerald-500 bg-emerald-50 rounded-r-lg p-3 mb-3">
            <div className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-1.5">Walk Journal</div>
            <p className="text-sm text-slate-700 leading-relaxed">{walk.prayerJournal}</p>
          </div>
        )}
        <button onClick={onClose} className="w-full py-3 bg-slate-100 text-slate-700 font-semibold rounded-xl mt-2">Close</button>
      </div>
    </>
  );
}

export default function HistoryPage() {
  const [walks, setWalks] = useState<WalkHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(7);
  const [selected, setSelected] = useState<WalkHistoryItem | null>(null);

  const fetchHistory = useCallback(async (days: DaysFilter, isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await pwaApi.walks.history(300, { days });
      const data = res.data as Record<string, unknown>;
      const rows = (Array.isArray(data?.routes) ? data.routes : []) as Record<string, unknown>[];
      setWalks(
        rows
          .filter((r) => r.status !== 'active')
          .map((r) => ({
            sessionId: String(r.sessionId),
            branch: String(r.branch || 'Unknown'),
            status: (['active', 'abandoned'].includes(String(r.status)) ? r.status : 'completed') as WalkHistoryItem['status'],
            startedAt: String(r.startedAt || new Date().toISOString()),
            endedAt: r.endedAt ? String(r.endedAt) : null,
            durationSeconds: Number(r.durationSeconds || 0),
            distanceMeters: Number(r.distanceMeters || 0),
            startLocationName: r.startLocationName ? String(r.startLocationName) : null,
            endLocationName: r.endLocationName ? String(r.endLocationName) : null,
            prayerSummary: r.prayerSummary ? String(r.prayerSummary) : null,
            prayerJournal: r.prayerJournal ? String(r.prayerJournal) : null,
            prayerFocus: String(r.prayerFocus || 'Prayer Walk'),
          }))
      );
    } catch { /* keep existing */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void fetchHistory(daysFilter); }, [daysFilter, fetchHistory]);

  const filters: { label: string; value: DaysFilter }[] = [
    { label: 'Today', value: 1 },
    { label: '7 days', value: 7 },
    { label: '30 days', value: 30 },
    { label: 'All', value: 90 },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-white border-b border-slate-200 px-4 pt-4 pb-3">
        <Link href="/pwa/map" className="w-14 text-indigo-500 font-semibold text-sm flex items-center gap-1">
          <ArrowLeft size={16} /> Map
        </Link>
        <span className="flex-1 text-center text-base font-bold text-slate-800">Walk History</span>
        <div className="w-14" />
      </div>

      {/* Filters */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b border-slate-100">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setDaysFilter(f.value)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              daysFilter === f.value ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={() => void fetchHistory(daysFilter, true)}
          className="ml-auto text-sm text-indigo-500 font-semibold disabled:opacity-50"
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 pb-8 relative">
        {loading ? (
          <div className="flex justify-center pt-16">
            <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : walks.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-16 gap-2">
            <p className="text-slate-700 font-semibold">No walks recorded yet.</p>
            <p className="text-slate-400 text-sm text-center">Start a prayer walk from the map to see history here.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-400 font-medium mb-3">{walks.length} walk{walks.length !== 1 ? 's' : ''}</p>
            <div className="space-y-3">
              {walks.map((walk) => (
                <button
                  key={walk.sessionId}
                  onClick={() => setSelected(walk)}
                  className="w-full text-left bg-white rounded-xl border border-slate-200 p-4 shadow-sm"
                >
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <span className="text-sm font-bold text-slate-800 leading-snug">{toLabel(walk)}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[walk.status] ?? STATUS_STYLES.completed}`}>
                      {STATUS_LABELS[walk.status] ?? 'Completed'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mb-2">
                    {new Date(walk.startedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                    <span>⏱ {toDuration(walk.durationSeconds)}</span>
                    <span className="text-slate-200">·</span>
                    <span>📍 {toDistance(walk.distanceMeters)}</span>
                    <span className="text-slate-200">·</span>
                    <span>{walk.branch}</span>
                  </div>
                  {walk.prayerSummary && (
                    <p className="text-xs text-slate-400 mt-2 line-clamp-2 italic">{walk.prayerSummary}</p>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Detail sheet */}
        {selected && <DetailSheet walk={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

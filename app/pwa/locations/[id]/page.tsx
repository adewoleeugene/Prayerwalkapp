'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, MapPin, Navigation, Star } from 'lucide-react';
import { pwaApi } from '@/lib/pwa/apiClient';

type Location = Record<string, unknown>;

export default function LocationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pwaApi.locations.get(id)
      .then((res) => {
        const data = res.data as Record<string, unknown>;
        setLocation((data.location ?? data) as Location);
      })
      .catch(() => setLocation(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-50">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!location) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 gap-4 p-6">
        <p className="text-slate-500 text-base">Location not found.</p>
        <Link href="/pwa/map" className="px-5 py-2.5 bg-slate-100 text-slate-700 font-semibold rounded-xl">Go Back</Link>
      </div>
    );
  }

  const difficulty = String(location.difficulty ?? 'easy');
  const difficultyStyles: Record<string, string> = {
    easy: 'bg-emerald-100 text-emerald-700',
    medium: 'bg-yellow-100 text-yellow-700',
    hard: 'bg-red-100 text-red-700',
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-white border-b border-slate-200 px-4 pt-4 pb-3">
        <button onClick={() => router.back()} className="w-14 text-indigo-500 font-semibold text-sm flex items-center gap-1">
          <ArrowLeft size={16} /> Back
        </button>
        <span className="flex-1 text-center text-base font-bold text-slate-800 truncate px-2">
          {String(location.name ?? 'Location')}
        </span>
        <div className="w-14" />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 pb-32">
        {/* Meta badges */}
        <div className="flex flex-wrap gap-2 mb-4">
          {!!location.category && (
            <span className="bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full">
              {String(location.category)}
            </span>
          )}
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${difficultyStyles[difficulty] ?? difficultyStyles.easy}`}>
            {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
          </span>
          <span className="flex items-center gap-1 bg-amber-50 text-amber-700 text-xs font-semibold px-3 py-1 rounded-full">
            <Star size={11} />
            {String(location.points ?? 10)} pts
          </span>
        </div>

        {/* Address */}
        {!!location.address && (
          <div className="flex items-start gap-2 mb-5 text-sm text-slate-500">
            <MapPin size={14} className="shrink-0 mt-0.5" />
            <span>{String(location.address)}</span>
          </div>
        )}

        {/* Description */}
        {!!location.description && (
          <div className="mb-5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">About this location</p>
            <p className="text-sm text-slate-700 leading-relaxed">{String(location.description)}</p>
          </div>
        )}

        {/* Prayer text */}
        {!!(location.prayerText || location.prayer_text) && (
          <div className="border-l-4 border-indigo-500 bg-indigo-50 rounded-r-lg p-4 mb-5">
            <p className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-2">Prayer Focus</p>
            <p className="text-sm text-indigo-900 leading-relaxed italic">
              {String(location.prayerText ?? location.prayer_text)}
            </p>
          </div>
        )}

        {/* Radius info */}
        <div className="flex items-start gap-2 bg-slate-100 rounded-xl p-3 text-sm text-slate-500">
          <Navigation size={14} className="shrink-0 mt-0.5" />
          <span>Walk within {String(location.radiusMeters ?? location.radius_meters ?? 50)}m of this location to complete it</span>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="absolute inset-x-0 bottom-0 bg-white border-t border-slate-200 p-4 pb-6">
        <Link
          href={`/pwa/map?locationId=${id}`}
          className="block w-full py-4 bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-center rounded-2xl transition-colors shadow-md"
        >
          Start Prayer Walk Here
        </Link>
      </div>
    </div>
  );
}

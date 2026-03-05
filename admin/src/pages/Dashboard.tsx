import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import {
    MapPin, Navigation, Search, RefreshCcw, Timer,
    Activity, ChevronRight, ChevronLeft,
    FileText, AlertTriangle,
    Building2, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GoogleMap, MarkerF, PolylineF, CircleF, useJsApiLoader } from '@react-google-maps/api';
import { useDashboardData } from '@/features/dashboard/hooks/useDashboardData';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const mapContainerStyle = { height: '100%', width: '100%' };

function getWalkTrackPoints(walk: any): Array<{ lat: number; lng: number }> {
    const rawPoints = Array.isArray(walk?.points) ? walk.points : [];
    const parsedPoints = rawPoints
        .filter((p: any) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude))
        .map((p: any) => ({ lat: Number(p.latitude), lng: Number(p.longitude) }));

    // For low-quality routes (fallback/synthesized), still show a simple path when movement exists.
    if (walk?.routeQuality === 'low') {
        if (parsedPoints.length >= 2) {
            const start = parsedPoints[0];
            const end = parsedPoints[parsedPoints.length - 1];
            if (start.lat !== end.lat || start.lng !== end.lng) {
                return parsedPoints;
            }
        }
        return [];
    }
    return parsedPoints;
}

function getWalkIdentity(walk: any): string {
    if (!walk) return '';
    if (typeof walk.sessionId === 'string' && walk.sessionId.trim()) return `session:${walk.sessionId}`;
    if (typeof walk.id === 'string' && walk.id.trim()) return `id:${walk.id}`;

    const startedAtMs = walk.startedAt ? Date.parse(String(walk.startedAt)) : NaN;
    const endedAtMs = walk.endedAt ? Date.parse(String(walk.endedAt)) : NaN;
    const startedAt = Number.isFinite(startedAtMs) ? String(startedAtMs) : '';
    const endedAt = Number.isFinite(endedAtMs) ? String(endedAtMs) : '';
    const walker = Array.isArray(walk.participantNames) && walk.participantNames.length > 0
        ? walk.participantNames.join('|')
        : (walk.participants || walk.walkerDisplayName || walk.userId || '');
    const startName = walk.startLocationName || '';
    const endName = walk.endLocationName || '';
    const startLat = walk.startLocation?.latitude != null ? String(walk.startLocation.latitude) : '';
    const startLng = walk.startLocation?.longitude != null ? String(walk.startLocation.longitude) : '';

    return `fallback:${startedAt}:${endedAt}:${walker}:${startName}:${endName}:${startLat}:${startLng}`;
}

// ─── Walk Detail Expansion ────────────────────────────────────────────────────
function WalkDetail({ w }: { w: any }) {
    return (
        <div className="mt-4 pt-4 border-t border-primary/10 animate-in slide-in-from-top-2 duration-300 space-y-5">
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div className="text-[9px] font-black uppercase text-slate-400 mb-1 flex items-center gap-1"><Navigation className="h-3 w-3" /> Distance</div>
                    <div className="text-lg font-black text-slate-700">{(Number(w.distanceMeters || 0) / 1000).toFixed(2)} <span className="text-xs opacity-40">km</span></div>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div className="text-[9px] font-black uppercase text-slate-400 mb-1 flex items-center gap-1"><Timer className="h-3 w-3" /> Duration</div>
                    <div className="text-lg font-black text-slate-700">{(w.durationSeconds / 60).toFixed(0)} <span className="text-xs opacity-40">min</span></div>
                </div>
            </div>
            {w.flags && w.flags.length > 0 && (
                <div className="space-y-1.5">
                    <div className="text-[9px] font-black uppercase text-red-500 tracking-wider flex items-center gap-1.5"><AlertTriangle className="h-3 w-3" /> Security Flags</div>
                    {w.flags.map((f: any, idx: number) => (
                        <div key={idx} className="bg-red-50 p-2.5 rounded-xl border border-red-100">
                            <div className="text-[10px] font-black text-red-700 uppercase">{f.flagType} — {f.severity}</div>
                            <div className="text-[10px] font-medium text-red-600/80 mt-0.5">{f.description}</div>
                        </div>
                    ))}
                </div>
            )}
            <div>
                <div className="text-[9px] font-black uppercase text-muted-foreground/40 tracking-wider mb-1.5">Participants</div>
                <div className="flex flex-wrap gap-1.5">
                    {(() => {
                        const names: string[] = w.participantNames?.length > 0
                            ? w.participantNames
                            : (w.participants ? w.participants.split(',').map((s: string) => s.trim()).filter(Boolean) : []);
                        return names.length > 0
                            ? names.map((n, i) => <span key={i} className="px-3 py-1 bg-white shadow-sm text-foreground text-[11px] font-bold rounded-lg border border-slate-200">{n}</span>)
                            : <span className="text-[11px] text-muted-foreground/30 italic">No participants listed</span>;
                    })()}
                </div>
            </div>
            {w.prayerJournal && (
                <div>
                    <div className="text-[9px] font-black uppercase text-muted-foreground/40 tracking-wider mb-1.5">Prayer Journal</div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-[12px] font-medium text-slate-600 leading-relaxed relative">
                        <FileText className="absolute top-3 right-3 h-4 w-4 text-slate-200" />
                        "{w.prayerJournal}"
                    </div>
                </div>
            )}
            <div className="bg-muted/10 p-3 rounded-2xl border border-dashed border-muted/30 space-y-2 text-[11px] font-bold text-muted-foreground/60">
                <div className="flex justify-between"><span>Branch</span><span className="text-foreground">{w.branch || 'International'}</span></div>
                <div className="flex justify-between">
                    <span>Session</span>
                    <span className="text-foreground">
                        {new Date(w.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        <span className="mx-1 opacity-30">→</span>
                        {w.endedAt ? new Date(w.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Active'}
                    </span>
                </div>
                <div className="flex justify-between"><span>Geometry</span><span className="text-foreground capitalize">{w.geometryType || 'Path'}</span></div>
                {w.startLocation?.latitude != null && (
                    <div className="flex justify-between items-start gap-2">
                        <span className="shrink-0">Start</span>
                        <span className="text-foreground font-mono text-[10px] text-right break-all">
                            {Number(w.startLocation.latitude).toFixed(6)}, {Number(w.startLocation.longitude).toFixed(6)}
                        </span>
                    </div>
                )}
                {w.endLocation?.latitude != null && (
                    w.endLocation.latitude !== w.startLocation?.latitude ||
                    w.endLocation.longitude !== w.startLocation?.longitude
                ) && (
                        <div className="flex justify-between items-start gap-2">
                            <span className="shrink-0">End</span>
                            <span className="text-foreground font-mono text-[10px] text-right break-all">
                                {Number(w.endLocation.latitude).toFixed(6)}, {Number(w.endLocation.longitude).toFixed(6)}
                            </span>
                        </div>
                    )}
            </div>
        </div>
    );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function DashboardPage() {
    const { isLoaded: isGoogleLoaded, loadError: googleLoadError } = useJsApiLoader({
        googleMapsApiKey: GOOGLE_MAPS_API_KEY || '',
    });
    const branchMapRef = useRef<any>(null);
    const walkMapRef = useRef<any>(null);
    const hasFittedBranchMap = useRef(false);
    const [view, setView] = useState<'branches' | 'walks'>('branches');

    const {
        branches,
        branchStats,
        branchesLoading,
        loadBranches,
        loadWalksForBranch,
    } = useDashboardData();

    const [branchSearch, setBranchSearch] = useState('');
    const [hoveredBranch, setHoveredBranch] = useState<string | null>(null);

    // Walk drilldown state
    const [selectedBranch, setSelectedBranch] = useState<any>(null);
    const [walks, setWalks] = useState<any[]>([]);
    const [walksLoading, setWalksLoading] = useState(false);
    const [walksStats, setWalksStats] = useState({ count: 0, distance: 0, duration: 0 });
    const [selectedWalk, setSelectedWalk] = useState<any>(null);
    const [walkSearch, setWalkSearch] = useState('');
    const [days, setDays] = useState(30);

    useEffect(() => {
        if (view !== 'branches' || !isGoogleLoaded || !branchMapRef.current || hasFittedBranchMap.current) return;
        const gm = (window as any).google?.maps;
        if (!gm) return;

        const pts = branches
            .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng))
            .map((b) => ({ lat: Number(b.lat), lng: Number(b.lng) }));

        if (pts.length === 0) return;
        if (pts.length === 1) {
            branchMapRef.current.setCenter(pts[0]);
            branchMapRef.current.setZoom(10);
            hasFittedBranchMap.current = true;
            return;
        }

        const bounds = new gm.LatLngBounds();
        pts.forEach((p) => bounds.extend(p));
        branchMapRef.current.fitBounds(bounds);
        hasFittedBranchMap.current = true;
    }, [view, branches, isGoogleLoaded]);

    useEffect(() => {
        if (view !== 'walks' || !isGoogleLoaded || !walkMapRef.current) return;
        const gm = (window as any).google?.maps;
        if (!gm) return;

        if (selectedWalk) {
            const pts = getWalkTrackPoints(selectedWalk);

            if (pts.length > 1) {
                const bounds = new gm.LatLngBounds();
                pts.forEach((p: any) => bounds.extend(p));
                walkMapRef.current.fitBounds(bounds);
                return;
            }
            if (selectedWalk.startLocation?.latitude != null && selectedWalk.startLocation?.longitude != null) {
                walkMapRef.current.panTo({
                    lat: Number(selectedWalk.startLocation.latitude),
                    lng: Number(selectedWalk.startLocation.longitude),
                });
                walkMapRef.current.setZoom(15);
                return;
            }
        }

        const allPts = walks
            .flatMap((w) => getWalkTrackPoints(w));

        if (allPts.length > 1) {
            const bounds = new gm.LatLngBounds();
            allPts.forEach((p: any) => bounds.extend(p));
            walkMapRef.current.fitBounds(bounds);
        } else if (selectedBranch?.lat && selectedBranch?.lng) {
            walkMapRef.current.panTo({ lat: Number(selectedBranch.lat), lng: Number(selectedBranch.lng) });
            walkMapRef.current.setZoom(13);
        }
    }, [view, isGoogleLoaded, selectedWalk, walks, selectedBranch]);

    // ── Open branch drilldown ───────────────────────────────────────────────
    const openBranch = useCallback(async (branch: any) => {
        setSelectedBranch(branch);
        setView('walks');
        setWalks([]);
        setSelectedWalk(null);
        setWalkSearch('');
        setWalksLoading(true);
        try {
            const rows: any[] = await loadWalksForBranch(branch, days);
            setWalks(rows);
            setWalksStats({
                count: rows.length,
                distance: rows.reduce((s, r) => s + Number(r.distanceMeters || 0), 0) / 1000,
                duration: Math.round(rows.reduce((s, r) => s + Number(r.durationSeconds || 0), 0) / 60),
            });
        } catch (e) {
            console.error('Failed to load walks', e);
        } finally {
            setWalksLoading(false);
        }
    }, [days, loadWalksForBranch]);

    const goBranches = () => {
        setView('branches');
        setSelectedBranch(null);
        setWalks([]);
        setSelectedWalk(null);
    };

    const filteredBranches = branches.filter(b =>
        !branchSearch ||
        b.name?.toLowerCase().includes(branchSearch.toLowerCase()) ||
        b.country?.toLowerCase().includes(branchSearch.toLowerCase()) ||
        b.region?.toLowerCase().includes(branchSearch.toLowerCase())
    );

    const filteredWalks = walks.filter(w =>
        !walkSearch ||
        (w.startLocationName || '').toLowerCase().includes(walkSearch.toLowerCase()) ||
        (w.endLocationName || '').toLowerCase().includes(walkSearch.toLowerCase()) ||
        (w.participantNames || []).join(' ').toLowerCase().includes(walkSearch.toLowerCase()) ||
        (w.participants || '').toLowerCase().includes(walkSearch.toLowerCase())
    );

    const totalWalks = Object.values(branchStats).reduce((s, b) => s + b.count, 0);
    const totalDistKm = Object.values(branchStats).reduce((s, b) => s + b.distance, 0) / 1000;

    // ── BRANCH OVERVIEW VIEW ────────────────────────────────────────────────
    if (view === 'branches') {
        return (
            <div className="flex flex-col h-screen overflow-hidden bg-muted/5">

                {/* Top bar */}
                <div className="flex items-center justify-between px-8 py-5 border-b bg-background/80 backdrop-blur shrink-0">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-3">
                            Branch Network
                            <span className="bg-primary/10 text-primary text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-wider">Overview</span>
                        </h1>
                        <p className="text-muted-foreground text-sm font-medium mt-0.5">
                            {branches.length} branches · {totalWalks} total walks · {totalDistKm.toFixed(1)} km covered
                        </p>
                    </div>
                    <button
                        onClick={() => {
                            hasFittedBranchMap.current = false;
                            loadBranches();
                        }}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-black text-muted-foreground hover:text-primary hover:border-primary/30 transition-all"
                    >
                        <RefreshCcw className={cn("h-4 w-4", branchesLoading && "animate-spin")} />
                        Refresh
                    </button>
                </div>

                {/* Split: Map left, List right */}
                <div className="flex flex-1 overflow-hidden">

                    {/* ── Map panel ── */}
                    <div className="flex-1 relative">
                        {branchesLoading && branches.length === 0 ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-10">
                                <div className="text-center space-y-3">
                                    <RefreshCcw className="h-10 w-10 text-primary/30 animate-spin mx-auto" />
                                    <div className="text-muted-foreground font-black text-xs uppercase tracking-widest">Loading map…</div>
                                </div>
                            </div>
                        ) : !GOOGLE_MAPS_API_KEY ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-10">
                                <div className="text-center space-y-2">
                                    <div className="text-foreground font-black text-sm">Google Maps key missing</div>
                                    <div className="text-muted-foreground text-xs">Set <code>VITE_GOOGLE_MAPS_API_KEY</code> in admin env.</div>
                                </div>
                            </div>
                        ) : googleLoadError ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-10">
                                <div className="text-center space-y-2">
                                    <div className="text-foreground font-black text-sm">Failed to load Google Maps</div>
                                    <div className="text-muted-foreground text-xs">Check API key restrictions and network.</div>
                                </div>
                            </div>
                        ) : !isGoogleLoaded ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-10">
                                <div className="text-center space-y-3">
                                    <RefreshCcw className="h-10 w-10 text-primary/30 animate-spin mx-auto" />
                                    <div className="text-muted-foreground font-black text-xs uppercase tracking-widest">Loading Google map…</div>
                                </div>
                            </div>
                        ) : (
                            <GoogleMap
                                center={{ lat: 20, lng: 0 }}
                                zoom={2}
                                mapContainerStyle={mapContainerStyle}
                                onLoad={(map) => { branchMapRef.current = map; }}
                                options={{
                                    mapTypeControl: false,
                                    streetViewControl: false,
                                    fullscreenControl: false,
                                }}
                            >
                                {branches
                                    .filter(b => b.lat && b.lng && isFinite(b.lat) && isFinite(b.lng))
                                    .map(b => {
                                        const stat = branchStats[b.slug] || { count: 0, distance: 0, duration: 0 };
                                        const isHovered = hoveredBranch === b.slug;
                                        return (
                                            <React.Fragment key={b.id}>
                                                <CircleF
                                                    center={{ lat: b.lat, lng: b.lng }}
                                                    radius={b.radiusMeters || 1000}
                                                    options={{
                                                        strokeColor: isHovered ? '#2563EB' : '#64748b',
                                                        strokeWeight: 1.5,
                                                        strokeOpacity: isHovered ? 0.7 : 0.3,
                                                        fillColor: isHovered ? '#2563EB' : '#64748b',
                                                        fillOpacity: isHovered ? 0.08 : 0.03,
                                                    }}
                                                />
                                                <MarkerF
                                                    position={{ lat: b.lat, lng: b.lng }}
                                                    label={{
                                                        text: stat.count > 999 ? '1k+' : (stat.count > 0 ? String(stat.count) : '·'),
                                                        fontSize: '11px',
                                                        fontWeight: '900',
                                                        color: '#ffffff',
                                                    }}
                                                    icon={{ url: isHovered ? 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png' : 'http://maps.google.com/mapfiles/ms/icons/darkblue-dot.png' }}
                                                    onClick={() => openBranch(b)}
                                                    onMouseOver={() => setHoveredBranch(b.slug)}
                                                    onMouseOut={() => setHoveredBranch(null)}
                                                />
                                            </React.Fragment>
                                        );
                                    })}
                            </GoogleMap>
                        )}

                        {/* Map legend */}
                        <div className="absolute bottom-4 left-4 z-[500] bg-white/90 backdrop-blur rounded-2xl shadow-lg border px-4 py-3 space-y-1.5 text-[11px] font-bold text-slate-600">
                            <div className="flex items-center gap-2">
                                <div className="h-3 w-3 rounded-full bg-[#1e293b] border-2 border-white shadow" />
                                Branch location
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="h-3 w-3 rounded-full border-2 border-slate-400 bg-slate-100" />
                                Service radius
                            </div>
                            <div className="text-muted-foreground/60 text-[10px] font-medium pt-0.5">Click a pin to view walks</div>
                        </div>
                    </div>

                    {/* ── Branch list panel ── */}
                    <div className="w-[380px] flex flex-col border-l bg-background">
                        {/* Search */}
                        <div className="p-4 border-b">
                            <div className="relative">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Filter branches…"
                                    value={branchSearch}
                                    onChange={e => setBranchSearch(e.target.value)}
                                    className="pl-10 h-10 rounded-xl font-medium border-2 focus-visible:ring-primary/20"
                                />
                            </div>
                        </div>

                        {/* Stats strip */}
                        <div className="grid grid-cols-3 divide-x border-b bg-muted/10">
                            {[
                                { label: 'Branches', value: branches.length, icon: <Building2 className="h-3.5 w-3.5" /> },
                                { label: 'Walks', value: totalWalks, icon: <Activity className="h-3.5 w-3.5" /> },
                                { label: 'km', value: totalDistKm.toFixed(0), icon: <Navigation className="h-3.5 w-3.5" /> },
                            ].map(({ label, value, icon }) => (
                                <div key={label} className="p-3 text-center">
                                    <div className="flex items-center justify-center gap-1 text-muted-foreground/60 text-[10px] font-black uppercase mb-1">{icon}{label}</div>
                                    <div className="text-lg font-black text-foreground">{value}</div>
                                </div>
                            ))}
                        </div>

                        {/* Branch list */}
                        <div className="flex-1 overflow-y-auto scrollbar-hide">
                            {filteredBranches.length === 0 && !branchesLoading ? (
                                <div className="p-12 text-center">
                                    <Building2 className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
                                    <div className="text-muted-foreground font-bold">No branches found</div>
                                </div>
                            ) : (
                                filteredBranches.map(branch => {
                                    const stat = branchStats[branch.slug] || { count: 0, distance: 0, duration: 0 };
                                    const isHover = hoveredBranch === branch.slug;
                                    return (
                                        <div
                                            key={branch.id}
                                            className={cn(
                                                "flex items-center gap-4 px-5 py-4 border-b cursor-pointer transition-all duration-200 group",
                                                isHover ? "bg-primary/[0.04] border-l-4 border-l-primary" : "hover:bg-muted/30 border-l-4 border-l-transparent"
                                            )}
                                            onMouseEnter={() => setHoveredBranch(branch.slug)}
                                            onMouseLeave={() => setHoveredBranch(null)}
                                            onClick={() => openBranch(branch)}
                                        >
                                            {/* Icon */}
                                            <div className={cn(
                                                "h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 transition-colors",
                                                isHover ? "bg-primary text-white" : "bg-muted/50 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                                            )}>
                                                <MapPin className="h-5 w-5" />
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className="font-black text-sm text-foreground truncate group-hover:text-primary transition-colors">
                                                        {branch.name}
                                                    </span>
                                                    {branch.isActive && (
                                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                                                    )}
                                                </div>
                                                <div className="text-[11px] font-bold text-muted-foreground/60 truncate">
                                                    {[branch.region, branch.country].filter(Boolean).join(', ') || branch.slug}
                                                </div>
                                                <div className="flex items-center gap-3 mt-1.5 text-[10px] font-black text-muted-foreground/50">
                                                    <span className="flex items-center gap-1"><Activity className="h-2.5 w-2.5" />{stat.count} walks</span>
                                                    <span className="flex items-center gap-1"><Navigation className="h-2.5 w-2.5" />{(stat.distance / 1000).toFixed(1)} km</span>
                                                </div>
                                            </div>

                                            {/* Arrow */}
                                            <ChevronRight className={cn(
                                                "h-4 w-4 text-muted-foreground/30 shrink-0 transition-all duration-200",
                                                isHover ? "text-primary translate-x-0.5" : "group-hover:text-muted-foreground"
                                            )} />
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── WALK DRILLDOWN VIEW ─────────────────────────────────────────────────
    const mapCenter: [number, number] = selectedBranch?.lat && selectedBranch?.lng
        ? [selectedBranch.lat, selectedBranch.lng]
        : [8.484, -13.23];

    return (
        <div className="flex h-full overflow-hidden">

            {/* ── Walk Map ── */}
            <div className="flex-1 relative">
                {!GOOGLE_MAPS_API_KEY ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-10">
                        <div className="text-center space-y-2">
                            <div className="text-foreground font-black text-sm">Google Maps key missing</div>
                            <div className="text-muted-foreground text-xs">Set <code>VITE_GOOGLE_MAPS_API_KEY</code> in admin env.</div>
                        </div>
                    </div>
                ) : googleLoadError ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-10">
                        <div className="text-center space-y-2">
                            <div className="text-foreground font-black text-sm">Failed to load Google Maps</div>
                            <div className="text-muted-foreground text-xs">Check API key restrictions and network.</div>
                        </div>
                    </div>
                ) : !isGoogleLoaded ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-10">
                        <div className="text-center space-y-3">
                            <RefreshCcw className="h-10 w-10 text-primary/30 animate-spin mx-auto" />
                            <div className="text-muted-foreground font-black text-xs uppercase tracking-widest">Loading Google map…</div>
                        </div>
                    </div>
                ) : (
                    <GoogleMap
                        center={{ lat: mapCenter[0], lng: mapCenter[1] }}
                        zoom={12}
                        mapContainerStyle={mapContainerStyle}
                        onLoad={(map) => { walkMapRef.current = map; }}
                        options={{
                            mapTypeControl: false,
                            streetViewControl: false,
                            fullscreenControl: false,
                        }}
                    >
                        {selectedBranch?.lat && selectedBranch?.lng && (
                            <CircleF
                                center={{ lat: selectedBranch.lat, lng: selectedBranch.lng }}
                                radius={selectedBranch.radiusMeters || 1000}
                                options={{ strokeColor: '#3b82f6', strokeWeight: 1.5, strokeOpacity: 0.4, fillColor: '#3b82f6', fillOpacity: 0.04 }}
                            />
                        )}

                        {filteredWalks.map(w => {
                            const pts = getWalkTrackPoints(w);
                            const walkIdentity = getWalkIdentity(w);
                            const isActive = !!selectedWalk && getWalkIdentity(selectedWalk) === walkIdentity;

                            const startPt = pts.length > 0
                                ? pts[0]
                                : (w.startLocation?.latitude != null && w.startLocation?.longitude != null
                                    ? { lat: Number(w.startLocation.latitude), lng: Number(w.startLocation.longitude) }
                                    : null);
                            const endPt = pts.length > 1
                                ? pts[pts.length - 1]
                                : (w.endLocation?.latitude != null && w.endLocation?.longitude != null
                                    ? { lat: Number(w.endLocation.latitude), lng: Number(w.endLocation.longitude) }
                                    : null);

                            if (!startPt && pts.length < 1) return null;

                            return (
                                <React.Fragment key={walkIdentity}>
                                    {pts.length > 1 && (
                                        <PolylineF
                                            path={pts}
                                            options={{
                                                strokeColor: isActive ? '#2563EB' : '#94a3b8',
                                                strokeWeight: isActive ? 6 : 2,
                                                strokeOpacity: isActive ? 1 : 0.55,
                                            }}
                                            onClick={() => setSelectedWalk(w)}
                                        />
                                    )}
                                    {startPt && (
                                        <MarkerF
                                            position={startPt}
                                            icon={{ url: isActive ? 'http://maps.google.com/mapfiles/ms/icons/green-dot.png' : 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png' }}
                                            label={{ text: 'S', fontSize: '11px', fontWeight: '900', color: '#ffffff' }}
                                            onClick={() => setSelectedWalk(w)}
                                        />
                                    )}
                                    {endPt && (endPt.lat !== startPt?.lat || endPt.lng !== startPt?.lng) && (
                                        <MarkerF
                                            position={endPt}
                                            icon={{ url: isActive ? 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' : 'http://maps.google.com/mapfiles/ms/icons/purple-dot.png' }}
                                            label={{ text: 'E', fontSize: '11px', fontWeight: '900', color: '#ffffff' }}
                                            onClick={() => setSelectedWalk(w)}
                                        />
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </GoogleMap>
                )}

                {/* Stats pills — bottom left */}
                <div className="absolute bottom-8 left-4 z-[500] flex gap-1.5 flex-wrap">
                    {[
                        { label: `${walksStats.count} walks`, dark: true },
                        { label: `${walksStats.distance.toFixed(1)} km`, dark: false },
                        { label: `${walksStats.duration} min`, dark: false },
                    ].map(({ label, dark }) => (
                        <div key={label} className={cn(
                            "px-3 py-1.5 rounded-full text-[11px] font-black shadow-md",
                            dark ? "bg-slate-900 text-white" : "bg-white/95 backdrop-blur text-slate-700 border border-slate-200"
                        )}>{label}</div>
                    ))}
                </div>

                {/* Back button + time range — top right, stacked */}
                <div className="absolute top-4 right-4 z-[500] flex flex-col items-end gap-2">
                    {/* Back button */}
                    <button
                        onClick={goBranches}
                        className="flex items-center gap-2 bg-white/95 backdrop-blur shadow-lg border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-black text-slate-700 hover:text-primary hover:border-primary/30 hover:shadow-xl transition-all duration-200 group"
                    >
                        <ChevronLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
                        <span>All Branches</span>
                    </button>

                    {/* Time range picker */}
                    <div className="bg-white/95 backdrop-blur shadow-lg border border-slate-200 rounded-2xl p-1.5 flex items-center gap-1">
                        {[7, 30, 90].map(d => (
                            <button
                                key={d}
                                onClick={() => { setDays(d); if (selectedBranch) openBranch(selectedBranch); }}
                                className={cn(
                                    "px-4 py-1.5 rounded-xl text-xs font-black transition-all",
                                    days === d ? "bg-slate-900 text-white shadow-md" : "text-slate-500 hover:bg-slate-100"
                                )}
                            >
                                {d === 7 ? '7 days' : d === 30 ? '30 days' : '3 months'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Walk List ── */}
            <div className="w-[380px] flex flex-col border-l bg-background">
                {/* List header: branch name + search */}
                <div className="p-4 border-b space-y-3">
                    <div>
                        <div className="flex items-center gap-2 mb-0.5">
                            <h2 className="font-black text-base text-foreground">{selectedBranch?.name}</h2>
                            <span className="bg-emerald-100 text-emerald-700 text-[9px] font-black px-1.5 py-0.5 rounded uppercase">
                                {selectedBranch?.country || 'Branch'}
                            </span>
                        </div>
                        <p className="text-[11px] font-bold text-muted-foreground/60">
                            {walksStats.count} walks · {walksStats.distance.toFixed(1)} km · {walksStats.duration} min
                        </p>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search walks…"
                            value={walkSearch}
                            onChange={e => setWalkSearch(e.target.value)}
                            className="pl-10 h-10 rounded-xl font-medium border-2 focus-visible:ring-primary/20"
                        />
                    </div>
                </div>

                {/* Walk items */}
                <div className="flex-1 overflow-y-auto scrollbar-hide">
                    {walksLoading ? (
                        <div className="p-16 text-center">
                            <RefreshCcw className="h-8 w-8 text-primary/20 animate-spin mx-auto mb-4" />
                            <div className="text-muted-foreground font-black text-xs uppercase tracking-widest">Loading walks…</div>
                        </div>
                    ) : filteredWalks.length === 0 ? (
                        <div className="p-16 text-center">
                            <Users className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
                            <div className="text-muted-foreground font-bold">No walks in this period</div>
                            <div className="text-muted-foreground/50 text-xs mt-1">Try extending the time range above</div>
                        </div>
                    ) : (
                        filteredWalks.map(w => {
                            const walkIdentity = getWalkIdentity(w);
                            const isSelected = !!selectedWalk && getWalkIdentity(selectedWalk) === walkIdentity;
                            return (
                                <div
                                    key={walkIdentity}
                                    className={cn(
                                        "px-5 py-4 border-b cursor-pointer transition-all border-l-4 group",
                                        isSelected
                                            ? "bg-primary/[0.08] border-l-primary shadow-[inset_0_0_0_1px_rgba(37,99,235,0.18)]"
                                            : "border-l-transparent hover:bg-muted/30"
                                    )}
                                    onClick={() => setSelectedWalk(w)}
                                >
                                    <div className="flex items-start justify-between gap-2 mb-1.5">
                                        <div className="flex-1 min-w-0">
                                            <h4 className={cn(
                                                "font-black text-sm leading-tight transition-colors truncate",
                                                isSelected ? "text-primary" : "text-foreground group-hover:text-primary"
                                            )}>
                                                {w.startLocationName || w.endLocationName || 'Prayer Walk'}
                                            </h4>
                                            {(() => {
                                                const names: string[] = w.participantNames?.length > 0
                                                    ? w.participantNames
                                                    : (w.participants ? w.participants.split(',').map((s: string) => s.trim()).filter(Boolean) : []);
                                                return names.length > 0
                                                    ? <div className="flex flex-wrap gap-1 mt-1">
                                                        {names.map((n: string, i: number) => (
                                                            <span key={i} className="text-[10px] font-bold text-muted-foreground/70 bg-muted/40 px-1.5 py-0.5 rounded">{n}</span>
                                                        ))}
                                                    </div>
                                                    : null;
                                            })()}
                                        </div>
                                        <div className={cn(
                                            "p-1 rounded-lg shrink-0 transition-all duration-300",
                                            isSelected ? "rotate-90 bg-primary/10 text-primary" : "bg-slate-100 text-slate-400 group-hover:bg-slate-200"
                                        )}>
                                            <ChevronRight className="h-3.5 w-3.5" />
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 text-[11px] font-bold text-muted-foreground/70">
                                        <span className="flex items-center gap-1"><Timer className="h-3 w-3 text-amber-500" />{(w.durationSeconds / 60).toFixed(0)} min</span>
                                        <span className="flex items-center gap-1"><Navigation className="h-3 w-3 text-blue-500" />{(Number(w.distanceMeters || 0) / 1000).toFixed(2)} km</span>
                                        <span className={cn(
                                            "ml-auto text-[9px] font-black px-2 py-0.5 rounded-md uppercase",
                                            w.status === 'completed' ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                                        )}>{w.status}</span>
                                    </div>

                                    <div className="mt-1.5 text-[10px] text-muted-foreground/50 font-medium">
                                        {new Date(w.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </div>

                                    {isSelected && <WalkDetail w={w} />}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}

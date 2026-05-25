'use client';

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import {
    MapPin, Navigation, Search, RefreshCcw, Timer,
    Activity, ChevronRight, ChevronLeft,
    FileText, AlertTriangle,
    Building2, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MapContainer, TileLayer, Marker, Polyline, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useDashboardData } from '@/features/dashboard/hooks/useDashboardData';

// Fix default marker icons (Leaflet + bundlers strip the default icon paths)
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

function makeIcon(color: string, label?: string): L.DivIcon {
    return L.divIcon({
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        html: `<div style="
            width:28px;height:28px;border-radius:50%;
            background:${color};border:3px solid #fff;
            box-shadow:0 2px 6px rgba(0,0,0,0.35);
            display:flex;align-items:center;justify-content:center;
            color:#fff;font-size:11px;font-weight:900;
        ">${label || ''}</div>`,
    });
}

const BRANCH_ICON = makeIcon('#1e293b', '');
const BRANCH_ICON_HOVER = makeIcon('#2563EB', '');
const START_ICON = makeIcon('#3b82f6', 'S');
const START_ICON_ACTIVE = makeIcon('#16a34a', 'S');
const END_ICON = makeIcon('#7c3aed', 'E');
const END_ICON_ACTIVE = makeIcon('#dc2626', 'E');

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

function toLatLng(point: any): { lat: number; lng: number } | null {
    if (!point) return null;
    const lat = Number(point.latitude ?? point.lat);
    const lng = Number(point.longitude ?? point.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
}

function hasMovement(points: Array<{ lat: number; lng: number }>): boolean {
    if (points.length < 2) return false;
    const first = points[0];
    const last = points[points.length - 1];
    return first.lat !== last.lat || first.lng !== last.lng;
}

function getWalkTrackPoints(walk: any): Array<{ lat: number; lng: number }> {
    const rawPoints = Array.isArray(walk?.points) ? walk.points : [];
    const parsedPoints = rawPoints
        .map((p: any) => toLatLng(p))
        .filter((p: { lat: number; lng: number } | null): p is { lat: number; lng: number } => !!p);
    // routeQuality='low' means the API fell back to [startLocation, currentLocation] (no real GPS events).
    // For those, require 3+ so we never draw a misleading straight line from two non-GPS points.
    // For real GPS data (high/medium), 2 points is enough to draw a meaningful path segment.
    const isRealGps = walk?.routeQuality && walk.routeQuality !== 'low';
    const minPoints = isRealGps ? 2 : 3;
    return parsedPoints.length >= minPoints && hasMovement(parsedPoints) ? parsedPoints : [];
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

// ─── Map fit helpers ─────────────────────────────────────────────────────────

function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
    const map = useMap();
    useEffect(() => {
        if (bounds) {
            map.fitBounds(bounds, { padding: [40, 40] });
        }
    }, [map, bounds]);
    return null;
}

function FitToCenter({ center, zoom }: { center: [number, number]; zoom: number }) {
    const map = useMap();
    useEffect(() => {
        map.setView(center, zoom);
    }, [map, center, zoom]);
    return null;
}

// ─── Walk Detail Expansion ────────────────────────────────────────────────────
function WalkDetail({ w }: { w: any }) {
    const startPt = toLatLng(w.startLocation);
    const endPt = toLatLng(w.endLocation);

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
                {startPt && (
                    <div className="flex justify-between items-start gap-2">
                        <span className="shrink-0">Start</span>
                        <span className="text-foreground font-mono text-[10px] text-right break-all">
                            {startPt.lat.toFixed(6)}, {startPt.lng.toFixed(6)}
                        </span>
                    </div>
                )}
                {endPt && (
                    endPt.lat !== startPt?.lat ||
                    endPt.lng !== startPt?.lng
                ) && (
                        <div className="flex justify-between items-start gap-2">
                            <span className="shrink-0">End</span>
                            <span className="text-foreground font-mono text-[10px] text-right break-all">
                                {endPt.lat.toFixed(6)}, {endPt.lng.toFixed(6)}
                            </span>
                        </div>
                    )}
            </div>
        </div>
    );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function DashboardContent() {
    const branchMapRef = useRef<L.Map | null>(null);
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
    const [selectedWalkKey, setSelectedWalkKey] = useState<string | null>(null);
    const [walkSearch, setWalkSearch] = useState('');
    const [days, setDays] = useState(30);

    // Compute branch map bounds
    const branchBounds = useMemo(() => {
        if (view !== 'branches') return null;
        const pts = branches
            .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng))
            .map((b) => [b.lat, b.lng] as [number, number]);
        if (pts.length === 0) return null;
        if (pts.length === 1) return L.latLngBounds(pts[0], pts[0]).pad(0.5);
        return L.latLngBounds(pts);
    }, [view, branches]);

    // Fit branch map when bounds change
    useEffect(() => {
        if (view !== 'branches' || !branchMapRef.current || hasFittedBranchMap.current || !branchBounds) return;
        branchMapRef.current.fitBounds(branchBounds, { padding: [40, 40] });
        hasFittedBranchMap.current = true;
    }, [view, branchBounds]);

    // Compute walk map bounds
    const walkMapBounds = useMemo((): L.LatLngBounds | null => {
        if (view !== 'walks') return null;

        if (selectedWalk) {
            const pts = getWalkTrackPoints(selectedWalk);
            if (pts.length > 1) {
                return L.latLngBounds(pts.map(p => [p.lat, p.lng] as [number, number]));
            }
            const startPt = toLatLng(selectedWalk.startLocation);
            const endPt = toLatLng(selectedWalk.endLocation);
            if (startPt && endPt && (startPt.lat !== endPt.lat || startPt.lng !== endPt.lng)) {
                return L.latLngBounds(
                    [startPt.lat, startPt.lng],
                    [endPt.lat, endPt.lng]
                );
            }
            // Single point — handled by FitToCenter below
            return null;
        }

        const allPts = walks.flatMap((w) => getWalkTrackPoints(w));
        if (allPts.length > 1) {
            return L.latLngBounds(allPts.map(p => [p.lat, p.lng] as [number, number]));
        }
        return null;
    }, [view, selectedWalk, walks]);

    // Single-point center for selected walk
    const walkSingleCenter = useMemo((): [number, number] | null => {
        if (view !== 'walks' || !selectedWalk) return null;
        const pts = getWalkTrackPoints(selectedWalk);
        if (pts.length > 1) return null;
        const startPt = toLatLng(selectedWalk.startLocation);
        if (startPt) return [startPt.lat, startPt.lng];
        return null;
    }, [view, selectedWalk]);

    // ── Open branch drilldown ───────────────────────────────────────────────
    const openBranch = useCallback(async (branch: any) => {
        setSelectedBranch(branch);
        setView('walks');
        setWalks([]);
        setSelectedWalk(null);
        setSelectedWalkKey(null);
        setWalkSearch('');
        setWalksLoading(true);
        try {
            const rows: any[] = await loadWalksForBranch(branch, days);
            const keyedRows = rows.map((row, idx) => ({
                ...row,
                __walkKey: `${row.sessionId || row.id || 'walk'}:${idx}`,
            }));
            setWalks(keyedRows);
            setWalksStats({
                count: keyedRows.length,
                distance: keyedRows.reduce((s, r) => s + Number(r.distanceMeters || 0), 0) / 1000,
                duration: Math.round(keyedRows.reduce((s, r) => s + Number(r.durationSeconds || 0), 0) / 60),
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
        setSelectedWalkKey(null);
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
                        ) : (
                            <MapContainer
                                center={[20, 0]}
                                zoom={2}
                                style={{ height: '100%', width: '100%' }}
                                ref={branchMapRef}
                                zoomControl={true}
                            >
                                <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
                                {branchBounds && !hasFittedBranchMap.current && (
                                    <FitBounds bounds={branchBounds} />
                                )}
                                {branches
                                    .filter(b => b.lat && b.lng && isFinite(b.lat) && isFinite(b.lng))
                                    .map(b => {
                                        const isHovered = hoveredBranch === b.slug;
                                        return (
                                            <React.Fragment key={b.id}>
                                                <Circle
                                                    center={[b.lat, b.lng]}
                                                    radius={b.radiusMeters || 1000}
                                                    pathOptions={{
                                                        color: isHovered ? '#2563EB' : '#64748b',
                                                        weight: 1.5,
                                                        opacity: isHovered ? 0.7 : 0.3,
                                                        fillColor: isHovered ? '#2563EB' : '#64748b',
                                                        fillOpacity: isHovered ? 0.08 : 0.03,
                                                    }}
                                                />
                                                <Marker
                                                    position={[b.lat, b.lng]}
                                                    icon={isHovered ? BRANCH_ICON_HOVER : BRANCH_ICON}
                                                    eventHandlers={{
                                                        click: () => openBranch(b),
                                                        mouseover: () => setHoveredBranch(b.slug),
                                                        mouseout: () => setHoveredBranch(null),
                                                    }}
                                                />
                                            </React.Fragment>
                                        );
                                    })}
                            </MapContainer>
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
                                { label: 'km', value: totalDistKm.toFixed(1), icon: <Navigation className="h-3.5 w-3.5" /> },
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
                <MapContainer
                    center={mapCenter}
                    zoom={12}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={true}
                >
                    <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />

                    {walkMapBounds && <FitBounds bounds={walkMapBounds} />}
                    {walkSingleCenter && <FitToCenter center={walkSingleCenter} zoom={15} />}
                    {!walkMapBounds && !walkSingleCenter && selectedBranch?.lat && selectedBranch?.lng && (
                        <FitToCenter center={[selectedBranch.lat, selectedBranch.lng]} zoom={13} />
                    )}

                    {selectedBranch?.lat && selectedBranch?.lng && (
                        <Circle
                            center={[selectedBranch.lat, selectedBranch.lng]}
                            radius={selectedBranch.radiusMeters || 1000}
                            pathOptions={{ color: '#3b82f6', weight: 1.5, opacity: 0.4, fillColor: '#3b82f6', fillOpacity: 0.04 }}
                        />
                    )}

                    {filteredWalks.map(w => {
                        const pts = getWalkTrackPoints(w);
                        const walkIdentity = w.__walkKey || getWalkIdentity(w);
                        const isActive = selectedWalkKey === walkIdentity;

                        // When a walk is selected, hide ALL others — isolate it on the map
                        if (selectedWalkKey && !isActive) return null;

                        const startPt = pts.length > 0
                            ? pts[0]
                            : toLatLng(w.startLocation);
                        const endPt = pts.length > 1
                            ? pts[pts.length - 1]
                            : toLatLng(w.endLocation);

                        if (!startPt && pts.length < 1) return null;

                        const toggle = () => {
                            if (isActive) {
                                // Deselect — show all walks again
                                setSelectedWalk(null);
                                setSelectedWalkKey(null);
                            } else {
                                setSelectedWalk(w);
                                setSelectedWalkKey(walkIdentity);
                            }
                        };

                        return (
                            <React.Fragment key={walkIdentity}>
                                {pts.length > 1 && (
                                    <Polyline
                                        positions={pts.map(p => [p.lat, p.lng] as [number, number])}
                                        pathOptions={{
                                            color: '#2563EB',
                                            weight: 6,
                                            opacity: 1,
                                        }}
                                        eventHandlers={{ click: toggle }}
                                    />
                                )}
                                {startPt && (
                                    <Marker
                                        position={[startPt.lat, startPt.lng]}
                                        icon={START_ICON_ACTIVE}
                                        eventHandlers={{ click: toggle }}
                                    />
                                )}
                                {endPt && (endPt.lat !== startPt?.lat || endPt.lng !== startPt?.lng) && (
                                    <Marker
                                        position={[endPt.lat, endPt.lng]}
                                        icon={END_ICON_ACTIVE}
                                        eventHandlers={{ click: toggle }}
                                    />
                                )}
                            </React.Fragment>
                        );
                    })}
                </MapContainer>

                {/* "Show all" pill — visible when a specific walk is isolated */}
                {selectedWalkKey && (
                    <div className="absolute top-4 left-4 z-[500]">
                        <button
                            onClick={() => { setSelectedWalk(null); setSelectedWalkKey(null); }}
                            className="flex items-center gap-2 bg-white/95 backdrop-blur shadow-lg border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-black text-slate-700 hover:text-primary hover:border-primary/30 transition-all"
                        >
                            ← Show all walks
                        </button>
                    </div>
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
                            const walkIdentity = w.__walkKey || getWalkIdentity(w);
                            const isSelected = selectedWalkKey === walkIdentity;
                            return (
                                <div
                                    key={walkIdentity}
                                    className={cn(
                                        "px-5 py-4 border-b cursor-pointer transition-all border-l-4 group",
                                        isSelected
                                            ? "bg-primary/[0.08] border-l-primary shadow-[inset_0_0_0_1px_rgba(37,99,235,0.18)]"
                                            : "border-l-transparent hover:bg-muted/30"
                                    )}
                                    onClick={() => {
                                        if (isSelected) { setSelectedWalk(null); setSelectedWalkKey(null); }
                                        else { setSelectedWalk(w); setSelectedWalkKey(walkIdentity); }
                                    }}
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

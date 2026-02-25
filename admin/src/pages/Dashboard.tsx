import React, { useEffect, useState, useCallback, useRef } from 'react';
import client from '@/api/client';
import { Input } from '@/components/ui/input';
import {
    MapPin, Navigation, Search, RefreshCcw, Timer,
    Activity, ChevronRight, ChevronLeft,
    FileText, AlertTriangle,
    Building2, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MapContainer, TileLayer, Marker, Polyline, Circle, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// ─── Leaflet icon fix ─────────────────────────────────────────────────────────
// @ts-ignore
import icon from 'leaflet/dist/images/marker-icon.png';
// @ts-ignore
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
L.Marker.prototype.options.icon = L.icon({
    iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41],
});

// Custom branch pin icon factory
function makeBranchIcon(isHovered: boolean, count: number) {
    const bg = isHovered ? '#2563EB' : '#1e293b';
    const label = count > 999 ? '1k+' : count > 0 ? String(count) : '·';
    return L.divIcon({
        className: '',
        html: `
          <div style="
            position:relative;
            display:flex;flex-direction:column;align-items:center;
            filter: drop-shadow(0 4px 12px rgba(0,0,0,0.35));
            cursor:pointer;
          ">
            <div style="
              background:${bg};
              color:white;
              font-size:10px;font-weight:900;
              padding:3px 7px;border-radius:20px;
              white-space:nowrap;margin-bottom:3px;
              border: 2px solid rgba(255,255,255,0.2);
              min-width:24px;text-align:center;
              transition: background 0.2s;
            ">${label}</div>
            <div style="
              width:14px;height:14px;background:${bg};
              border-radius:50% 50% 50% 0;
              transform:rotate(-45deg);
              border:2px solid rgba(255,255,255,0.3);
            "></div>
          </div>
        `,
        iconSize: [40, 44],
        iconAnchor: [20, 44],
    });
}

// Walk start/end pin icon factories
function makeWalkPin(type: 'start' | 'end', active: boolean) {
    // Active walks get distinctive colors (emerald for start, rose for end). Inactive walks stay slate to not clutter.
    const color = active ? (type === 'start' ? '#059669' : '#e11d48') : '#64748b';
    const size = active ? 28 : 22;
    const label = type === 'start' ? 'S' : 'E';

    return L.divIcon({
        className: '',
        html: `<svg width="${size}" height="${size * 1.4}" viewBox="0 0 28 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="cursor:pointer;filter:drop-shadow(0 2px 6px rgba(0,0,0,${active ? '0.45' : '0.25'}))">
            <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 26 14 26S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="${color}"/>
            <circle cx="14" cy="14" r="6.5" fill="white" fill-opacity="${active ? '1' : '0.9'}"/>
            <text x="14" y="18" font-family="sans-serif" font-size="11" font-weight="900" fill="${color}" text-anchor="middle">${label}</text>
        </svg>`,
        iconSize: [size, size * 1.4],
        iconAnchor: [size / 2, size * 1.4],
    });
}

// ─── Branch map controller ─────────────────────────────────────────────────────
function BranchMapController({ branches }: { branches: any[] }) {
    const map = useMap();
    const fitted = useRef(false);

    useEffect(() => {
        if (fitted.current || branches.length === 0) return;
        const pts = branches
            .filter(b => b.lat && b.lng && isFinite(b.lat) && isFinite(b.lng))
            .map(b => [b.lat, b.lng] as [number, number]);
        if (pts.length === 1) { map.setView(pts[0], 10); fitted.current = true; }
        else if (pts.length > 1) { map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 12 }); fitted.current = true; }
    }, [branches, map]);

    return null;
}

// ─── Walk map controller ──────────────────────────────────────────────────────
function WalkMapController({ selectedWalk, walks, branch }: { selectedWalk: any; walks: any[]; branch: any }) {
    const map = useMap();

    useEffect(() => {
        if (selectedWalk) {
            const pts = (selectedWalk.points || []).map((p: any) => [p.latitude, p.longitude] as [number, number]);
            if (pts.length > 1) { map.flyToBounds(L.latLngBounds(pts), { padding: [50, 50], duration: 1.2 }); return; }
            if (selectedWalk.startLocation?.latitude) {
                map.flyTo([selectedWalk.startLocation.latitude, selectedWalk.startLocation.longitude], 15, { duration: 1 });
                return;
            }
        }
        const allPts = walks.flatMap(w => (w.points || []).filter((p: any) => p.latitude && p.longitude).map((p: any) => [p.latitude, p.longitude] as [number, number]));
        if (allPts.length > 1) { map.fitBounds(L.latLngBounds(allPts), { padding: [50, 50] }); }
        else if (branch?.lat && branch?.lng) { map.setView([branch.lat, branch.lng], 13); }
    }, [selectedWalk, walks, branch, map]);

    return null;
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
    const [view, setView] = useState<'branches' | 'walks'>('branches');

    // Branch state
    const [branches, setBranches] = useState<any[]>([]);
    const [branchStats, setBranchStats] = useState<Record<string, { count: number; distance: number; duration: number }>>({});
    const [branchSearch, setBranchSearch] = useState('');
    const [branchesLoading, setBranchesLoading] = useState(true);
    const [hoveredBranch, setHoveredBranch] = useState<string | null>(null);

    // Walk drilldown state
    const [selectedBranch, setSelectedBranch] = useState<any>(null);
    const [walks, setWalks] = useState<any[]>([]);
    const [walksLoading, setWalksLoading] = useState(false);
    const [walksStats, setWalksStats] = useState({ count: 0, distance: 0, duration: 0 });
    const [selectedWalk, setSelectedWalk] = useState<any>(null);
    const [walkSearch, setWalkSearch] = useState('');
    const [days, setDays] = useState(30);

    // ── Load branches ───────────────────────────────────────────────────────
    useEffect(() => { loadBranches(); }, []);

    const loadBranches = async () => {
        setBranchesLoading(true);
        try {
            const res = await client.get('/admin/branches');
            const list: any[] = res.data.branches || [];
            setBranches(list);

            // Fetch per-branch stats concurrently
            const results = await Promise.allSettled(
                list.map(b =>
                    client.get(`/walks/history?branch=${encodeURIComponent(b.slug)}&allTime=true&limit=2000&walkType=all&includeActive=true`)
                        .then(r => {
                            const rows: any[] = r.data.routes || [];
                            return {
                                slug: b.slug,
                                count: rows.length,
                                distance: rows.reduce((s, r) => s + Number(r.distanceMeters || 0), 0),
                                duration: rows.reduce((s, r) => s + Number(r.durationSeconds || 0), 0),
                            };
                        })
                        .catch(() => ({ slug: b.slug, count: 0, distance: 0, duration: 0 }))
                )
            );
            const stats: Record<string, { count: number; distance: number; duration: number }> = {};
            results.forEach(r => { if (r.status === 'fulfilled') stats[r.value.slug] = r.value; });
            setBranchStats(stats);
        } catch (e) {
            console.error('Failed to load branches', e);
        } finally {
            setBranchesLoading(false);
        }
    };

    // ── Open branch drilldown ───────────────────────────────────────────────
    const openBranch = useCallback(async (branch: any) => {
        setSelectedBranch(branch);
        setView('walks');
        setWalks([]);
        setSelectedWalk(null);
        setWalkSearch('');
        setWalksLoading(true);
        try {
            const res = await client.get(
                `/walks/history?branch=${encodeURIComponent(branch.slug)}&days=${days}&walkType=all&includeActive=true`
            );
            const rows: any[] = res.data.routes || [];
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
    }, [days]);

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
                        onClick={loadBranches}
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
                                zoomControl={true}
                                className="z-0"
                            >
                                <TileLayer
                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                    attribution='&copy; OpenStreetMap contributors'
                                />
                                <BranchMapController branches={branches} />

                                {branches
                                    .filter(b => b.lat && b.lng && isFinite(b.lat) && isFinite(b.lng))
                                    .map(b => {
                                        const stat = branchStats[b.slug] || { count: 0, distance: 0, duration: 0 };
                                        const isHovered = hoveredBranch === b.slug;
                                        return (
                                            <React.Fragment key={b.id}>
                                                {/* Service radius circle */}
                                                <Circle
                                                    center={[b.lat, b.lng]}
                                                    radius={b.radiusMeters || 1000}
                                                    pathOptions={{
                                                        color: isHovered ? '#2563EB' : '#64748b',
                                                        weight: 1.5,
                                                        opacity: isHovered ? 0.7 : 0.3,
                                                        fillOpacity: isHovered ? 0.08 : 0.03,
                                                    }}
                                                />
                                                {/* Branch pin */}
                                                <Marker
                                                    position={[b.lat, b.lng]}
                                                    icon={makeBranchIcon(isHovered, stat.count)}
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
                <MapContainer
                    center={mapCenter}
                    zoom={12}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={true}
                >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <WalkMapController selectedWalk={selectedWalk} walks={filteredWalks} branch={selectedBranch} />

                    {/* Branch service radius */}
                    {selectedBranch?.lat && selectedBranch?.lng && (
                        <Circle
                            center={[selectedBranch.lat, selectedBranch.lng]}
                            radius={selectedBranch.radiusMeters || 1000}
                            pathOptions={{ color: '#3b82f6', weight: 1.5, opacity: 0.4, fillOpacity: 0.04 }}
                        />
                    )}

                    {/* Routes + pins */}
                    {filteredWalks.map(w => {
                        const pts = (w.points || []).map((p: any) => [p.latitude, p.longitude]);
                        const isActive = selectedWalk?.sessionId === w.sessionId;

                        // Resolve start & end coords from points array or explicit fields
                        const startPt: [number, number] | null =
                            pts.length > 0 ? pts[0] as [number, number]
                                : w.startLocation?.latitude != null ? [w.startLocation.latitude, w.startLocation.longitude]
                                    : null;
                        const endPt: [number, number] | null =
                            pts.length > 1 ? pts[pts.length - 1] as [number, number]
                                : w.endLocation?.latitude != null ? [w.endLocation.latitude, w.endLocation.longitude]
                                    : null;

                        // Skip entirely if no position data at all
                        if (!startPt && pts.length < 1) return null;

                        const handler = { click: () => setSelectedWalk(isActive ? null : w) };
                        return (
                            <React.Fragment key={w.sessionId}>
                                {/* Route line */}
                                {pts.length > 1 && (
                                    <Polyline
                                        positions={pts as any}
                                        color={isActive ? '#2563EB' : '#94a3b8'}
                                        weight={isActive ? 6 : 2}
                                        opacity={isActive ? 1 : 0.55}
                                        lineCap="round"
                                        lineJoin="round"
                                        eventHandlers={handler}
                                    />
                                )}
                                {/* Start pin */}
                                {startPt && (
                                    <Marker
                                        position={startPt}
                                        icon={makeWalkPin('start', isActive)}
                                        eventHandlers={handler}
                                        zIndexOffset={isActive ? 1000 : 0}
                                    />
                                )}
                                {/* End pin — only if distinct from start */}
                                {endPt && (endPt[0] !== startPt?.[0] || endPt[1] !== startPt?.[1]) && (
                                    <Marker
                                        position={endPt}
                                        icon={makeWalkPin('end', isActive)}
                                        eventHandlers={handler}
                                        zIndexOffset={isActive ? 1000 : 0}
                                    />
                                )}
                            </React.Fragment>
                        );
                    })}
                </MapContainer>

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
                            const isSelected = selectedWalk?.sessionId === w.sessionId;
                            return (
                                <div
                                    key={w.sessionId}
                                    className={cn(
                                        "px-5 py-4 border-b cursor-pointer transition-all border-l-4 group",
                                        isSelected
                                            ? "bg-primary/[0.05] border-l-primary"
                                            : "border-l-transparent hover:bg-muted/30"
                                    )}
                                    onClick={() => setSelectedWalk(isSelected ? null : w)}
                                >
                                    <div className="flex items-start justify-between gap-2 mb-1.5">
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-black text-sm text-foreground leading-tight group-hover:text-primary transition-colors truncate">
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

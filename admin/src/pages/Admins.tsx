import { useEffect, useState, useCallback } from 'react';
import client from '@/api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    Search, RefreshCcw, UserPlus, ShieldCheck, ShieldOff,
    Mail, Trash2, ArrowRightLeft, X,
    ChevronDown, Building2, CheckCircle2, Clock, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────
interface AdminUser {
    id: string;
    email: string;
    name: string | null;
    role: string;
    branch: string | null;
    isActive: boolean;
    lastLogin: string | null;
    createdAt: string;
    inviteStatus: string | null;
    inviteExpiresAt: string | null;
}

interface Branch { id: string; name: string; slug: string; }

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }: {
    title: string; message: string; confirmLabel?: string; danger?: boolean;
    onConfirm: () => void; onCancel: () => void;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onCancel} />
            <div className="relative bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full mx-4 animate-in zoom-in-95 duration-200">
                <h3 className="text-xl font-black text-slate-900 mb-2">{title}</h3>
                <p className="text-slate-500 font-medium text-sm leading-relaxed mb-8">{message}</p>
                <div className="flex gap-3 justify-end">
                    <Button variant="ghost" onClick={onCancel} className="font-bold">Cancel</Button>
                    <Button
                        onClick={onConfirm}
                        className={cn("font-black px-6", danger ? "bg-red-600 hover:bg-red-700 text-white" : "")}
                    >{confirmLabel}</Button>
                </div>
            </div>
        </div>
    );
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────
function InviteModal({ branches, onClose, onSuccess }: {
    branches: Branch[]; onClose: () => void; onSuccess: () => void;
}) {
    const [email, setEmail] = useState('');
    const [pastorName, setPastorName] = useState('');
    const [branch, setBranch] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<{ inviteLink?: string; warning?: string; error?: string } | null>(null);

    const submit = async () => {
        if (!email || !branch || !pastorName) return;
        setLoading(true);
        try {
            const res = await client.post('/admin/admin-invites', { email, pastorName, branch });
            setResult({ inviteLink: res.data.inviteLink, warning: res.data.warning });
            onSuccess();
        } catch (e: any) {
            setResult({ error: e?.response?.data?.error || 'Failed to send invite' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white rounded-3xl shadow-2xl p-8 max-w-lg w-full mx-4 animate-in zoom-in-95 duration-200">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <h3 className="text-xl font-black text-slate-900">Invite Administrator</h3>
                        <p className="text-slate-500 text-sm font-medium mt-1">Send a branch admin invite via email</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                        <X className="h-5 w-5 text-slate-400" />
                    </button>
                </div>

                {result ? (
                    <div className="space-y-4">
                        {result.error ? (
                            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
                                <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                                <div>
                                    <div className="font-black text-red-700 text-sm">Invite Failed</div>
                                    <div className="text-red-600 text-xs mt-1 font-medium">{result.error}</div>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex gap-3">
                                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                                <div>
                                    <div className="font-black text-emerald-700 text-sm">Invite Sent!</div>
                                    {result.warning && <div className="text-amber-600 text-xs mt-1 font-medium">{result.warning}</div>}
                                    {result.inviteLink && (
                                        <div className="mt-3">
                                            <div className="text-[10px] font-black uppercase text-emerald-600 mb-1">Invite Link</div>
                                            <div className="bg-white border border-emerald-200 rounded-xl p-2.5 text-[11px] font-mono text-slate-600 break-all">{result.inviteLink}</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        <div className="flex justify-end gap-3">
                            {!result.error && <Button variant="ghost" onClick={() => setResult(null)} className="font-bold">Invite Another</Button>}
                            <Button onClick={onClose} className="font-black">Done</Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label className="text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1.5 block">Email address *</label>
                            <Input
                                type="email"
                                placeholder="pastor@church.org"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                className="h-11 rounded-xl font-medium border-2 focus-visible:ring-primary/20"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1.5 block">Full name *</label>
                            <Input
                                placeholder="Pastor John Doe"
                                value={pastorName}
                                onChange={e => setPastorName(e.target.value)}
                                className="h-11 rounded-xl font-medium border-2 focus-visible:ring-primary/20"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1.5 block">Assign to branch *</label>
                            <div className="relative">
                                <select
                                    value={branch}
                                    onChange={e => setBranch(e.target.value)}
                                    className="w-full h-11 pl-4 pr-10 rounded-xl font-medium border-2 border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none"
                                >
                                    <option value="">Select a branch…</option>
                                    {branches.map(b => <option key={b.id} value={b.slug}>{b.name}</option>)}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <Button variant="ghost" onClick={onClose} className="font-bold">Cancel</Button>
                            <Button
                                onClick={submit}
                                disabled={!email || !branch || !pastorName || loading}
                                className="font-black px-6 flex items-center gap-2"
                            >
                                {loading ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                                Send Invite
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Reassign Modal ───────────────────────────────────────────────────────────
function ReassignModal({ admin, branches, onClose, onSuccess }: {
    admin: AdminUser; branches: Branch[]; onClose: () => void; onSuccess: () => void;
}) {
    const [branch, setBranch] = useState(admin.branch || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        if (!branch) return;
        setLoading(true);
        try {
            await client.post(`/admin/admin-users/${admin.id}/reassign-branch`, { branch });
            onSuccess();
            onClose();
        } catch (e: any) {
            setError(e?.response?.data?.error || 'Failed to reassign branch');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full mx-4 animate-in zoom-in-95 duration-200">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <h3 className="text-xl font-black text-slate-900">Reassign Branch</h3>
                        <p className="text-slate-500 text-sm font-medium mt-1">{admin.email}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                        <X className="h-5 w-5 text-slate-400" />
                    </button>
                </div>
                <div className="relative mb-6">
                    <select
                        value={branch}
                        onChange={e => setBranch(e.target.value)}
                        className="w-full h-11 pl-4 pr-10 rounded-xl font-medium border-2 border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none"
                    >
                        <option value="">Select a branch…</option>
                        {branches.map(b => <option key={b.id} value={b.slug}>{b.name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
                {error && <p className="text-red-500 text-xs font-bold mb-4">{error}</p>}
                <div className="flex justify-end gap-3">
                    <Button variant="ghost" onClick={onClose} className="font-bold">Cancel</Button>
                    <Button onClick={submit} disabled={!branch || loading} className="font-black px-6 flex items-center gap-2">
                        {loading ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
                        Reassign
                    </Button>
                </div>
            </div>
        </div>
    );
}


// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminsPage() {
    const [admins, setAdmins] = useState<AdminUser[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showInvite, setShowInvite] = useState(false);
    const [reassignTarget, setReassignTarget] = useState<AdminUser | null>(null);
    const [confirm, setConfirm] = useState<{ action: string; admin: AdminUser } | null>(null);
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const showToast = (msg: string, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3500);
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [adminRes, branchRes] = await Promise.all([
                client.get('/admin/admin-users'),
                client.get('/admin/branches'),
            ]);
            setAdmins(adminRes.data.admins || []);
            setBranches(branchRes.data.branches || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleAction = async (action: string, admin: AdminUser) => {
        if (action === 'reassign') { setReassignTarget(admin); return; }
        if (action === 'deactivate' || action === 'delete') { setConfirm({ action, admin }); return; }

        setActionLoading(admin.id + action);
        try {
            if (action === 'reactivate') {
                await client.post(`/admin/admin-users/${admin.id}/reactivate`);
                showToast(`${admin.email} reactivated`);
            } else if (action === 'reset') {
                await client.post(`/admin/admin-users/${admin.id}/reset-password`);
                showToast('Password reset email sent');
            } else if (action === 'resend') {
                showToast('Invite resent');
            }
            await load();
        } catch (e: any) {
            showToast(e?.response?.data?.error || 'Action failed', false);
        } finally {
            setActionLoading(null);
        }
    };

    const confirmAction = async () => {
        if (!confirm) return;
        const { action, admin } = confirm;
        setConfirm(null);
        setActionLoading(admin.id + action);
        try {
            if (action === 'deactivate') {
                await client.post(`/admin/admin-users/${admin.id}/deactivate`);
                showToast(`${admin.email} deactivated`);
            } else if (action === 'delete') {
                await client.delete(`/admin/admin-users/${admin.id}`);
                showToast(`${admin.email} deleted`);
            }
            await load();
        } catch (e: any) {
            showToast(e?.response?.data?.error || 'Action failed', false);
        } finally {
            setActionLoading(null);
        }
    };

    const filtered = admins.filter(a =>
        !search ||
        a.email.toLowerCase().includes(search.toLowerCase()) ||
        (a.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (a.branch || '').toLowerCase().includes(search.toLowerCase())
    );

    const activeCount = admins.filter(a => a.isActive).length;
    const pendingCount = admins.filter(a => a.inviteStatus === 'pending').length;

    const inviteStatusBadge = (a: AdminUser) => {
        if (!a.inviteStatus) return null;
        const expired = a.inviteExpiresAt && new Date(a.inviteExpiresAt) < new Date();
        if (a.inviteStatus === 'accepted') return <span className="flex items-center gap-1 text-[9px] font-black bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded uppercase"><CheckCircle2 className="h-2.5 w-2.5" />Accepted</span>;
        if (expired) return <span className="flex items-center gap-1 text-[9px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded uppercase"><AlertCircle className="h-2.5 w-2.5" />Expired</span>;
        return <span className="flex items-center gap-1 text-[9px] font-black bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase"><Clock className="h-2.5 w-2.5" />Pending</span>;
    };

    return (
        <div className="p-8 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-start justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-foreground">Administrators</h1>
                    <p className="text-muted-foreground font-medium mt-1 text-sm">
                        {admins.length} total · {activeCount} active · {pendingCount} pending invite
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={load}
                        className="p-2.5 rounded-xl border-2 hover:border-primary/30 hover:text-primary text-muted-foreground transition-all"
                    >
                        <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </button>
                    <Button
                        onClick={() => setShowInvite(true)}
                        className="flex items-center gap-2 font-black px-5 h-11 rounded-xl shadow-lg shadow-primary/20"
                    >
                        <UserPlus className="h-4 w-4" />
                        Invite Admin
                    </Button>
                </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4 mb-8">
                {[
                    { label: 'Total Admins', value: admins.length, icon: <ShieldCheck className="h-5 w-5" />, color: 'text-primary' },
                    { label: 'Active', value: activeCount, icon: <CheckCircle2 className="h-5 w-5" />, color: 'text-emerald-600' },
                    { label: 'Pending Invite', value: pendingCount, icon: <Clock className="h-5 w-5" />, color: 'text-amber-600' },
                ].map(({ label, value, icon, color }) => (
                    <div key={label} className="bg-white rounded-2xl border-2 border-slate-100 p-5 flex items-center gap-4 shadow-sm">
                        <div className={cn("p-3 rounded-xl bg-muted/30", color)}>{icon}</div>
                        <div>
                            <div className="text-2xl font-black text-foreground">{value}</div>
                            <div className="text-[11px] font-black uppercase text-muted-foreground/60 tracking-wider">{label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Search */}
            <div className="relative mb-4">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search by name, email or branch…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-11 h-12 rounded-2xl font-medium border-2 focus-visible:ring-primary/20"
                />
            </div>

            {/* Table */}
            <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_140px_100px_140px_auto] gap-4 px-6 py-3 border-b bg-muted/20 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">
                    <span>Administrator</span>
                    <span>Branch</span>
                    <span>Status</span>
                    <span>Last Login</span>
                    <span>Actions</span>
                </div>

                {loading ? (
                    <div className="py-20 text-center">
                        <RefreshCcw className="h-8 w-8 text-primary/20 animate-spin mx-auto mb-4" />
                        <div className="text-muted-foreground font-black text-xs uppercase tracking-widest">Loading admins…</div>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="py-20 text-center">
                        <ShieldCheck className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
                        <div className="text-muted-foreground font-bold">No administrators found</div>
                        <div className="text-muted-foreground/50 text-xs mt-1">Try adjusting your search or invite one above</div>
                    </div>
                ) : (
                    filtered.map((admin, i) => (
                        <div
                            key={admin.id}
                            className={cn(
                                "grid grid-cols-[1fr_140px_100px_140px_auto] gap-4 items-center px-6 py-4 transition-colors hover:bg-muted/10",
                                i !== filtered.length - 1 && "border-b border-slate-50",
                                actionLoading?.startsWith(admin.id) && "opacity-50"
                            )}
                        >
                            {/* Identity */}
                            <div className="flex items-center gap-4 min-w-0">
                                <div className="h-10 w-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-sm font-black shrink-0 shadow-sm">
                                    {(admin.name || admin.email)[0].toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-black text-sm text-foreground truncate">{admin.name || '—'}</span>
                                        {inviteStatusBadge(admin)}
                                    </div>
                                    <div className="text-[11px] font-bold text-muted-foreground/60 truncate">{admin.email}</div>
                                </div>
                            </div>

                            {/* Branch */}
                            <div>
                                <span className="inline-flex items-center gap-1 text-[11px] font-black bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg">
                                    <Building2 className="h-3 w-3" />
                                    {admin.branch || '—'}
                                </span>
                            </div>

                            {/* Active status */}
                            <div>
                                <span className={cn(
                                    "text-[10px] font-black px-2.5 py-1 rounded-lg uppercase",
                                    admin.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                                )}>
                                    {admin.isActive ? 'Active' : 'Inactive'}
                                </span>
                            </div>

                            {/* Last login */}
                            <div className="text-[11px] font-bold text-muted-foreground/60">
                                {admin.lastLogin
                                    ? new Date(admin.lastLogin).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                                    : 'Never'}
                            </div>

                            {/* Deactivate / Reactivate + Delete */}
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => handleAction(admin.isActive ? 'deactivate' : 'reactivate', admin)}
                                    className={cn(
                                        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all border",
                                        admin.isActive
                                            ? "text-amber-600 border-amber-200 hover:bg-amber-50"
                                            : "text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                                    )}
                                >
                                    {admin.isActive
                                        ? <><ShieldOff className="h-3.5 w-3.5" />Deactivate</>
                                        : <><ShieldCheck className="h-3.5 w-3.5" />Reactivate</>}
                                </button>
                                <button
                                    onClick={() => handleAction('delete', admin)}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-black text-red-600 border border-red-200 hover:bg-red-50 transition-all"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />Delete
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Modals */}
            {showInvite && (
                <InviteModal
                    branches={branches}
                    onClose={() => setShowInvite(false)}
                    onSuccess={load}
                />
            )}
            {reassignTarget && (
                <ReassignModal
                    admin={reassignTarget}
                    branches={branches}
                    onClose={() => setReassignTarget(null)}
                    onSuccess={load}
                />
            )}
            {confirm && (
                <ConfirmDialog
                    title={confirm.action === 'delete' ? 'Delete Administrator' : 'Deactivate Administrator'}
                    message={confirm.action === 'delete'
                        ? `Permanently delete ${confirm.admin.email}? This cannot be undone.`
                        : `Deactivate ${confirm.admin.email}? They will lose access immediately.`}
                    confirmLabel={confirm.action === 'delete' ? 'Delete' : 'Deactivate'}
                    danger={true}
                    onConfirm={confirmAction}
                    onCancel={() => setConfirm(null)}
                />
            )}

            {/* Toast */}
            {toast && (
                <div className={cn(
                    "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl text-sm font-black animate-in slide-in-from-bottom-4 duration-300",
                    toast.ok ? "bg-slate-900 text-white" : "bg-red-600 text-white"
                )}>
                    {toast.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                    {toast.msg}
                </div>
            )}
        </div>
    );
}

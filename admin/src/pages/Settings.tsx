import { useEffect, useState } from 'react';
import client from '@/api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    User, Key, Building2, ShieldCheck, LogOut,
    Save, Clock, AlertCircle, RefreshCcw, CheckCircle2, Eye, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, ok }: { msg: string; ok: boolean }) {
    return (
        <div className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl text-sm font-black animate-in slide-in-from-bottom-4 duration-300",
            ok ? "bg-slate-900 text-white" : "bg-red-600 text-white"
        )}>
            {ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            {msg}
        </div>
    );
}

// ─── Section Card ──────────────────────────────────────────────────────────────
function Section({ title, subtitle, icon, children }: {
    title: string; subtitle?: string; icon: React.ReactNode; children: React.ReactNode;
}) {
    return (
        <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-50 flex items-center gap-4">
                <div className="h-10 w-10 rounded-2xl bg-muted/30 flex items-center justify-center text-primary">
                    {icon}
                </div>
                <div>
                    <h2 className="font-black text-base text-foreground">{title}</h2>
                    {subtitle && <p className="text-[12px] font-medium text-muted-foreground/70 mt-0.5">{subtitle}</p>}
                </div>
            </div>
            <div className="px-8 py-6">{children}</div>
        </div>
    );
}

// ─── Field Row ─────────────────────────────────────────────────────────────────
function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
    return (
        <div className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
            <span className="text-[11px] font-black uppercase text-muted-foreground/50 tracking-wider">{label}</span>
            <span className="text-sm font-bold text-foreground">{value || '—'}</span>
        </div>
    );
}

// ─── Password Input ────────────────────────────────────────────────────────────
function PasswordInput({ placeholder, value, onChange }: {
    placeholder: string; value: string; onChange: (v: string) => void;
}) {
    const [show, setShow] = useState(false);
    return (
        <div className="relative">
            <Input
                type={show ? 'text' : 'password'}
                placeholder={placeholder}
                value={value}
                onChange={e => onChange(e.target.value)}
                className="h-11 rounded-xl font-medium border-2 focus-visible:ring-primary/20 pr-11"
            />
            <button
                type="button"
                onClick={() => setShow(s => !s)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-900 transition-colors"
            >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SettingsPage() {
    const navigate = useNavigate();
    const [profile, setProfile] = useState<any>(null);
    const [profileLoading, setProfileLoading] = useState(true);

    // Password change state
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [pwLoading, setPwLoading] = useState(false);
    const [pwError, setPwError] = useState('');

    // Name update state
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState('');
    const [nameLoading, setNameLoading] = useState(false);

    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
    const showToast = (msg: string, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3500);
    };

    useEffect(() => {
        client.get('/admin/me')
            .then(r => setProfile(r.data.profile))
            .catch(() => { })
            .finally(() => setProfileLoading(false));
    }, []);

    const handleChangePassword = async () => {
        setPwError('');
        if (!currentPw || !newPw || !confirmPw) { setPwError('All fields are required'); return; }
        if (newPw !== confirmPw) { setPwError('New passwords do not match'); return; }
        if (newPw.length < 8) { setPwError('Password must be at least 8 characters'); return; }
        setPwLoading(true);
        try {
            await client.post('/admin/change-password', { currentPassword: currentPw, newPassword: newPw });
            showToast('Password updated — please log in again');
            setCurrentPw(''); setNewPw(''); setConfirmPw('');
            setTimeout(() => {
                localStorage.clear();
                navigate('/login');
            }, 2000);
        } catch (e: any) {
            setPwError(e?.response?.data?.error || 'Failed to update password');
        } finally {
            setPwLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.clear();
        navigate('/login');
    };

    const role = localStorage.getItem('adminUserRole');
    const isSuperadmin = role === 'superadmin';

    const handleUpdateName = async () => {
        const trimmed = nameValue.trim();
        if (!trimmed) return;
        setNameLoading(true);
        try {
            await client.patch('/admin/me', { name: trimmed });
            setProfile((p: any) => ({ ...p, name: trimmed }));
            setEditingName(false);
            showToast('Name updated successfully');
        } catch (e: any) {
            showToast(e?.response?.data?.error || 'Failed to update name', false);
        } finally {
            setNameLoading(false);
        }
    };

    return (
        <div className="p-8 max-w-2xl mx-auto space-y-6">
            {/* Page header */}
            <div className="mb-8">
                <h1 className="text-3xl font-black tracking-tight text-foreground">System Settings</h1>
                <p className="text-muted-foreground font-medium mt-1 text-sm">Manage your account and preferences</p>
            </div>

            {/* ── Profile ── */}
            <Section title="My Profile" subtitle="Your account information" icon={<User className="h-5 w-5" />}>
                {profileLoading ? (
                    <div className="flex items-center gap-3 text-muted-foreground">
                        <RefreshCcw className="h-4 w-4 animate-spin" />
                        <span className="text-sm font-medium">Loading profile…</span>
                    </div>
                ) : profile ? (
                    <>
                        {/* Avatar row */}
                        <div className="flex items-center gap-5 mb-6 pb-6 border-b border-slate-50">
                            <div className="h-16 w-16 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-2xl font-black shadow-lg">
                                {(profile.name || profile.email || 'A')[0].toUpperCase()}
                            </div>
                            <div>
                                <div className="text-xl font-black text-foreground">{profile.name || 'Administrator'}</div>
                                <div className="text-sm font-medium text-muted-foreground mt-0.5">{profile.email}</div>
                                <div className="flex items-center gap-2 mt-2">
                                    <span className={cn(
                                        "text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg",
                                        isSuperadmin ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-600"
                                    )}>
                                        {isSuperadmin ? 'Superadmin' : 'Branch Admin'}
                                    </span>
                                    {profile.branch && (
                                        <span className="flex items-center gap-1 text-[10px] font-black bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg uppercase tracking-wider">
                                            <Building2 className="h-3 w-3" />{profile.branch}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <FieldRow label="Email" value={profile.email} />
                        <FieldRow label="Role" value={isSuperadmin ? 'Superadmin' : 'Branch Administrator'} />
                        <FieldRow label="Branch" value={profile.branch || 'All branches'} />
                        <FieldRow
                            label="Last Login"
                            value={profile.lastLoginAt
                                ? new Date(profile.lastLoginAt).toLocaleString(undefined, {
                                    month: 'short', day: 'numeric', year: 'numeric',
                                    hour: '2-digit', minute: '2-digit'
                                })
                                : 'First session'}
                        />

                        {/* ── Edit Name ── */}
                        <div className="pt-4 border-t border-slate-50">
                            {editingName ? (
                                <div className="space-y-3">
                                    <label className="text-[11px] font-black uppercase text-muted-foreground/50 tracking-wider block">Display Name</label>
                                    <div className="flex gap-2">
                                        <Input
                                            autoFocus
                                            value={nameValue}
                                            onChange={e => setNameValue(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') handleUpdateName(); if (e.key === 'Escape') setEditingName(false); }}
                                            placeholder="Enter your name"
                                            className="h-10 rounded-xl font-medium border-2 focus-visible:ring-primary/20 flex-1"
                                        />
                                        <Button
                                            onClick={handleUpdateName}
                                            disabled={!nameValue.trim() || nameLoading}
                                            className="font-black h-10 px-4 flex items-center gap-1.5"
                                        >
                                            {nameLoading ? <RefreshCcw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                            Save
                                        </Button>
                                        <Button variant="ghost" onClick={() => setEditingName(false)} className="font-bold h-10 px-3">Cancel</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-[11px] font-black uppercase text-muted-foreground/50 tracking-wider mb-0.5">Display Name</div>
                                        <div className="text-sm font-bold text-foreground">{profile.name || '—'}</div>
                                    </div>
                                    <button
                                        onClick={() => { setNameValue(profile.name || ''); setEditingName(true); }}
                                        className="text-[11px] font-black text-primary hover:underline px-2 py-1 rounded-lg hover:bg-primary/5 transition-colors"
                                    >
                                        Edit name
                                    </button>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <p className="text-sm text-muted-foreground font-medium">Could not load profile.</p>
                )}
            </Section>

            {/* ── Change Password ── */}
            <Section title="Change Password" subtitle="Update your account password" icon={<Key className="h-5 w-5" />}>
                <div className="space-y-4">
                    <div>
                        <label className="text-[11px] font-black uppercase text-muted-foreground/50 tracking-wider mb-1.5 block">Current password</label>
                        <PasswordInput placeholder="Enter current password" value={currentPw} onChange={setCurrentPw} />
                    </div>
                    <div>
                        <label className="text-[11px] font-black uppercase text-muted-foreground/50 tracking-wider mb-1.5 block">New password</label>
                        <PasswordInput placeholder="At least 8 characters" value={newPw} onChange={setNewPw} />
                    </div>
                    <div>
                        <label className="text-[11px] font-black uppercase text-muted-foreground/50 tracking-wider mb-1.5 block">Confirm new password</label>
                        <PasswordInput placeholder="Repeat new password" value={confirmPw} onChange={setConfirmPw} />
                    </div>

                    {/* Password strength indicator */}
                    {newPw.length > 0 && (
                        <div className="space-y-1.5">
                            <div className="flex gap-1.5">
                                {[
                                    newPw.length >= 8,
                                    /[A-Z]/.test(newPw),
                                    /[0-9]/.test(newPw),
                                    /[^A-Za-z0-9]/.test(newPw),
                                ].map((pass, i) => (
                                    <div key={i} className={cn(
                                        "h-1 flex-1 rounded-full transition-all",
                                        pass ? "bg-emerald-500" : "bg-slate-200"
                                    )} />
                                ))}
                            </div>
                            <div className="text-[10px] font-bold text-muted-foreground/60 flex flex-wrap gap-3">
                                <span className={cn(newPw.length >= 8 ? "text-emerald-600" : "")}>8+ chars</span>
                                <span className={cn(/[A-Z]/.test(newPw) ? "text-emerald-600" : "")}>Uppercase</span>
                                <span className={cn(/[0-9]/.test(newPw) ? "text-emerald-600" : "")}>Number</span>
                                <span className={cn(/[^A-Za-z0-9]/.test(newPw) ? "text-emerald-600" : "")}>Symbol</span>
                            </div>
                        </div>
                    )}

                    {pwError && (
                        <div className="flex items-center gap-2 text-red-600 text-xs font-bold bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />{pwError}
                        </div>
                    )}

                    <Button
                        onClick={handleChangePassword}
                        disabled={!currentPw || !newPw || !confirmPw || pwLoading}
                        className="w-full h-11 font-black flex items-center gap-2 justify-center mt-2"
                    >
                        {pwLoading ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Update Password
                    </Button>
                </div>
            </Section>

            {/* ── Permissions ── */}
            <Section title="Access & Permissions" subtitle="Your role and access scope" icon={<ShieldCheck className="h-5 w-5" />}>
                <div className="space-y-3">
                    {[
                        { label: 'View walk history', granted: true },
                        { label: 'View branch map', granted: true },
                        { label: 'Manage administrators', granted: isSuperadmin },
                        { label: 'Manage all branches', granted: isSuperadmin },
                        { label: 'View system stats', granted: true },
                        { label: 'Delete admin users', granted: isSuperadmin },
                    ].filter(p => p.granted).map(({ label }) => (
                        <div key={label} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                            <span className="text-sm font-bold text-slate-700">{label}</span>
                            <span className="text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wide bg-emerald-100 text-emerald-700">
                                ✓ Granted
                            </span>
                        </div>
                    ))}
                </div>
            </Section>

            {/* ── Session ── */}
            <Section title="Session" subtitle="Manage your active session" icon={<Clock className="h-5 w-5" />}>
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-sm font-black text-foreground">Sign out</div>
                        <div className="text-xs font-medium text-muted-foreground mt-0.5">End your current admin session</div>
                    </div>
                    <Button
                        variant="outline"
                        onClick={handleLogout}
                        className="flex items-center gap-2 font-black text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                    >
                        <LogOut className="h-4 w-4" />
                        Sign Out
                    </Button>
                </div>
            </Section>



            {toast && <Toast msg={toast.msg} ok={toast.ok} />}
        </div>
    );
}

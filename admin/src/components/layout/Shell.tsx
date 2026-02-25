import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Settings,
    LogOut,
    Bell,
    ChevronRight,
    User,
    ShieldCheck,
    Zap,
    Menu,
    X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ShellProps {
    children: React.ReactNode;
}

export default function Shell({ children }: ShellProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const role = localStorage.getItem('adminUserRole');
    const branch = localStorage.getItem('adminUserBranch');
    const email = "Admin User"; // Mock name, normally from state

    const handleLogout = () => {
        localStorage.clear();
        navigate('/login');
    };

    const navItems = [
        { label: 'Overview', icon: LayoutDashboard, path: '/' },
        ...(role === 'superadmin' ? [{ label: 'Administrators', icon: ShieldCheck, path: '/admins' }] : []),
        { label: 'System Settings', icon: Settings, path: '/settings' },
    ];

    return (
        <div className="flex h-screen bg-[#F8FAFC] overflow-hidden font-sans selection:bg-primary/10">
            {/* Desktop Sidebar */}
            <aside className="w-72 bg-white border-r border-slate-200 hidden lg:flex flex-col shadow-[4px_0_24px_-10px_rgba(0,0,0,0.02)]">
                <div className="p-8 pb-10">
                    <div className="flex items-center gap-3 group cursor-pointer" onClick={() => navigate('/')}>
                        <div className="h-11 w-11 bg-primary rounded-2xl flex items-center justify-center shadow-[0_10px_20px_-5px_rgba(59,130,246,0.3)] group-hover:scale-105 transition-all duration-300">
                            <Zap className="h-6 w-6 text-white fill-white/20" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900 tracking-tight leading-none">Kharis</h2>
                            <p className="text-[10px] font-black text-primary/60 uppercase tracking-[0.2em] mt-1.5">Prayer Walk</p>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 px-4 space-y-2">
                    <p className="px-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Main Menu</p>
                    {navItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        return (
                            <Button
                                key={item.path}
                                variant="ghost"
                                className={cn(
                                    "w-full justify-between gap-3 h-12 px-4 rounded-xl transition-all duration-300 group",
                                    isActive
                                        ? "bg-slate-900 text-white shadow-xl shadow-slate-900/10 hover:bg-slate-800"
                                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                                )}
                                onClick={() => navigate(item.path)}
                            >
                                <div className="flex items-center gap-3 font-bold text-sm">
                                    <item.icon className={cn("h-4.5 w-4.5 transition-colors", isActive ? "text-primary-foreground" : "text-slate-400 group-hover:text-slate-900")} />
                                    {item.label}
                                </div>
                                {isActive && <div className="h-1.5 w-1.5 rounded-full bg-primary ring-4 ring-primary/20" />}
                            </Button>
                        );
                    })}
                </nav>

                <div className="p-6 mt-auto">
                    {role !== 'superadmin' && (
                        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 mb-6 relative overflow-hidden group">
                            <div className="absolute -right-4 -top-4 h-16 w-16 bg-primary/5 rounded-full transition-transform group-hover:scale-150" />
                            <div className="flex items-center gap-3 mb-3">
                                <div className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                                    <User className="h-4 w-4 text-slate-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-black text-slate-900 truncate">Branch</p>
                                    <p className="text-[10px] font-bold text-slate-500 truncate uppercase mt-0.5 tracking-wider">{branch || 'International'}</p>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                className="w-full justify-start gap-2 h-9 px-3 text-xs font-black text-slate-600 hover:text-destructive hover:bg-destructive/5 rounded-lg transition-all"
                                onClick={handleLogout}
                            >
                                <LogOut className="h-3.5 w-3.5" />
                                Logout Session
                            </Button>
                        </div>
                    )}

                    {role === 'superadmin' && (
                        <div className="mb-6">
                            <Button
                                variant="outline"
                                className="w-full justify-start gap-2 h-11 px-4 text-xs font-black text-slate-600 hover:text-destructive hover:bg-destructive/5 border-slate-200 rounded-xl transition-all"
                                onClick={handleLogout}
                            >
                                <LogOut className="h-4 w-4" />
                                Logout Session
                            </Button>
                        </div>
                    )}

                    <p className="text-center text-[9px] font-black text-slate-300 uppercase tracking-widest">
                        Kharis Foundation © 2026
                    </p>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col overflow-hidden relative">
                {/* Top Header */}
                <header className="h-20 bg-white/80 backdrop-blur-xl border-b border-slate-100 flex items-center justify-between px-8 z-50 shrink-0">
                    <div className="lg:hidden flex items-center gap-3">
                        <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(true)}>
                            <Menu className="h-6 w-6" />
                        </Button>
                        <h2 className="font-black text-slate-900">Kharis</h2>
                    </div>

                    <div className="hidden lg:flex items-center gap-2 text-sm">
                        <span className="text-slate-400 font-bold">Pages</span>
                        <ChevronRight className="h-3 w-3 text-slate-300" />
                        <span className="text-slate-900 font-black tracking-tight">
                            {navItems.find(i => i.path === location.pathname)?.label || 'Overview'}
                        </span>
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="hidden md:flex flex-col items-end">
                            <p className="text-xs font-black text-slate-900">{email}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Administrator</p>
                        </div>
                        <div className="h-8 w-[1px] bg-slate-100" />
                        <div className="flex items-center gap-3">
                            <div className="relative group">
                                <Button variant="ghost" size="icon" className="h-10 w-10 text-slate-400 hover:text-slate-900 hover:bg-slate-50 rounded-xl relative">
                                    <Bell className="h-5 w-5" />
                                    <span className="absolute top-2.5 right-2.5 h-2 w-2 bg-primary rounded-full ring-2 ring-white" />
                                </Button>

                                {/* Notification Popover Placeholder */}
                                <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-2xl opacity-0 translate-y-2 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto transition-all z-[100] p-4 text-center">
                                    <div className="h-12 w-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <Bell className="h-6 w-6 text-slate-300" />
                                    </div>
                                    <p className="text-sm font-black text-slate-900">No Notifications</p>
                                    <p className="text-xs text-slate-400 mt-1 font-medium">We'll alert you when there's new activity.</p>
                                </div>
                            </div>

                            <div className="h-10 w-10 rounded-xl bg-slate-900 shadow-lg shadow-slate-900/20 flex items-center justify-center text-white text-xs font-black cursor-pointer hover:bg-slate-800 transition-colors">
                                {role === 'superadmin' ? 'SA' : 'AD'}
                            </div>
                        </div>
                    </div>
                </header>

                {/* Content Scroll Area */}
                <div className="flex-1 overflow-auto">
                    {children}
                </div>

                {/* Mobile Menu Overlay */}
                {mobileMenuOpen && (
                    <div className="fixed inset-0 z-[100] lg:hidden">
                        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
                        <aside className="absolute top-0 left-0 w-72 h-full bg-white animate-in slide-in-from-left duration-300">
                            <div className="p-8 flex justify-between items-center">
                                <h2 className="font-black text-xl">Kharis</h2>
                                <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
                                    <X className="h-5 w-5" />
                                </Button>
                            </div>
                            {/* Mobile version of nav items can go here */}
                            <div className="px-4 mt-4 text-center text-slate-400 italic font-medium px-8 text-sm">
                                Mobile menu content synced with desktop sidebar.
                            </div>
                        </aside>
                    </div>
                )}
            </main>
        </div>
    );
}

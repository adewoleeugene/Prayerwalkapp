import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, Lock, Loader2, ArrowRight } from 'lucide-react';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await client.post('/auth/login', { email, password });

            const user = res.data.user;
            if (user.role !== 'admin' && user.role !== 'superadmin') {
                setError('Access denied: Admin permissions required.');
                setLoading(false);
                return;
            }

            localStorage.setItem('adminToken', res.data.token);
            localStorage.setItem('adminUserRole', user.role);
            localStorage.setItem('adminUserBranch', user.branch || '');
            navigate('/');
        } catch (err: any) {
            setError(err.response?.data?.error || 'Invalid credentials. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen w-full flex items-center justify-center p-4 overflow-hidden bg-[#0A0C10]">
            {/* Dynamic Background */}
            <div
                className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-40 scale-105"
                style={{ backgroundImage: 'url("/v2/login-bg.png")' }}
            />
            <div className="absolute inset-0 z-0 bg-gradient-to-b from-transparent via-[#0A0C10]/60 to-[#0A0C10]" />

            {/* Animated Glows */}
            <div className="absolute top-1/4 -left-20 w-96 h-96 bg-primary/20 rounded-full blur-[120px] animate-pulse" />
            <div className="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full blur-[120px] animate-pulse" style={{ backgroundColor: 'rgba(212, 175, 55, 0.1)' }} />

            <Card className="relative z-10 w-full max-w-[440px] border-white/10 bg-black/40 backdrop-blur-2xl shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

                <CardHeader className="pt-10 pb-6 space-y-2 text-center">
                    <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4 border border-primary/20 shadow-inner">
                        <span className="text-2xl font-bold tracking-tighter text-white">KW</span>
                    </div>
                    <CardTitle className="text-3xl font-extrabold tracking-tight text-white">
                        Welcome Back
                    </CardTitle>
                    <CardDescription className="text-gray-400 text-base font-medium">
                        Enter your credentials to manage prayer walks
                    </CardDescription>
                </CardHeader>

                <form onSubmit={handleLogin}>
                    <CardContent className="space-y-5 px-8">
                        {error && (
                            <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-4 rounded-xl text-center font-semibold animate-in fade-in slide-in-from-top-2">
                                {error}
                            </div>
                        )}

                        <div className="space-y-2.5">
                            <label className="text-sm font-semibold text-gray-300 ml-1">Email Address</label>
                            <div className="relative group">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500 transition-colors group-focus-within:text-primary" />
                                <Input
                                    type="email"
                                    placeholder="pastor@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="h-12 pl-12 bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:ring-primary/20 focus:border-primary/50 rounded-xl transition-all"
                                />
                            </div>
                        </div>

                        <div className="space-y-2.5">
                            <div className="flex justify-between items-center ml-1">
                                <label className="text-sm font-semibold text-gray-300">Password</label>
                                <button type="button" className="text-xs font-bold text-primary/80 hover:text-primary transition-colors">
                                    Forgot?
                                </button>
                            </div>
                            <div className="relative group">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500 transition-colors group-focus-within:text-primary" />
                                <Input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    placeholder="••••••••"
                                    className="h-12 pl-12 bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:ring-primary/20 focus:border-primary/50 rounded-xl transition-all"
                                />
                            </div>
                        </div>
                    </CardContent>

                    <CardFooter className="pt-8 pb-10 px-8">
                        <Button
                            type="submit"
                            className="w-full h-12 text-base font-bold rounded-xl bg-primary text-white shadow-[0_10px_20px_-10px_rgba(59,130,246,0.5)] hover:shadow-[0_15px_25px_-10px_rgba(59,130,246,0.6)] hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                    Authenticating...
                                </>
                            ) : (
                                <>
                                    Sign In
                                    <ArrowRight className="h-5 w-5" />
                                </>
                            )}
                        </Button>
                    </CardFooter>
                </form>
            </Card>

            {/* Footer Branding */}
            <div className="absolute bottom-8 left-0 w-full text-center z-10">
                <p className="text-gray-500 text-xs font-semibold tracking-[0.2em] uppercase">
                    Powered by Kharis Prayer Walk • v1.2.0
                </p>
            </div>
        </div>
    );
}

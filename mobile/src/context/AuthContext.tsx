import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types/index';

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string, name: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
    children: React.ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
    // Hardcoded guest user so the app works without a login process
    const [user, setUser] = useState<User | null>({
        id: '00000000-0000-0000-0000-000000000000',
        email: 'guest@charis.com',
        name: 'Guest User',
        stats: {
            totalCompletions: 0,
            totalPoints: 0,
            totalDistanceMeters: 0,
            badgesCount: 0
        }
    });
    const [token, setToken] = useState<string | null>('bypass-token');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        // No initialization needed as we've hardcoded the state
        setIsLoading(false);
    }, []);

    const login = async () => { };
    const signup = async () => { };
    const logout = async () => { };

    return (
        <AuthContext.Provider value={{ user, token, isLoading, login, signup, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};

import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import Constants from 'expo-constants';

const DEVICE_FINGERPRINT_KEY = 'device_fingerprint';
const DEFAULT_API_PORT = '3001';

function isTunnelHost(hostname: string): boolean {
    return hostname.endsWith('.exp.direct') || hostname.includes('exp.host') || hostname.endsWith('.expo.dev');
}

function pickHostFromUri(raw: unknown): string | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;

    const trimmed = raw.trim();
    try {
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('exp://')) {
            return new URL(trimmed).hostname || null;
        }
    } catch {
        // Continue with host:port parsing fallback.
    }

    return trimmed.split(':')[0] || null;
}

function resolveBaseUrl() {
    const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (envUrl) {
        return envUrl;
    }

    const expoHostCandidates = [
        pickHostFromUri((Constants as any)?.expoConfig?.hostUri),
        pickHostFromUri((Constants as any)?.manifest?.debuggerHost),
        pickHostFromUri((Constants as any)?.manifest2?.extra?.expoClient?.hostUri),
    ].filter(Boolean) as string[];

    const preferredExpoHost = expoHostCandidates.find((host) => !isTunnelHost(host));
    if (preferredExpoHost) {
        return `http://${preferredExpoHost}:${DEFAULT_API_PORT}`;
    }

    const scriptURL = (NativeModules as any)?.SourceCode?.scriptURL;
    if (scriptURL) {
        try {
            const metroHost = new URL(scriptURL).hostname;
            if (metroHost && metroHost !== 'localhost' && metroHost !== '127.0.0.1' && !isTunnelHost(metroHost)) {
                return `http://${metroHost}:${DEFAULT_API_PORT}`;
            }
        } catch {
            // Ignore parsing errors and fall through.
        }
    }

    // Last resort for simulators/emulators running on the same machine.
    return `http://127.0.0.1:${DEFAULT_API_PORT}`;
}

const BASE_URL = resolveBaseUrl();
if (__DEV__) {
    console.log(`[API] BASE_URL=${BASE_URL}`);
}

const client = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        'bypass-tunnel-reminder': 'true',
    },
});

client.interceptors.request.use(async (config) => {
    const headers = config.headers ?? {};
    const fingerprint = await AsyncStorage.getItem(DEVICE_FINGERPRINT_KEY);

    (headers as any).Authorization = `Bearer bypass-token`;
    if (fingerprint) {
        (headers as any)['x-device-fingerprint'] = fingerprint;
    }

    config.headers = headers;
    return config;
});

export function getWebSocketUrl(token: string | null, fingerprint?: string) {
    const httpUrl = new URL(BASE_URL);
    const wsProtocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = new URL('/ws', `${wsProtocol}//${httpUrl.host}`);

    wsUrl.searchParams.set('token', token || 'bypass-token');
    if (fingerprint) {
        wsUrl.searchParams.set('fp', fingerprint);
    }

    return wsUrl.toString();
}

export const api = {
    auth: {
        login: (email: string, password: string) => client.post('/auth/login', { email, password }),
        signup: (email: string, password: string, name: string) => client.post('/auth/signup', { email, password, name }),
        me: () => client.get('/users/me'),
    },
    locations: {
        list: (lat: number, lng: number, radius: number) => client.get('/locations', { params: { lat, lng, radius } }),
        get: (id: string) => client.get(`/locations/${id}`),
    },
    branches: {
        list: (lat?: number, lng?: number, radius?: number) =>
            client.get('/branches', {
                params: {
                    lat,
                    lng,
                    radius,
                }
            }),
    },
    walks: {
        start: (locationId: string, latitude: number, longitude: number, deviceFingerprint?: string, branch?: string, participants?: string[], startAddress?: string) =>
            client.post('/walks/start', { locationId, latitude, longitude, deviceFingerprint, branch, participants, startAddress }),
        history: (
            limit = 80,
            options?: {
                branch?: string;
                days?: number;
                walkType?: 'all' | 'path' | 'area';
                includeActive?: boolean;
            }
        ) => client.get('/walks/history', {
            params: {
                limit,
                branch: options?.branch,
                days: options?.days ?? 14,
                walkType: options?.walkType ?? 'all',
                includeActive: options?.includeActive ?? true,
            }
        }),
        track: (sessionId: string, latitude: number, longitude: number, speed?: number, accuracy?: number, isMock?: boolean) =>
            client.post('/walks/track', { sessionId, latitude, longitude, speed, accuracy, isMock }),
        arrive: (sessionId: string, locationId: string, latitude: number, longitude: number) =>
            client.post('/walks/arrive', { sessionId, locationId, latitude, longitude }),
        complete: (
            sessionId: string,
            locationId: string,
            latitude: number,
            longitude: number,
            prayerSummary?: string,
            prayerJournal?: string
        ) =>
            client.post('/walks/complete', { sessionId, locationId, latitude, longitude, prayerSummary, prayerJournal }),
    },
};

export default client;

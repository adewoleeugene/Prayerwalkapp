import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';

const DEVICE_FINGERPRINT_KEY = 'device_fingerprint';
const DEFAULT_LAN_BASE_URL = 'http://192.168.1.195:3001';

function isTunnelHost(hostname: string): boolean {
    return hostname.endsWith('.exp.direct') || hostname.includes('exp.host');
}

function resolveBaseUrl() {
    const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (envUrl) {
        return envUrl;
    }

    const scriptURL = (NativeModules as any)?.SourceCode?.scriptURL;
    if (scriptURL) {
        try {
            const metroHost = new URL(scriptURL).hostname;
            if (metroHost && !isTunnelHost(metroHost)) {
                return `http://${metroHost}:3001`;
            }
        } catch {
            // Fall through to platform defaults.
        }
    }

    // Fall back to LAN backend for local development.
    return DEFAULT_LAN_BASE_URL;
}

const BASE_URL = resolveBaseUrl();

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
    walks: {
        start: (locationId: string, latitude: number, longitude: number, deviceFingerprint?: string, branch?: string, participants?: string[]) =>
            client.post('/walks/start', { locationId, latitude, longitude, deviceFingerprint, branch, participants }),
        arrive: (sessionId: string, locationId: string, latitude: number, longitude: number) =>
            client.post('/walks/arrive', { sessionId, locationId, latitude, longitude }),
        complete: (sessionId: string, locationId: string, latitude: number, longitude: number) =>
            client.post('/walks/complete', { sessionId, locationId, latitude, longitude }),
    },
};

export default client;

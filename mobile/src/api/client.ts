import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveApiBaseUrl } from '../network/baseUrl';

const DEVICE_FINGERPRINT_KEY = 'device_fingerprint';
const BASE_URL = resolveApiBaseUrl();
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
        start: (
            locationId: string | undefined,
            latitude: number,
            longitude: number,
            deviceFingerprint?: string,
            branch?: string,
            participants?: string[],
            startAddress?: string,
            meta?: {
                clientRequestId?: string;
                clientEventAt?: string;
                localSessionId?: string;
            }
        ) =>
            client.post('/walks/start', { locationId, latitude, longitude, deviceFingerprint, branch, participants, startAddress, ...meta }),
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
        track: (
            sessionId: string,
            latitude: number,
            longitude: number,
            speed?: number,
            accuracy?: number,
            isMock?: boolean,
            meta?: {
                clientRequestId?: string;
                clientEventAt?: string;
            }
        ) =>
            client.post('/walks/track', { sessionId, latitude, longitude, speed, accuracy, isMock, ...meta }),
        arrive: (
            sessionId: string,
            locationId: string,
            latitude: number,
            longitude: number,
            meta?: {
                clientRequestId?: string;
                clientEventAt?: string;
            }
        ) =>
            client.post('/walks/arrive', { sessionId, locationId, latitude, longitude, ...meta }),
        complete: (
            sessionId: string,
            locationId: string | undefined,
            latitude: number,
            longitude: number,
            prayerSummary?: string,
            prayerJournal?: string,
            meta?: {
                clientRequestId?: string;
                clientEventAt?: string;
                localSessionId?: string;
            }
        ) =>
            client.post('/walks/complete', { sessionId, locationId, latitude, longitude, prayerSummary, prayerJournal, ...meta }),
    },
};

export default client;

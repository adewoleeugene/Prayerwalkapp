import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Use a secure tunnel so the phone can reach the Mac backend from anywhere
const BASE_URL = 'https://charis-prayer-live-v101.loca.lt';

const client = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        'bypass-tunnel-reminder': 'true',
    },
});

client.interceptors.request.use(async (config) => {
    // Hardcoded bypass token to match the simplified AuthContext
    config.headers.Authorization = `Bearer bypass-token`;
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

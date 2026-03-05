import axios from 'axios';

const configuredApiUrl = (import.meta.env.VITE_API_URL || '').trim();
const isBrowser = typeof window !== 'undefined';
const shouldIgnoreLocalhostUrl =
    isBrowser &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredApiUrl) &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';

const client = axios.create({
    // In production, fallback to same-origin to avoid broken localhost bundles.
    baseURL: shouldIgnoreLocalhostUrl ? '' : configuredApiUrl,
});

client.interceptors.request.use((config) => {
    const token = localStorage.getItem('adminToken');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

client.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('adminToken');
            const isV2 = window.location.pathname.startsWith('/v2');
            window.location.href = isV2 ? '/v2/login' : '/admin-login.html';
        }
        return Promise.reject(error);
    }
);

export default client;

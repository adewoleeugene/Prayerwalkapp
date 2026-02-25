import axios from 'axios';

const client = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '',
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

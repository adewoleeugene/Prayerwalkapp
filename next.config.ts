import type { NextConfig } from 'next';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    // OpenStreetMap tiles — stale-while-revalidate, cached for 7 days
    {
      urlPattern: /^https:\/\/[a-c]\.tile\.openstreetmap\.org\/.*/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'osm-tiles',
        expiration: { maxEntries: 1000, maxAgeSeconds: 7 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    // API routes — network-first so fresh data wins; falls back to cache
    {
      urlPattern: /^\/api\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'api-cache',
        networkTimeoutSeconds: 10,
        expiration: { maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    // Next.js static assets — cache-first, long TTL (content-hashed filenames)
    {
      urlPattern: /\/_next\/static\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'next-static',
        expiration: { maxEntries: 200, maxAgeSeconds: 365 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    // Images and icons — cache-first, 30 days
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'images',
        expiration: { maxEntries: 128, maxAgeSeconds: 30 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
  ],
});

function corsHeaders(origin: string) {
  return [
    { key: 'Access-Control-Allow-Origin', value: origin },
    { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,PATCH,OPTIONS' },
    {
      key: 'Access-Control-Allow-Headers',
      value: 'Content-Type,Authorization,x-device-fingerprint,x-idempotency-key,x-bootstrap-key',
    },
    { key: 'Access-Control-Allow-Credentials', value: 'true' },
  ];
}

const nextConfig: NextConfig = {
  async headers() {
    const allowed = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = allowed.length > 0 ? allowed[0] : '*';
    const cors = corsHeaders(origin);
    return [
      // Admin dashboard API
      { source: '/api/:path*', headers: cors },
      // Mobile app legacy paths (before rewrite, CORS must be on the source)
      { source: '/walks/:path*', headers: cors },
      { source: '/locations', headers: cors },
      { source: '/locations/:id', headers: cors },
      { source: '/branches', headers: cors },
      { source: '/auth/:path*', headers: cors },
      { source: '/users/:path*', headers: cors },
      { source: '/search', headers: cors },
      { source: '/health', headers: cors },
    ];
  },

  async rewrites() {
    return [
      // Rewrite mobile app paths (no /api prefix) → Next.js route handlers
      { source: '/walks/start', destination: '/api/walks/start' },
      { source: '/walks/track', destination: '/api/walks/track' },
      { source: '/walks/arrive', destination: '/api/walks/arrive' },
      { source: '/walks/complete', destination: '/api/walks/complete' },
      { source: '/walks/history', destination: '/api/walks/history' },
      { source: '/locations', destination: '/api/locations' },
      { source: '/locations/:id', destination: '/api/locations/:id' },
      { source: '/branches', destination: '/api/branches' },
      { source: '/auth/signup', destination: '/api/auth/signup' },
      { source: '/auth/login', destination: '/api/auth/login' },
      { source: '/auth/forgot-password', destination: '/api/auth/forgot-password' },
      { source: '/auth/reset-password', destination: '/api/auth/reset-password' },
      { source: '/auth/url-login', destination: '/api/auth/url-login' },
      { source: '/auth/invite/accept', destination: '/api/auth/invite/accept' },
      { source: '/users/me', destination: '/api/users/me' },
      { source: '/search', destination: '/api/search' },
      { source: '/health', destination: '/api/health' },
    ];
  },
};

export default withPWA(nextConfig);

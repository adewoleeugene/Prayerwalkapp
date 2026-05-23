import type { NextConfig } from 'next';

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

export default nextConfig;

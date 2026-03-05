# Vercel Backend Deploy (Polling-Only)

This backend is now HTTP-only (no WebSocket server), so it is compatible with Vercel Functions.

## 1) Prerequisites

- Vercel project connected to this repo
- Reachable Postgres database (Neon is fine)
- Production JWT secret

## 2) Required environment variables (Vercel Project Settings)

- `DATABASE_URL`
- `JWT_SECRET`
- `NODE_ENV=production`

Optional (if used by your flows):

- `APP_BASE_URL`
- `MAIL_*` variables for email delivery

## 3) Deploy

From the Vercel dashboard:

- Import/connect the repository
- Ensure Root Directory is this backend repo root
- Add env vars above
- Deploy

Or with CLI:

```bash
vercel
vercel --prod
```

## 4) Verify after deploy

- `GET /health` returns `200` with JSON status
- `POST /auth/login` works
- `GET /branches` works

## 5) Client updates

Point clients to the deployed backend:

- Admin: `VITE_API_URL=https://<your-backend-domain>`
- Mobile: `EXPO_PUBLIC_API_BASE_URL=https://<your-backend-domain>`

## 6) Important note

Vercel Functions do not host a persistent WebSocket server. This codebase is prepared for polling/HTTP endpoints (`/walks/track`, history refresh, etc.).

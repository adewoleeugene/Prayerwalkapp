# Charis Prayer Walk Backend (Phase Two)

Production-oriented Node.js + TypeScript backend using Prisma with Neon PostgreSQL, REST APIs, JWT auth, and WebSocket GPS tracking.

## 1) Prerequisites

- Node.js 20+
- Neon `DATABASE_URL`
- Existing Phase One schema already applied in Neon

## 2) Environment

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Required values:

- `DATABASE_URL` Neon connection string
- `JWT_SECRET` at least 16 chars

## 3) Install + Prisma setup

```bash
npm install
npm run prisma:pull
npm run prisma:generate
```

Notes:
- `prisma db pull` introspects your live Neon schema (no schema modifications).
- This project does not run Prisma migrations by default, since schema already exists.

## 4) Run

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

## 5) API Endpoints

### Auth
- `POST /auth/signup`
  - body: `{ "email": "", "password": "", "name": "", "branch": "" }`
- `POST /auth/login`
  - body: `{ "email": "", "password": "" }`

### Locations
- `GET /locations`
- `GET /locations/nearby?lat=...&lng=...&radius=...`
- `GET /locations/:id`

### Walks (Bearer JWT)
- `POST /walks/start`
  - body: `{ "locationId": "uuid" }`
- `POST /walks/arrive`
  - body: `{ "sessionId": "uuid", "locationId": "uuid", "lat": 0, "lng": 0 }`
- `POST /walks/complete`
  - body: `{ "sessionId": "uuid", "locationId": "uuid", "lat": 0, "lng": 0 }`

### Profile (Bearer JWT)
- `GET /me`

## 6) WebSocket

Connect to:

- `ws://localhost:3000/ws?token=<JWT>`

Send GPS updates:

```json
{
  "type": "gps:update",
  "payload": {
    "sessionId": "uuid",
    "lat": 32.777,
    "lng": -96.797
  }
}
```

Server updates `prayer_sessions` with latest GPS and distance increments.

## 7) Schema assumptions to verify

At startup, server validates required tables/columns used by the app logic:
- `users`: `id`, `email`, `password_hash`
- `prayer_locations`: `id`, `latitude`, `longitude`
- `prayers`: `id`, `location_id`
- `prayer_sessions`: `id`, `user_id`, `location_id`
- `completions`: `id`, `user_id`, `location_id`
- `badges`: `id`, `user_id`, `name`

If your existing Phase One column names differ, adjust SQL in route/service files accordingly.

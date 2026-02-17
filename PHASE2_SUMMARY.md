# Phase 2: Application Logic Layer - Complete

The backend logic for Charis Prayer Walk (Phase 2) has been implemented using Express, Prisma (with Raw Queries for PostGIS), and WebSockets.

## 🚀 Features Implemented

### 1. Authentication (`src/routes/auth.ts`)
- **Signup**: Email/password registration with validation.
- **Login**: JWT token generation.
- **Middleware**: `src/middleware/authMiddleware.ts` protects routes.

### 2. Prayer Locations (`src/routes/locations.ts`)
- `GET /locations`: List active locations (supports geo-search `?lat=&lng=&radius=`).
- `GET /locations/:id`: Get location details (including completion status).
- **Note**: Uses raw PostGIS queries to correctly handle spatial data.

### 3. Prayer Walk Logic (`src/routes/walks.ts`)
- `POST /walks/start`: Start a new session.
- `POST /walks/arrive`: Verify arrival at location (geo-fenced).
- `POST /walks/complete`: Mark as done, award points, trigger badges.
- **Robustness**: Uses raw SQL for geometry inserts/updates (`ST_GeomFromGeoJSON`) ensuring compatibility with Neon PostGIS.

### 4. User Profile (`src/routes/user.ts`)
- `GET /me`: Returns profile, stats, recent activity, active session, and badges.

### 5. Badge Engine (`src/lib/badges.ts`)
- Automatically awards badges based on:
  - Completion counts (1, 5, 20...)
  - Distance walked
  - Categories explored
  - Streaks
  - Early bird activity

### 6. Real-time Tracking (`src/server.ts`)
- WebSocket server runs on same port as HTTP.
- Authenticates using JWT token in query string (`ws://host/ws?token=...`).
- Handles `LOCATION_UPDATE` messages to update `currentLocation` in database.

## 📂 Project Structure

```
src/
├── lib/
│   ├── db.ts           # Prisma client + PostGIS helpers + Raw Query Wrapper
│   ├── auth.ts         # JWT & hashing utilities
│   └── badges.ts       # Badge logic
├── middleware/
│   └── authMiddleware.ts # JWT verification
├── routes/
│   ├── auth.ts         # Signup/Login
│   ├── locations.ts    # Discovery
│   ├── walks.ts        # Walk flow
│   └── user.ts         # Profile
└── server.ts           # Main Express + WebSocket app
```

## 🛠 How to Run

1. **Install Dependencies** (if not already):
   ```bash
   npm install
   ```

2. **Generate Prisma Client**:
   ```bash
   npx prisma generate
   ```

3. **Start Server**:
   ```bash
   # Development (watch mode)
   npm run dev
   
   # Production
   npm start
   ```
   *Note: Server runs on port 3000 by default (or process.env.PORT).*

## 🗄 Database

The Prisma schema (`prisma/schema.prisma`) matches the Phase 2 requirements. 
*Note: Geometry columns are defined as `Unsupported` or `String` in Prisma schema, but handled via Raw Queries in the application logic for full PostGIS support.*

Ensure your Neon database has these tables. You can run the SQL in `database/schema-phase2.sql` if needed:
```bash
psql $DATABASE_URL -f database/schema-phase2.sql
```

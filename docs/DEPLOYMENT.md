# Charis Prayer Walk - Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Neon Database Setup](#neon-database-setup)
3. [PostGIS Configuration](#postgis-configuration)
4. [Backend Deployment](#backend-deployment)
5. [Mobile App Configuration](#mobile-app-configuration)
6. [Environment Variables](#environment-variables)
7. [Database Migrations](#database-migrations)
8. [Performance Optimization](#performance-optimization)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js** 18+ and npm/yarn
- **Neon account** (https://neon.tech)
- **Vercel account** (for backend deployment)
- **Expo account** (for mobile app)
- **SMS Provider** account (Twilio or Africa's Talking)

---

## Neon Database Setup

### 1. Create a Neon Project

1. Go to https://console.neon.tech
2. Click "Create Project"
3. Choose a name: `charis-prayer-walk`
4. Select region closest to your users
5. Click "Create Project"

### 2. Get Connection String

1. In your Neon dashboard, go to "Connection Details"
2. Copy the connection string (it looks like):
   ```
   postgresql://username:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```
3. Save this for your `.env.local` file

### 3. Enable PostGIS Extension

**Option A: Via Neon Console (Recommended)**
1. In Neon dashboard, navigate to your database
2. Click on "Extensions" in the sidebar
3. Find "postgis" in the list
4. Click "Enable"
5. Wait for confirmation

**Option B: Via SQL Query**
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### 4. Verify PostGIS Installation

Run this query in the Neon SQL Editor:
```sql
SELECT PostGIS_version();
```

You should see output like: `3.3 USE_GEOS=1 USE_PROJ=1 USE_STATS=1`

---

## PostGIS Configuration

### Understanding PostGIS in Neon

PostGIS adds spatial capabilities to PostgreSQL. Key concepts:

- **Geometry Types**: Point, LineString, Polygon
- **SRID 4326**: WGS 84 coordinate system (standard GPS coordinates)
- **Geography vs Geometry**: Geography uses meters, Geometry uses degrees

### Spatial Data Format

All spatial data is stored as GeoJSON and converted to PostGIS geometry:

**Point (GPS location):**
```json
{
  "type": "Point",
  "coordinates": [longitude, latitude]
}
```

**LineString (prayer walk route):**
```json
{
  "type": "LineString",
  "coordinates": [
    [lng1, lat1],
    [lng2, lat2],
    [lng3, lat3]
  ]
}
```

**Polygon (coverage area):**
```json
{
  "type": "Polygon",
  "coordinates": [[
    [lng1, lat1],
    [lng2, lat2],
    [lng3, lat3],
    [lng1, lat1]
  ]]
}
```

---

## Backend Deployment

### Local Development

1. **Clone and Install Dependencies**
   ```bash
   cd /Users/christexfoundation/Documents/KharisPrayerWalk
   npm install
   ```

2. **Install Required Packages**
   ```bash
   npm install @prisma/client prisma jsonwebtoken
   npm install -D @types/jsonwebtoken
   ```

3. **Configure Environment Variables**
   ```bash
   cp .env.prayer-walk .env.local
   # Edit .env.local with your Neon connection string
   ```

4. **Run Database Migrations**
   ```bash
   # Generate Prisma Client
   npx prisma generate
   
   # Run migrations (using the SQL file)
   psql $DATABASE_URL -f database/migrations/001_initial_schema.sql
   ```

5. **Start Development Server**
   ```bash
   npm run dev
   ```

### Production Deployment (Vercel)

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy**
   ```bash
   vercel
   ```

4. **Set Environment Variables in Vercel**
   ```bash
   vercel env add DATABASE_URL
   vercel env add JWT_SECRET
   vercel env add SMS_PROVIDER
   # Add other environment variables as needed
   ```

5. **Deploy to Production**
   ```bash
   vercel --prod
   ```

---

## Mobile App Configuration

### Expo Setup

1. **Navigate to Mobile Directory**
   ```bash
   mkdir -p mobile
   cd mobile
   ```

2. **Initialize Expo App**
   ```bash
   npx create-expo-app@latest . --template blank-typescript
   ```

3. **Install Dependencies**
   ```bash
   npx expo install expo-location expo-task-manager expo-background-fetch
   npm install @react-native-async-storage/async-storage
   ```

4. **Configure app.json**
   ```json
   {
     "expo": {
       "name": "Charis Prayer Walk",
       "slug": "charis-prayer-walk",
       "version": "1.0.0",
       "orientation": "portrait",
       "icon": "./assets/icon.png",
       "userInterfaceStyle": "light",
       "splash": {
         "image": "./assets/splash.png",
         "resizeMode": "contain",
         "backgroundColor": "#ffffff"
       },
       "ios": {
         "supportsTablet": true,
         "bundleIdentifier": "com.christex.charisprayerwalk",
         "infoPlist": {
           "NSLocationWhenInUseUsageDescription": "We need your location to track your prayer walk route.",
           "NSLocationAlwaysAndWhenInUseUsageDescription": "We need your location to track your prayer walk route even when the app is in the background.",
           "UIBackgroundModes": ["location"]
         }
       },
       "android": {
         "adaptiveIcon": {
           "foregroundImage": "./assets/adaptive-icon.png",
           "backgroundColor": "#ffffff"
         },
         "package": "com.christex.charisprayerwalk",
         "permissions": [
           "ACCESS_FINE_LOCATION",
           "ACCESS_COARSE_LOCATION",
           "ACCESS_BACKGROUND_LOCATION",
           "FOREGROUND_SERVICE"
         ]
       }
     }
   }
   ```

5. **Configure Environment Variables**
   ```bash
   # Create .env file
   echo "EXPO_PUBLIC_API_URL=https://your-app.vercel.app/api" > .env
   ```

6. **Run Mobile App**
   ```bash
   npx expo start
   ```

---

## Environment Variables

### Required Variables

Create `.env.local` in your project root:

```bash
# Database
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"

# Authentication
JWT_SECRET="generate-with-openssl-rand-base64-32"

# SMS Provider
SMS_PROVIDER="africas_talking"
AFRICAS_TALKING_USERNAME="your-username"
AFRICAS_TALKING_API_KEY="your-api-key"

# API URLs
NEXT_PUBLIC_API_URL="http://localhost:3000/api"
```

### Generate JWT Secret

```bash
openssl rand -base64 32
```

---

## Database Migrations

### Initial Setup

```bash
# Run the initial migration
psql $DATABASE_URL -f database/migrations/001_initial_schema.sql
```

### Using Prisma Migrate (Alternative)

```bash
# Create migration
npx prisma migrate dev --name init

# Apply migrations in production
npx prisma migrate deploy
```

### Verify Migration

```sql
-- Check tables
\dt

-- Check PostGIS functions
SELECT PostGIS_version();

-- Check spatial indexes
SELECT indexname, tablename 
FROM pg_indexes 
WHERE indexname LIKE 'idx_%geometry%' OR indexname LIKE 'idx_%route%';
```

---

## Performance Optimization

### 1. Spatial Query Performance

**Enable Spatial Indexes** (already in schema):
```sql
CREATE INDEX idx_prayer_walks_route ON prayer_walks USING GIST(route);
CREATE INDEX idx_gps_points_location ON gps_points USING GIST(location);
CREATE INDEX idx_prayer_coverage_geometry ON prayer_coverage USING GIST(geometry);
```

**Optimize Queries**:
- Always use `ST_DWithin` instead of `ST_Distance` for proximity queries
- Use `::geography` for meter-based calculations
- Use `::geometry` for degree-based calculations (faster)

### 2. Database Connection Pooling

Neon automatically handles connection pooling, but you can optimize:

```typescript
// lib/db.ts
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: ['error', 'warn'],
});
```

### 3. Offline GPS Caching

The mobile app automatically caches GPS points when offline. Sync logic:

1. GPS points saved to AsyncStorage
2. Every 30 seconds, attempt to sync
3. On network reconnection, sync all cached points
4. Clear cache after successful sync

### 4. Batch Operations

Always batch GPS point uploads:

```typescript
// Instead of individual inserts
await prisma.gpsPoint.createMany({
  data: gpsPointsArray,
});
```

### 5. Regular Maintenance

Run weekly:
```sql
VACUUM ANALYZE prayer_walks;
VACUUM ANALYZE prayer_coverage;
VACUUM ANALYZE gps_points;
REINDEX INDEX idx_prayer_walks_route;
```

---

## Troubleshooting

### PostGIS Extension Not Found

**Error**: `extension "postgis" is not available`

**Solution**:
1. Enable PostGIS in Neon Console (Extensions tab)
2. Wait 1-2 minutes for activation
3. Verify with `SELECT PostGIS_version();`

### Spatial Queries Slow

**Symptoms**: Coverage queries taking >5 seconds

**Solutions**:
1. Check spatial indexes exist:
   ```sql
   SELECT * FROM pg_indexes WHERE tablename = 'prayer_walks';
   ```
2. Run VACUUM ANALYZE:
   ```sql
   VACUUM ANALYZE prayer_walks;
   ```
3. Use `EXPLAIN ANALYZE` to debug:
   ```sql
   EXPLAIN ANALYZE SELECT * FROM prayer_walks WHERE ...;
   ```

### GPS Points Not Syncing

**Symptoms**: Mobile app shows points but backend doesn't receive them

**Debug Steps**:
1. Check network connectivity
2. Verify API URL in `.env`
3. Check AsyncStorage for cached points:
   ```typescript
   const cache = await AsyncStorage.getItem('gps_points_cache');
   console.log(JSON.parse(cache));
   ```
4. Manually trigger sync:
   ```typescript
   await syncCachedPoints();
   ```

### Connection String Issues

**Error**: `connection refused` or `SSL required`

**Solution**:
Ensure connection string includes `?sslmode=require`:
```
postgresql://user:pass@host/db?sslmode=require
```

### Prisma Client Not Generated

**Error**: `Cannot find module '@prisma/client'`

**Solution**:
```bash
npx prisma generate
```

---

## Additional Resources

- **Neon Documentation**: https://neon.tech/docs
- **PostGIS Documentation**: https://postgis.net/documentation/
- **Expo Location**: https://docs.expo.dev/versions/latest/sdk/location/
- **Prisma with PostGIS**: https://www.prisma.io/docs/concepts/database-connectors/postgresql

---

## Support

For issues or questions:
- Check the troubleshooting section above
- Review API documentation in `docs/API.md`
- Check spatial query examples in `lib/spatialQueries.ts`

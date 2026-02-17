# Charis Prayer Walk - Quick Reference Guide

## 🚀 Quick Start Commands

### Database Setup
```bash
# 1. Enable PostGIS in Neon Console
# Go to https://console.neon.tech → Your Database → Extensions → Enable "postgis"

# 2. Run migrations
psql $DATABASE_URL -f database/migrations/001_initial_schema.sql

# 3. Generate Prisma client
npx prisma generate

# 4. Verify PostGIS
psql $DATABASE_URL -c "SELECT PostGIS_version();"
```

### Backend Development
```bash
# Install dependencies
npm install

# Setup environment
cp .env.prayer-walk .env.local
# Edit .env.local with your credentials

# Start dev server
npm run dev

# Open Prisma Studio (database GUI)
npx prisma studio
```

### Production Deployment
```bash
# Deploy to Vercel
vercel --prod

# Set environment variables
vercel env add DATABASE_URL
vercel env add JWT_SECRET
vercel env add SMS_PROVIDER
```

---

## 📱 Mobile App Integration

### Install Dependencies
```bash
cd mobile
npx expo install expo-location expo-task-manager expo-background-fetch
npm install @react-native-async-storage/async-storage
```

### Start GPS Tracking
```typescript
import { startGPSTracking, stopGPSTracking } from './services/gpsTracking';

// Start walk
const response = await fetch(`${API_URL}/walks/start`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ branch: 'Downtown' }),
});
const { walk } = await response.json();

// Start GPS tracking
await startGPSTracking(walk.id);

// Stop tracking
await stopGPSTracking();

// Stop walk
await fetch(`${API_URL}/walks/${walk.id}/stop`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
});
```

---

## 🗺️ Common Spatial Queries

### 1. Get Branch Coverage Stats
```typescript
import { getBranchCoveragePercentage } from '@/lib/spatialQueries';

const stats = await getBranchCoveragePercentage('Downtown');
console.log(stats);
// { total_area_km2: 15.5, covered_area_km2: 8.3, coverage_percentage: 53.5 }
```

### 2. Generate Heatmap
```typescript
import { getHeatmapData } from '@/lib/spatialQueries';

const heatmap = await getHeatmapData('Downtown', 100); // 100m grid
// Returns array of { point: GeoJSON, prayer_intensity: number, last_prayed: Date }
```

### 3. Find Uncovered Areas
```typescript
import { getUncoveredAreas } from '@/lib/spatialQueries';

const uncovered = await getUncoveredAreas('Downtown');
// Returns { uncovered_geometry: GeoJSON, uncovered_area_km2: number }
```

### 4. Get Streets Prayed
```typescript
import { getStreetsPrayed } from '@/lib/spatialQueries';

const streets = await getStreetsPrayed('Downtown');
// Returns array of streets with prayer counts
```

### 5. Get User Statistics
```typescript
import { getUserPrayerStats } from '@/lib/spatialQueries';

const stats = await getUserPrayerStats(userId);
// Returns { walks_participated, walks_led, total_distance_meters, etc. }
```

---

## 🔐 Authentication Flow

### 1. Request OTP
```typescript
const response = await fetch(`${API_URL}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '+1234567890' }),
});
// OTP sent to phone
```

### 2. Verify OTP
```typescript
const response = await fetch(`${API_URL}/auth/verify-otp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    phone: '+1234567890',
    otp: '123456',
  }),
});
const { token, user, needsRegistration } = await response.json();
```

### 3. Complete Registration (if needed)
```typescript
const response = await fetch(`${API_URL}/auth/register`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'John Doe',
    branch: 'Downtown',
    role: 'member',
  }),
});
```

---

## 📊 Direct SQL Queries

### Get Coverage Percentage
```sql
SELECT 
  branch,
  ST_Area(ST_Union(geometry)::geography) / 1000000 as covered_area_km2,
  COUNT(*) as coverage_polygons
FROM prayer_coverage
WHERE branch = 'Downtown'
GROUP BY branch;
```

### Find Nearby Walks
```sql
SELECT 
  id,
  branch,
  distance_meters,
  ST_Distance(
    route::geography,
    ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography
  ) as distance_from_point
FROM prayer_walks
WHERE ST_DWithin(
  route::geography,
  ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography,
  1000  -- 1km radius
)
ORDER BY distance_from_point;
```

### Get Heatmap Grid
```sql
SELECT 
  ST_AsGeoJSON(ST_SnapToGrid(location, 0.001)) as grid_point,
  COUNT(*) as intensity
FROM gps_points gp
JOIN prayer_walks pw ON gp.walk_id = pw.id
WHERE pw.branch = 'Downtown'
GROUP BY ST_SnapToGrid(location, 0.001)
ORDER BY intensity DESC;
```

---

## 🛠️ Database Maintenance

### Weekly Tasks
```sql
-- Vacuum and analyze
VACUUM ANALYZE prayer_walks;
VACUUM ANALYZE prayer_coverage;
VACUUM ANALYZE gps_points;
```

### Monthly Tasks
```sql
-- Reindex spatial indexes
REINDEX INDEX idx_prayer_walks_route;
REINDEX INDEX idx_prayer_coverage_geometry;
REINDEX INDEX idx_gps_points_location;
```

### Check Database Size
```sql
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## 🐛 Debugging

### Check PostGIS Installation
```sql
SELECT PostGIS_version();
SELECT PostGIS_full_version();
```

### Verify Spatial Indexes
```sql
SELECT indexname, tablename 
FROM pg_indexes 
WHERE indexname LIKE 'idx_%'
AND schemaname = 'public';
```

### Check GPS Point Count
```sql
SELECT 
  pw.id,
  pw.branch,
  COUNT(gp.id) as gps_point_count
FROM prayer_walks pw
LEFT JOIN gps_points gp ON pw.id = gp.walk_id
GROUP BY pw.id
ORDER BY gps_point_count DESC;
```

### View Cached Points (Mobile)
```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

const cache = await AsyncStorage.getItem('gps_points_cache');
console.log(JSON.parse(cache));

const session = await AsyncStorage.getItem('current_walk_session');
console.log(JSON.parse(session));
```

---

## 📈 Performance Monitoring

### Query Performance
```sql
-- Enable query timing
\timing on

-- Explain query plan
EXPLAIN ANALYZE
SELECT * FROM prayer_walks
WHERE ST_DWithin(
  route::geography,
  ST_MakePoint(-74.006, 40.7128)::geography,
  1000
);
```

### Index Usage
```sql
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

---

## 🔑 Environment Variables

### Required
```env
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
JWT_SECRET="your-secret-key"
```

### Optional (SMS)
```env
SMS_PROVIDER="africas_talking"
AFRICAS_TALKING_USERNAME="your-username"
AFRICAS_TALKING_API_KEY="your-api-key"
```

### Generate JWT Secret
```bash
openssl rand -base64 32
```

---

## 📞 API Testing with cURL

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+1234567890"}'
```

### Verify OTP
```bash
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+1234567890","otp":"123456"}'
```

### Start Walk
```bash
curl -X POST http://localhost:3000/api/walks/start \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"branch":"Downtown"}'
```

### Upload GPS Points
```bash
curl -X POST http://localhost:3000/api/walks/WALK_ID/route \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "points": [
      {"latitude":40.7128,"longitude":-74.0060,"accuracy":10,"timestamp":"2024-01-01T10:00:00Z"}
    ]
  }'
```

---

## 🎯 Common Tasks Checklist

### Setting Up New Environment
- [ ] Create Neon database
- [ ] Enable PostGIS extension
- [ ] Copy `.env.prayer-walk` to `.env.local`
- [ ] Add DATABASE_URL
- [ ] Generate and add JWT_SECRET
- [ ] Run migrations
- [ ] Generate Prisma client
- [ ] Test connection

### Deploying Updates
- [ ] Test locally
- [ ] Run database migrations
- [ ] Update environment variables
- [ ] Deploy to Vercel
- [ ] Verify API endpoints
- [ ] Test mobile app connection

### Troubleshooting GPS Issues
- [ ] Check location permissions
- [ ] Verify AsyncStorage cache
- [ ] Check network connectivity
- [ ] Review sync logs
- [ ] Test manual sync
- [ ] Clear cache if needed

---

## 📚 File Locations

```
KharisPrayerWalk/
├── database/
│   ├── schema.sql                    # Complete SQL schema
│   └── migrations/
│       └── 001_initial_schema.sql    # Initial migration
├── prisma/
│   └── schema.prisma                 # Prisma schema
├── lib/
│   ├── db.ts                         # Database client
│   ├── jwt.ts                        # JWT utilities
│   ├── otp.ts                        # OTP/SMS
│   └── spatialQueries.ts             # Spatial queries
├── app/api/
│   ├── auth/                         # Auth endpoints
│   └── walks/                        # Walk endpoints
├── mobile/services/
│   └── gpsTracking.ts                # GPS service
└── docs/
    ├── API.md                        # API docs
    ├── DEPLOYMENT.md                 # Deployment guide
    ├── ARCHITECTURE.md               # Architecture
    └── TECHNICAL_NOTES.md            # Tech notes
```

---

## 🆘 Getting Help

1. Check `docs/DEPLOYMENT.md` for setup issues
2. Review `docs/TECHNICAL_NOTES.md` for performance
3. See `docs/API.md` for endpoint details
4. Check `PROJECT_SUMMARY.md` for overview

---

**Quick Links**:
- [Neon Console](https://console.neon.tech)
- [Vercel Dashboard](https://vercel.com/dashboard)
- [Expo Dashboard](https://expo.dev)
- [PostGIS Documentation](https://postgis.net/documentation/)

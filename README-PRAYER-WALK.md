# Charis Prayer Walk 🙏

A native mobile application for tracking prayer walks with GPS, managing prayer coverage maps, and analyzing prayer activity across different branches.

## Features

✨ **GPS Tracking**
- Real-time location tracking (foreground & background)
- Offline caching with automatic sync
- Accurate route recording with PostGIS

📍 **Prayer Coverage**
- Visual coverage maps showing prayed areas
- Identify uncovered areas needing prayer
- Street-level prayer tracking
- Heatmaps showing prayer intensity

📊 **Analytics**
- Branch statistics and leaderboards
- User prayer history
- Distance and duration tracking
- Coverage percentage calculations

🔐 **Authentication**
- Phone-based OTP authentication
- Secure JWT tokens
- Role-based access control

## Technology Stack

### Backend
- **Next.js 14+** - React framework with API routes
- **Neon PostgreSQL** - Serverless database
- **PostGIS** - Spatial/geographic extension
- **Prisma** - Type-safe ORM
- **JWT** - Authentication tokens

### Mobile
- **React Native (Expo)** - Cross-platform mobile framework
- **expo-location** - GPS tracking
- **expo-task-manager** - Background tasks
- **AsyncStorage** - Offline data persistence

## Quick Start

### Prerequisites

- Node.js 18+
- Neon account (https://neon.tech)
- Expo account (https://expo.dev)
- SMS provider (Twilio or Africa's Talking)

### 1. Clone Repository

```bash
git clone <repository-url>
cd KharisPrayerWalk
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.prayer-walk .env.local
```

Edit `.env.local` with your credentials:
```env
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
JWT_SECRET="your-secret-key"
SMS_PROVIDER="africas_talking"
```

### 4. Setup Database

**Enable PostGIS in Neon:**
1. Go to https://console.neon.tech
2. Navigate to your database
3. Click "Extensions" → Enable "postgis"

**Run migrations:**
```bash
npx prisma generate
psql $DATABASE_URL -f database/migrations/001_initial_schema.sql
```

### 5. Start Development Server

```bash
npm run dev
```

Backend will be available at http://localhost:3000

### 6. Setup Mobile App

```bash
cd mobile
npx expo install
npx expo start
```

## Project Structure

```
KharisPrayerWalk/
├── app/api/              # Next.js API routes
│   ├── auth/            # Authentication endpoints
│   └── walks/           # Prayer walk endpoints
├── lib/                 # Shared utilities
│   ├── db.ts           # Database client + PostGIS helpers
│   ├── jwt.ts          # JWT utilities
│   ├── otp.ts          # OTP generation & SMS
│   └── spatialQueries.ts # Spatial query functions
├── prisma/
│   └── schema.prisma   # Database schema
├── database/
│   ├── schema.sql      # Complete SQL schema
│   └── migrations/     # Migration files
├── mobile/
│   └── services/
│       └── gpsTracking.ts # GPS tracking service
└── docs/
    ├── API.md          # API documentation
    ├── DEPLOYMENT.md   # Deployment guide
    └── ARCHITECTURE.md # System architecture
```

## API Endpoints

### Authentication
```
POST /api/auth/login          # Request OTP
POST /api/auth/verify-otp     # Verify OTP
POST /api/auth/register       # Complete registration
```

### Prayer Walks
```
POST /api/walks/start                # Start walk
POST /api/walks/:walkId/stop         # Stop walk
POST /api/walks/:walkId/route        # Upload GPS points
GET  /api/walks/:walkId              # Get walk details
GET  /api/walks                      # List walks
```

### Coverage & Analytics
```
GET /api/coverage/:branch            # Coverage stats
GET /api/coverage/:branch/streets    # Street coverage
GET /api/coverage/:branch/heatmap    # Heatmap data
GET /api/coverage/:branch/unprayed   # Uncovered areas
```

See [docs/API.md](docs/API.md) for complete documentation.

## Database Schema

### Core Tables

- **users** - User accounts and authentication
- **prayer_walks** - Prayer walk sessions with routes (LineString)
- **participants** - Walk participants (many-to-many)
- **gps_points** - Individual GPS tracking points (Point)
- **prayer_journals** - Prayer notes during walks
- **prayer_coverage** - Spatial coverage areas (Polygon)
- **streets** - Street geometries and prayer counts (LineString)

### Spatial Features

All spatial data uses **PostGIS** with **SRID 4326** (WGS 84):

- Automatic distance calculations
- 50m buffer coverage areas
- Spatial indexes for fast queries
- GeoJSON ↔ PostGIS conversion

## Mobile App Usage

### Starting a Prayer Walk

```typescript
import { startGPSTracking, stopGPSTracking } from './services/gpsTracking';

// Start tracking
const walkId = await startWalk();
await startGPSTracking(walkId);

// GPS points automatically sync every 30 seconds
// Works offline - points cached locally

// Stop tracking
const points = await stopGPSTracking();
await stopWalk(walkId);
```

### Offline Support

The app automatically:
1. Caches GPS points in AsyncStorage
2. Syncs every 30 seconds when online
3. Retries on network reconnection
4. Clears cache after successful sync

## Deployment

### Backend (Vercel)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Set environment variables
vercel env add DATABASE_URL
vercel env add JWT_SECRET

# Deploy to production
vercel --prod
```

### Mobile (Expo)

```bash
cd mobile

# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android

# Submit to stores
eas submit
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed instructions.

## Spatial Queries

### Get Coverage Percentage

```typescript
import { getBranchCoveragePercentage } from '@/lib/spatialQueries';

const stats = await getBranchCoveragePercentage('Downtown');
// Returns: { total_area_km2, covered_area_km2, coverage_percentage }
```

### Generate Heatmap

```typescript
import { getHeatmapData } from '@/lib/spatialQueries';

const heatmap = await getHeatmapData('Downtown', 100); // 100m grid
// Returns: Array of { point, prayer_intensity, last_prayed }
```

### Find Uncovered Areas

```typescript
import { getUncoveredAreas } from '@/lib/spatialQueries';

const uncovered = await getUncoveredAreas('Downtown');
// Returns: { uncovered_geometry, uncovered_area_km2 }
```

See [lib/spatialQueries.ts](lib/spatialQueries.ts) for all available queries.

## Performance

### Spatial Indexes

All geometry columns use GIST indexes for fast spatial queries:
```sql
CREATE INDEX idx_prayer_walks_route ON prayer_walks USING GIST(route);
```

### Query Optimization

- Use `ST_DWithin` for proximity (faster than `ST_Distance`)
- Cast to `geography` for meter-based calculations
- Batch GPS point inserts
- Regular VACUUM ANALYZE for index optimization

### Offline Caching

- GPS points cached locally
- Automatic background sync
- Minimal battery impact
- Network-resilient

## Security

- Phone OTP authentication (5-minute expiry)
- JWT tokens (30-day expiry)
- HTTPS required in production
- SQL injection prevention via Prisma
- Rate limiting on auth endpoints

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Documentation

- [API Documentation](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Architecture Overview](docs/ARCHITECTURE.md)

## Troubleshooting

### PostGIS Extension Not Found

Enable PostGIS in Neon Console → Extensions → postgis

### GPS Points Not Syncing

Check AsyncStorage cache:
```typescript
const cache = await AsyncStorage.getItem('gps_points_cache');
console.log(JSON.parse(cache));
```

### Slow Spatial Queries

Run index optimization:
```sql
VACUUM ANALYZE prayer_walks;
REINDEX INDEX idx_prayer_walks_route;
```

See [docs/DEPLOYMENT.md#troubleshooting](docs/DEPLOYMENT.md#troubleshooting) for more.

## License

Proprietary - Christex Foundation

## Support

For questions or issues:
- Check documentation in `/docs`
- Review spatial query examples in `lib/spatialQueries.ts`
- Contact the development team

---

Built with ❤️ by Christex Foundation

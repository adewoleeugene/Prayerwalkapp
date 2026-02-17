# Charis Prayer Walk - Backend & Database Architecture

## Overview

Charis Prayer Walk is a native mobile application for tracking prayer walks with GPS, managing prayer coverage maps, and analyzing prayer activity across different branches. The backend uses **Neon (serverless PostgreSQL)** with **PostGIS** for spatial/geolocation support.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Mobile App (Expo)                        │
│  - GPS Tracking (foreground & background)                   │
│  - Offline caching with AsyncStorage                        │
│  - Automatic sync on reconnection                           │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS/REST API
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Next.js API Routes (Vercel)                     │
│  - Authentication (Phone OTP)                               │
│  - Prayer Walk Management                                   │
│  - GPS Route Processing                                     │
│  - Coverage Analytics                                       │
└────────────────────┬────────────────────────────────────────┘
                     │ Prisma ORM
                     ▼
┌─────────────────────────────────────────────────────────────┐
│          Neon PostgreSQL + PostGIS                          │
│  - Spatial data storage (routes, coverage)                  │
│  - GeoJSON → PostGIS geometry conversion                   │
│  - Spatial queries (coverage, heatmaps)                     │
│  - Automatic distance calculations                          │
└─────────────────────────────────────────────────────────────┘
```

## Technology Stack

### Backend
- **Framework**: Next.js 14+ (App Router)
- **ORM**: Prisma
- **Database**: Neon (Serverless PostgreSQL)
- **Spatial Extension**: PostGIS
- **Authentication**: JWT with phone OTP
- **Deployment**: Vercel

### Mobile
- **Framework**: React Native (Expo)
- **GPS Tracking**: expo-location, expo-task-manager
- **Offline Storage**: AsyncStorage
- **Background Tasks**: expo-background-fetch

### SMS Providers
- Twilio
- Africa's Talking

## Database Schema

### Core Tables

1. **users** - User accounts and authentication
2. **prayer_walks** - Prayer walk sessions with routes
3. **participants** - Many-to-many relationship (walks ↔ users)
4. **gps_points** - Individual GPS tracking points
5. **prayer_journals** - Prayer notes during walks
6. **prayer_coverage** - Spatial coverage polygons
7. **streets** - Street geometries and prayer counts

### Spatial Data Types

All spatial data uses **SRID 4326** (WGS 84 - standard GPS coordinates):

- **Point**: GPS locations (latitude, longitude)
- **LineString**: Prayer walk routes
- **Polygon**: Coverage areas

## Key Features

### 1. GPS Tracking
- Real-time location tracking (foreground & background)
- 5-second intervals or 10-meter distance threshold
- Automatic route building from GPS points
- Offline caching with automatic sync

### 2. Prayer Coverage
- Automatic coverage calculation (50m buffer around routes)
- Coverage overlap tracking (areas prayed multiple times)
- Uncovered area identification
- Street-level prayer tracking

### 3. Spatial Analytics
- Heatmap generation (prayer intensity)
- Coverage percentage by branch
- Distance calculations
- Nearby walk discovery
- Coverage timeline

### 4. Authentication
- Phone-based OTP authentication
- 6-digit codes valid for 5 minutes
- JWT tokens (30-day expiration)
- Role-based access (admin, leader, member)

## API Endpoints

### Authentication
- `POST /api/auth/login` - Request OTP
- `POST /api/auth/verify-otp` - Verify OTP and get token
- `POST /api/auth/register` - Complete user registration

### Prayer Walks
- `POST /api/walks/start` - Start new walk
- `POST /api/walks/:walkId/stop` - End walk
- `POST /api/walks/:walkId/route` - Upload GPS points
- `GET /api/walks/:walkId` - Get walk details
- `GET /api/walks` - List walks (filtered)

### Coverage & Analytics
- `GET /api/coverage/:branch` - Branch coverage stats
- `GET /api/coverage/:branch/streets` - Street coverage
- `GET /api/coverage/:branch/heatmap` - Heatmap data
- `GET /api/coverage/:branch/unprayed` - Uncovered areas

See [API.md](./API.md) for complete documentation.

## Spatial Queries

### Coverage Calculation

When a walk is completed, the system:
1. Builds a LineString from GPS points
2. Creates a 50m buffer around the route
3. Converts to Polygon coverage area
4. Updates streets that intersect the route

```sql
-- Automatic trigger on walk completion
CREATE TRIGGER update_coverage_on_walk_complete
    AFTER UPDATE OF status ON prayer_walks
    FOR EACH ROW 
    WHEN (NEW.status = 'completed')
    EXECUTE FUNCTION update_prayer_coverage_from_walk();
```

### Distance Calculations

All distances use PostGIS geography for accurate meter-based calculations:

```sql
-- Calculate route distance
SELECT ST_Length(route::geography) as distance_meters
FROM prayer_walks
WHERE id = $1;
```

### Heatmap Generation

Prayer intensity is calculated using a grid-based approach:

```sql
SELECT 
  ST_SnapToGrid(location, 100) as grid_point,
  COUNT(*) as intensity
FROM gps_points
GROUP BY ST_SnapToGrid(location, 100);
```

## Performance Optimization

### Spatial Indexes

All geometry columns have GIST indexes:
```sql
CREATE INDEX idx_prayer_walks_route ON prayer_walks USING GIST(route);
CREATE INDEX idx_gps_points_location ON gps_points USING GIST(location);
CREATE INDEX idx_prayer_coverage_geometry ON prayer_coverage USING GIST(geometry);
```

### Query Optimization

- Use `ST_DWithin` for proximity queries (faster than `ST_Distance`)
- Cast to `geography` for meter-based calculations
- Cast to `geometry` for degree-based calculations (faster)
- Batch GPS point inserts

### Offline Support

Mobile app caches GPS points locally:
1. Points saved to AsyncStorage immediately
2. Sync attempted every 30 seconds
3. On network reconnection, sync all cached points
4. Clear cache after successful sync

## Data Flow

### Starting a Prayer Walk

```
Mobile App                    Backend                     Database
    |                            |                            |
    |-- POST /walks/start ------>|                            |
    |                            |-- INSERT prayer_walk ----->|
    |                            |-- INSERT participants ---->|
    |<-- walk_id + details ------|<-- walk data --------------|
    |                            |                            |
    |-- Start GPS tracking       |                            |
```

### GPS Point Syncing

```
Mobile App                    Backend                     Database
    |                            |                            |
    |-- Collect GPS points       |                            |
    |   (every 5s or 10m)        |                            |
    |                            |                            |
    |-- Cache in AsyncStorage    |                            |
    |                            |                            |
    |-- POST /walks/:id/route -->|                            |
    |   (every 30s)              |                            |
    |                            |-- INSERT gps_points ------>|
    |                            |-- UPDATE route ----------->|
    |<-- success ----------------|                            |
```

### Stopping a Prayer Walk

```
Mobile App                    Backend                     Database
    |                            |                            |
    |-- POST /walks/:id/stop --->|                            |
    |                            |-- Build LineString ------->|
    |                            |-- UPDATE status ---------->|
    |                            |-- TRIGGER coverage ------->|
    |                            |   (50m buffer)             |
    |                            |-- UPDATE streets --------->|
    |<-- walk stats -------------|<-- calculated data --------|
```

## File Structure

```
KharisPrayerWalk/
├── app/
│   └── api/
│       ├── auth/
│       │   ├── login/route.ts
│       │   ├── verify-otp/route.ts
│       │   └── register/route.ts
│       └── walks/
│           ├── start/route.ts
│           └── [walkId]/
│               ├── stop/route.ts
│               └── route/route.ts
├── lib/
│   ├── db.ts                    # Prisma client + PostGIS helpers
│   ├── jwt.ts                   # JWT utilities
│   ├── otp.ts                   # OTP generation & SMS
│   └── spatialQueries.ts        # PostGIS query functions
├── prisma/
│   └── schema.prisma            # Database schema
├── database/
│   ├── schema.sql               # Complete SQL schema
│   └── migrations/
│       └── 001_initial_schema.sql
├── mobile/
│   └── services/
│       └── gpsTracking.ts       # GPS tracking service
└── docs/
    ├── API.md                   # API documentation
    ├── DEPLOYMENT.md            # Deployment guide
    └── ARCHITECTURE.md          # This file
```

## Security Considerations

### Authentication
- OTP codes expire after 5 minutes
- JWT tokens expire after 30 days
- Tokens include user role for authorization
- All API endpoints (except auth) require valid JWT

### Data Privacy
- Phone numbers are unique identifiers
- GPS data is associated with walks, not individual users
- Prayer journals are private to walk participants

### API Security
- Rate limiting on authentication endpoints
- HTTPS required in production
- SQL injection prevention via Prisma
- Input validation on all endpoints

## Scalability

### Database
- Neon autoscales based on load
- Connection pooling handled automatically
- Spatial indexes for fast queries
- Partitioning possible for large datasets

### Backend
- Serverless deployment on Vercel
- Automatic scaling based on traffic
- Edge caching for static assets
- API route optimization

### Mobile
- Offline-first architecture
- Batch syncing reduces API calls
- Background tasks for GPS tracking
- Efficient data structures

## Future Enhancements

### Planned Features
1. **Real-time Collaboration**: Multiple users tracking same walk
2. **Prayer Requests**: Location-based prayer requests
3. **Notifications**: Reminders for uncovered areas
4. **Gamification**: Badges, streaks, leaderboards
5. **Export**: GPX/KML export for routes
6. **Import**: Street data from OpenStreetMap

### Technical Improvements
1. **Caching**: Redis for frequently accessed data
2. **CDN**: CloudFront for static assets
3. **Monitoring**: Sentry for error tracking
4. **Analytics**: Mixpanel for user behavior
5. **Testing**: E2E tests with Playwright

## Resources

- [Neon Documentation](https://neon.tech/docs)
- [PostGIS Documentation](https://postgis.net/documentation/)
- [Prisma with PostgreSQL](https://www.prisma.io/docs/concepts/database-connectors/postgresql)
- [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/)
- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)

## License

Proprietary - Christex Foundation

## Contact

For questions or support, contact the development team.

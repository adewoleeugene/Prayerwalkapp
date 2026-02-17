# Charis Prayer Walk - Technical Notes

## Table of Contents
1. [Spatial Query Performance](#spatial-query-performance)
2. [Offline GPS Caching Logic](#offline-gps-caching-logic)
3. [Syncing on Reconnection](#syncing-on-reconnection)
4. [PostGIS Best Practices](#postgis-best-practices)
5. [Mobile App Optimization](#mobile-app-optimization)
6. [Database Maintenance](#database-maintenance)

---

## Spatial Query Performance

### Understanding PostGIS Performance

PostGIS queries can be slow if not properly optimized. Here are the key strategies:

### 1. Spatial Indexes (GIST)

**Always use GIST indexes on geometry columns:**

```sql
CREATE INDEX idx_prayer_walks_route ON prayer_walks USING GIST(route);
CREATE INDEX idx_gps_points_location ON gps_points USING GIST(location);
CREATE INDEX idx_prayer_coverage_geometry ON prayer_coverage USING GIST(geometry);
CREATE INDEX idx_streets_geometry ON streets USING GIST(geometry);
```

**Verify indexes are being used:**
```sql
EXPLAIN ANALYZE 
SELECT * FROM prayer_walks 
WHERE ST_DWithin(route::geography, ST_MakePoint(-74.006, 40.7128)::geography, 1000);
```

Look for "Index Scan using idx_prayer_walks_route" in the output.

### 2. Geography vs Geometry

**Use `geography` for meter-based calculations:**
```sql
-- GOOD: Accurate distance in meters
SELECT ST_Distance(
  point1::geography,
  point2::geography
) as distance_meters;

-- BAD: Distance in degrees (not useful)
SELECT ST_Distance(point1, point2) as distance_degrees;
```

**Use `geometry` for faster operations when precision isn't critical:**
```sql
-- Faster for bounding box queries
SELECT * FROM prayer_walks
WHERE ST_Intersects(
  route,
  ST_MakeEnvelope(minLng, minLat, maxLng, maxLat, 4326)
);
```

### 3. ST_DWithin vs ST_Distance

**Always prefer `ST_DWithin` for proximity queries:**

```sql
-- GOOD: Uses spatial index efficiently
SELECT * FROM prayer_walks
WHERE ST_DWithin(
  route::geography,
  ST_MakePoint($1, $2)::geography,
  1000  -- 1km radius
);

-- BAD: Doesn't use index efficiently
SELECT * FROM prayer_walks
WHERE ST_Distance(
  route::geography,
  ST_MakePoint($1, $2)::geography
) < 1000;
```

### 4. Bounding Box Optimization

**Use bounding boxes to pre-filter before expensive operations:**

```sql
-- GOOD: Two-step filter
WITH bbox_filter AS (
  SELECT * FROM prayer_walks
  WHERE route && ST_MakeEnvelope($1, $2, $3, $4, 4326)  -- Fast bbox check
)
SELECT * FROM bbox_filter
WHERE ST_Intersects(route, $5);  -- Precise check on smaller dataset

-- BAD: Direct intersection on entire table
SELECT * FROM prayer_walks
WHERE ST_Intersects(route, $1);
```

### 5. Simplify Geometries

**For display purposes, simplify complex geometries:**

```sql
-- Simplify route for map display (tolerance in degrees)
SELECT ST_Simplify(route, 0.0001) as simplified_route
FROM prayer_walks
WHERE id = $1;

-- For geography (tolerance in meters)
SELECT ST_Simplify(route::geography, 10)::geometry as simplified_route
FROM prayer_walks
WHERE id = $1;
```

### 6. Batch Operations

**Always batch inserts for GPS points:**

```typescript
// GOOD: Single batch insert
await prisma.gpsPoint.createMany({
  data: gpsPointsArray,  // Array of 100+ points
});

// BAD: Individual inserts
for (const point of gpsPointsArray) {
  await prisma.gpsPoint.create({ data: point });
}
```

### 7. Materialized Views for Analytics

**Create materialized views for expensive calculations:**

```sql
-- Create materialized view for branch statistics
CREATE MATERIALIZED VIEW branch_stats AS
SELECT 
  branch,
  COUNT(*) as total_walks,
  SUM(distance_meters) as total_distance,
  ST_Union(route) as combined_routes,
  ST_Area(ST_Union(route)::geography) / 1000000 as coverage_km2
FROM prayer_walks
WHERE status = 'completed'
GROUP BY branch;

-- Create index on materialized view
CREATE INDEX idx_branch_stats_branch ON branch_stats(branch);

-- Refresh periodically (e.g., daily via cron)
REFRESH MATERIALIZED VIEW branch_stats;
```

### 8. Query Optimization Checklist

- [ ] Spatial indexes on all geometry columns
- [ ] Use `ST_DWithin` instead of `ST_Distance` for proximity
- [ ] Cast to `geography` for meter-based calculations
- [ ] Use bounding box pre-filtering
- [ ] Batch insert GPS points
- [ ] Simplify geometries for display
- [ ] Use materialized views for analytics
- [ ] Regular VACUUM ANALYZE

---

## Offline GPS Caching Logic

### Architecture

The mobile app implements a robust offline-first architecture for GPS tracking:

```
┌─────────────────────────────────────────────────────┐
│                  GPS Tracking                        │
│  - Foreground: 5s intervals or 10m distance         │
│  - Background: Same intervals with notification     │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│              Local Cache (AsyncStorage)              │
│  - Immediate write on GPS update                    │
│  - Persistent across app restarts                   │
│  - Indexed by walkId                                │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│              Sync Manager                            │
│  - Attempt sync every 30 seconds                    │
│  - Retry on network reconnection                    │
│  - Clear cache after successful sync                │
└─────────────────────────────────────────────────────┘
```

### Implementation Details

#### 1. GPS Point Collection

```typescript
// Background task collects GPS points
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (data) {
    const { locations } = data;
    
    for (const location of locations) {
      const point: GPSPoint = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        altitude: location.coords.altitude,
        speed: location.coords.speed,
        timestamp: new Date(location.timestamp).toISOString(),
      };

      // Immediately save to local cache
      await saveGPSPoint(point);
    }
  }
});
```

#### 2. Local Cache Structure

```typescript
// AsyncStorage keys
const GPS_CACHE_KEY = 'gps_points_cache';
const CURRENT_WALK_SESSION = 'current_walk_session';

// Session structure
interface WalkSession {
  walkId: string;
  isActive: boolean;
  points: GPSPoint[];
}

// Cache structure (for offline points)
interface CachedPoint extends GPSPoint {
  walkId: string;
  synced: boolean;
}
```

#### 3. Saving Points to Cache

```typescript
async function saveGPSPoint(point: GPSPoint): Promise<void> {
  // Get current session
  const sessionData = await AsyncStorage.getItem(CURRENT_WALK_SESSION);
  const session: WalkSession = JSON.parse(sessionData);
  
  // Add to session
  session.points.push(point);
  await AsyncStorage.setItem(CURRENT_WALK_SESSION, JSON.stringify(session));
  
  // Also save to offline cache
  const cacheData = await AsyncStorage.getItem(GPS_CACHE_KEY);
  const cache: CachedPoint[] = cacheData ? JSON.parse(cacheData) : [];
  
  cache.push({
    ...point,
    walkId: session.walkId,
    synced: false,
  });
  
  await AsyncStorage.setItem(GPS_CACHE_KEY, JSON.stringify(cache));
}
```

#### 4. Periodic Sync

```typescript
// Sync every 30 seconds
const SYNC_INTERVAL = 30000;
let syncIntervalId: NodeJS.Timeout | null = null;

function startSyncInterval(): void {
  syncIntervalId = setInterval(async () => {
    await syncGPSPoints();
  }, SYNC_INTERVAL);
}

async function syncGPSPoints(): Promise<boolean> {
  try {
    const sessionData = await AsyncStorage.getItem(CURRENT_WALK_SESSION);
    const session: WalkSession = JSON.parse(sessionData);
    
    if (session.points.length === 0) return true;
    
    // Get auth token
    const token = await AsyncStorage.getItem('auth_token');
    
    // Send to backend
    const response = await fetch(
      `${API_URL}/walks/${session.walkId}/route`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ points: session.points }),
      }
    );
    
    if (response.ok) {
      // Clear synced points from session
      session.points = [];
      await AsyncStorage.setItem(CURRENT_WALK_SESSION, JSON.stringify(session));
      
      // Mark points as synced in cache
      const cacheData = await AsyncStorage.getItem(GPS_CACHE_KEY);
      const cache: CachedPoint[] = JSON.parse(cacheData);
      const updatedCache = cache.map(p => ({ ...p, synced: true }));
      await AsyncStorage.setItem(GPS_CACHE_KEY, JSON.stringify(updatedCache));
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Sync failed:', error);
    return false;
  }
}
```

#### 5. Cache Cleanup

```typescript
async function cleanupSyncedPoints(): Promise<void> {
  const cacheData = await AsyncStorage.getItem(GPS_CACHE_KEY);
  const cache: CachedPoint[] = JSON.parse(cacheData);
  
  // Remove synced points older than 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const filtered = cache.filter(p => 
    !p.synced || new Date(p.timestamp) > oneDayAgo
  );
  
  await AsyncStorage.setItem(GPS_CACHE_KEY, JSON.stringify(filtered));
}
```

### Offline Behavior

**Scenario 1: Normal Operation (Online)**
1. GPS point collected every 5 seconds
2. Saved to AsyncStorage immediately
3. Sync attempted every 30 seconds
4. Points cleared from cache after successful sync

**Scenario 2: Network Disconnected**
1. GPS points continue to be collected
2. All points saved to AsyncStorage
3. Sync attempts fail silently
4. Points accumulate in cache

**Scenario 3: Network Reconnected**
1. Next sync attempt succeeds
2. All cached points uploaded in batch
3. Cache cleared after confirmation
4. Normal operation resumes

**Scenario 4: App Crash/Restart**
1. AsyncStorage persists across restarts
2. On app launch, check for unsent points
3. Resume walk if session is active
4. Sync cached points automatically

---

## Syncing on Reconnection

### Network State Monitoring

```typescript
import NetInfo from '@react-native-community/netinfo';

// Monitor network state
NetInfo.addEventListener(state => {
  if (state.isConnected && state.isInternetReachable) {
    // Network is available
    syncCachedPoints();
  }
});
```

### Reconnection Sync Strategy

#### 1. Detect Reconnection

```typescript
let wasOffline = false;

NetInfo.addEventListener(state => {
  const isOnline = state.isConnected && state.isInternetReachable;
  
  if (isOnline && wasOffline) {
    // Just reconnected
    console.log('Network reconnected, syncing cached data...');
    handleReconnection();
  }
  
  wasOffline = !isOnline;
});
```

#### 2. Sync All Cached Points

```typescript
async function handleReconnection(): Promise<void> {
  // 1. Sync current session points
  await syncGPSPoints();
  
  // 2. Sync any cached points from previous sessions
  await syncCachedPoints();
  
  // 3. Sync any pending journal entries
  await syncJournalEntries();
  
  // 4. Cleanup old synced data
  await cleanupSyncedPoints();
}

async function syncCachedPoints(): Promise<void> {
  const cacheData = await AsyncStorage.getItem(GPS_CACHE_KEY);
  if (!cacheData) return;
  
  const cache: CachedPoint[] = JSON.parse(cacheData);
  const unsyncedPoints = cache.filter(p => !p.synced);
  
  if (unsyncedPoints.length === 0) return;
  
  // Group by walkId
  const pointsByWalk = unsyncedPoints.reduce((acc, point) => {
    if (!acc[point.walkId]) acc[point.walkId] = [];
    acc[point.walkId].push(point);
    return acc;
  }, {} as Record<string, CachedPoint[]>);
  
  // Sync each walk's points
  const token = await AsyncStorage.getItem('auth_token');
  
  for (const [walkId, points] of Object.entries(pointsByWalk)) {
    try {
      await fetch(`${API_URL}/walks/${walkId}/route`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ points }),
      });
      
      // Mark as synced
      const updatedCache = cache.map(p => 
        points.includes(p) ? { ...p, synced: true } : p
      );
      await AsyncStorage.setItem(GPS_CACHE_KEY, JSON.stringify(updatedCache));
    } catch (error) {
      console.error(`Failed to sync points for walk ${walkId}:`, error);
    }
  }
}
```

#### 3. Exponential Backoff for Failed Syncs

```typescript
async function syncWithBackoff(
  syncFn: () => Promise<boolean>,
  maxRetries: number = 5
): Promise<boolean> {
  let retries = 0;
  let delay = 1000; // Start with 1 second
  
  while (retries < maxRetries) {
    const success = await syncFn();
    
    if (success) return true;
    
    // Wait before retry with exponential backoff
    await new Promise(resolve => setTimeout(resolve, delay));
    
    delay *= 2; // Double the delay
    retries++;
  }
  
  return false;
}

// Usage
await syncWithBackoff(syncGPSPoints);
```

#### 4. Conflict Resolution

If the backend has newer data, handle conflicts:

```typescript
async function syncWithConflictResolution(): Promise<void> {
  const localPoints = await getLocalPoints();
  const serverPoints = await fetchServerPoints();
  
  // Merge based on timestamp
  const merged = mergePoints(localPoints, serverPoints);
  
  // Update local cache
  await updateLocalCache(merged);
  
  // Send any new local points to server
  const newPoints = localPoints.filter(
    lp => !serverPoints.some(sp => sp.timestamp === lp.timestamp)
  );
  
  if (newPoints.length > 0) {
    await uploadPoints(newPoints);
  }
}

function mergePoints(
  local: GPSPoint[],
  server: GPSPoint[]
): GPSPoint[] {
  const map = new Map<string, GPSPoint>();
  
  // Add server points (source of truth)
  server.forEach(p => map.set(p.timestamp, p));
  
  // Add local points that don't exist on server
  local.forEach(p => {
    if (!map.has(p.timestamp)) {
      map.set(p.timestamp, p);
    }
  });
  
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}
```

### Sync Status Indicators

Show sync status to users:

```typescript
interface SyncStatus {
  isSyncing: boolean;
  lastSyncTime: Date | null;
  pendingPoints: number;
  error: string | null;
}

const [syncStatus, setSyncStatus] = useState<SyncStatus>({
  isSyncing: false,
  lastSyncTime: null,
  pendingPoints: 0,
  error: null,
});

// Update UI based on sync status
{syncStatus.isSyncing && <ActivityIndicator />}
{syncStatus.pendingPoints > 0 && (
  <Text>{syncStatus.pendingPoints} points pending sync</Text>
)}
{syncStatus.error && <Text style={{color: 'red'}}>{syncStatus.error}</Text>}
```

---

## PostGIS Best Practices

### 1. Always Use SRID

```sql
-- GOOD: Explicit SRID
ST_SetSRID(ST_MakePoint(lng, lat), 4326)

-- BAD: No SRID
ST_MakePoint(lng, lat)
```

### 2. Validate Geometries

```sql
-- Check if geometry is valid
SELECT ST_IsValid(geometry) FROM prayer_coverage;

-- Fix invalid geometries
UPDATE prayer_coverage
SET geometry = ST_MakeValid(geometry)
WHERE NOT ST_IsValid(geometry);
```

### 3. Use Appropriate Buffer Distances

```sql
-- For geography (meters)
ST_Buffer(route::geography, 50)  -- 50 meters

-- For geometry (degrees) - avoid unless you know what you're doing
ST_Buffer(route, 0.0005)  -- ~50 meters at equator
```

### 4. Optimize Storage

```sql
-- Use appropriate precision
ST_SnapToGrid(geometry, 0.000001)  -- ~10cm precision

-- Remove duplicate points
ST_RemoveRepeatedPoints(linestring, 0.00001)
```

---

## Mobile App Optimization

### 1. Battery Optimization

```typescript
// Adjust GPS accuracy based on battery level
import * as Battery from 'expo-battery';

const batteryLevel = await Battery.getBatteryLevelAsync();

const accuracy = batteryLevel > 0.5
  ? Location.Accuracy.BestForNavigation
  : Location.Accuracy.Balanced;
```

### 2. Reduce Background Activity

```typescript
// Increase interval when app is in background
const timeInterval = isAppInForeground ? 5000 : 15000;
```

### 3. Compress Data Before Sync

```typescript
// Send only essential data
const compressedPoints = points.map(p => ({
  lat: p.latitude,
  lng: p.longitude,
  acc: p.accuracy,
  ts: p.timestamp,
}));
```

---

## Database Maintenance

### Regular Tasks

```sql
-- Weekly: Vacuum and analyze
VACUUM ANALYZE prayer_walks;
VACUUM ANALYZE prayer_coverage;
VACUUM ANALYZE gps_points;

-- Monthly: Reindex
REINDEX TABLE prayer_walks;
REINDEX TABLE prayer_coverage;

-- Quarterly: Check for bloat
SELECT schemaname, tablename, 
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Archiving Old Data

```sql
-- Archive GPS points older than 6 months
CREATE TABLE gps_points_archive AS
SELECT * FROM gps_points
WHERE recorded_at < NOW() - INTERVAL '6 months';

DELETE FROM gps_points
WHERE recorded_at < NOW() - INTERVAL '6 months';
```

---

## Performance Benchmarks

### Expected Query Times (on Neon)

- **Find nearby walks**: < 100ms
- **Calculate coverage**: < 500ms
- **Generate heatmap**: < 1s
- **Batch insert 1000 GPS points**: < 200ms
- **Update walk route**: < 50ms

### Optimization Goals

- All spatial queries < 1 second
- GPS sync < 500ms for 100 points
- Offline cache operations < 50ms
- App startup < 2 seconds

---

## Monitoring & Alerts

### Key Metrics to Track

1. **Sync Success Rate**: Should be > 95%
2. **Average Sync Time**: Should be < 500ms
3. **Cache Size**: Alert if > 10,000 points
4. **Failed Syncs**: Alert if > 10 consecutive failures
5. **Database Query Time**: Alert if > 2 seconds

### Implementation

```typescript
// Track sync metrics
const metrics = {
  totalSyncs: 0,
  successfulSyncs: 0,
  failedSyncs: 0,
  averageSyncTime: 0,
};

async function syncWithMetrics(): Promise<boolean> {
  const startTime = Date.now();
  metrics.totalSyncs++;
  
  const success = await syncGPSPoints();
  
  if (success) {
    metrics.successfulSyncs++;
  } else {
    metrics.failedSyncs++;
  }
  
  const syncTime = Date.now() - startTime;
  metrics.averageSyncTime = 
    (metrics.averageSyncTime * (metrics.totalSyncs - 1) + syncTime) / 
    metrics.totalSyncs;
  
  return success;
}
```

---

This document provides comprehensive technical details for implementing and optimizing the Charis Prayer Walk backend and mobile app. For additional questions, refer to the main documentation or contact the development team.

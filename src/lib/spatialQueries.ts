/**
 * Spatial Query Samples for Charis Prayer Walk
 * PostGIS queries for coverage analysis, heatmaps, and statistics
 */

import { prisma } from './db';
import { executePostGISQuery } from './db';

/**
 * 1. Get streets that have been prayed over
 */
export async function getStreetsPrayed(branch: string) {
  return executePostGISQuery(`
    SELECT 
      s.id,
      s.name,
      s.prayer_count,
      s.last_prayed_at,
      ST_AsGeoJSON(s.geometry) as geometry,
      ST_Length(s.geometry::geography) as length_meters
    FROM streets s
    WHERE s.branch = $1
    AND s.prayer_count > 0
    ORDER BY s.prayer_count DESC, s.last_prayed_at DESC
  `, [branch]);
}

/**
 * 2. Get streets that have NOT been prayed over yet
 */
export async function getStreetsNotPrayed(branch: string) {
  return executePostGISQuery(`
    SELECT 
      s.id,
      s.name,
      ST_AsGeoJSON(s.geometry) as geometry,
      ST_Length(s.geometry::geography) as length_meters
    FROM streets s
    WHERE s.branch = $1
    AND s.prayer_count = 0
    ORDER BY s.name
  `, [branch]);
}

/**
 * 3. Calculate total coverage percentage for a branch
 */
export async function getBranchCoveragePercentage(branch: string) {
  return executePostGISQuery(`
    WITH branch_bounds AS (
      SELECT ST_Union(geometry) as total_area
      FROM streets
      WHERE branch = $1
    ),
    covered_area AS (
      SELECT ST_Union(geometry) as covered
      FROM prayer_coverage
      WHERE branch = $1
    )
    SELECT 
      ST_Area(bb.total_area::geography) / 1000000 as total_area_km2,
      ST_Area(ca.covered::geography) / 1000000 as covered_area_km2,
      (ST_Area(ca.covered::geography) / ST_Area(bb.total_area::geography) * 100) as coverage_percentage
    FROM branch_bounds bb
    CROSS JOIN covered_area ca
  `, [branch]);
}

/**
 * 4. Get areas not yet prayed (uncovered areas)
 */
export async function getUncoveredAreas(branch: string, boundingBox?: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}) {
  const bbox = boundingBox || { minLng: -180, minLat: -90, maxLng: 180, maxLat: 90 };

  return executePostGISQuery(`
    WITH branch_area AS (
      SELECT ST_SetSRID(ST_MakeEnvelope($2, $3, $4, $5), 4326) as boundary
    ),
    covered AS (
      SELECT ST_Union(geometry) as covered_geom
      FROM prayer_coverage
      WHERE branch = $1
    )
    SELECT 
      ST_AsGeoJSON(
        ST_Difference(
          ba.boundary,
          COALESCE(c.covered_geom, ST_GeomFromText('POLYGON EMPTY'))
        )
      ) as uncovered_geometry,
      ST_Area(
        ST_Difference(
          ba.boundary,
          COALESCE(c.covered_geom, ST_GeomFromText('POLYGON EMPTY'))
        )::geography
      ) / 1000000 as uncovered_area_km2
    FROM branch_area ba
    CROSS JOIN covered c
  `, [branch, bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);
}

/**
 * 5. Generate heatmap data (prayer intensity grid)
 */
export async function getHeatmapData(
  branch: string,
  gridSizeMeters: number = 100,
  startDate?: Date,
  endDate?: Date
) {
  const dateFilter = startDate && endDate
    ? `AND pw.start_time BETWEEN $3 AND $4`
    : '';

  const params: any[] = [branch, gridSizeMeters];
  if (startDate && endDate) {
    params.push(startDate, endDate);
  }

  return executePostGISQuery(`
    WITH grid AS (
      SELECT 
        ST_SnapToGrid(gp.location, $2) as grid_point,
        COUNT(*) as prayer_intensity,
        MAX(gp.recorded_at) as last_prayed
      FROM gps_points gp
      JOIN prayer_walks pw ON gp.walk_id = pw.id
      WHERE pw.branch = $1
      ${dateFilter}
      GROUP BY ST_SnapToGrid(gp.location, $2)
    )
    SELECT 
      ST_AsGeoJSON(grid_point) as point,
      prayer_intensity,
      last_prayed
    FROM grid
    ORDER BY prayer_intensity DESC
  `, params);
}

/**
 * 6. Find streets within a certain distance of a walk route
 */
export async function getStreetsNearRoute(walkId: string, distanceMeters: number = 50) {
  return executePostGISQuery(`
    SELECT 
      s.id,
      s.name,
      s.prayer_count,
      ST_AsGeoJSON(s.geometry) as geometry,
      ST_Distance(s.geometry::geography, pw.route::geography) as distance_meters
    FROM streets s
    CROSS JOIN prayer_walks pw
    WHERE pw.id = $1
    AND ST_DWithin(
      s.geometry::geography,
      pw.route::geography,
      $2
    )
    ORDER BY distance_meters
  `, [walkId, distanceMeters]);
}

/**
 * 7. Calculate prayer coverage overlap (areas prayed multiple times)
 */
export async function getCoverageOverlap(branch: string, minPrayerCount: number = 2) {
  return executePostGISQuery(`
    SELECT 
      pc.id,
      pc.prayer_count,
      pc.first_prayed_at,
      pc.last_prayed_at,
      ST_AsGeoJSON(pc.geometry) as geometry,
      ST_Area(pc.geometry::geography) / 1000000 as area_km2
    FROM prayer_coverage pc
    WHERE pc.branch = $1
    AND pc.prayer_count >= $2
    ORDER BY pc.prayer_count DESC
  `, [branch, minPrayerCount]);
}

/**
 * 8. Get walk statistics with spatial metrics
 */
export async function getWalkSpatialStats(walkId: string) {
  return executePostGISQuery(`
    SELECT 
      pw.id,
      pw.branch,
      pw.start_time,
      pw.end_time,
      pw.distance_meters,
      ST_AsGeoJSON(pw.route) as route,
      ST_Length(pw.route::geography) as calculated_distance_meters,
      ST_AsGeoJSON(ST_StartPoint(pw.route)) as start_point,
      ST_AsGeoJSON(ST_EndPoint(pw.route)) as end_point,
      COUNT(DISTINCT gp.id) as gps_point_count,
      COUNT(DISTINCT pj.id) as journal_entry_count,
      COUNT(DISTINCT p.user_id) as participant_count
    FROM prayer_walks pw
    LEFT JOIN gps_points gp ON pw.id = gp.walk_id
    LEFT JOIN prayer_journals pj ON pw.id = pj.walk_id
    LEFT JOIN participants p ON pw.id = p.walk_id
    WHERE pw.id = $1
    GROUP BY pw.id
  `, [walkId]);
}

/**
 * 9. Find nearby prayer walks (within a radius)
 */
export async function getNearbyWalks(
  latitude: number,
  longitude: number,
  radiusMeters: number = 1000,
  limit: number = 10
) {
  return executePostGISQuery(`
    SELECT 
      pw.id,
      pw.branch,
      pw.start_time,
      pw.end_time,
      pw.distance_meters,
      ST_AsGeoJSON(pw.route) as route,
      ST_Distance(
        pw.route::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
      ) as distance_from_point
    FROM prayer_walks pw
    WHERE pw.route IS NOT NULL
    AND ST_DWithin(
      pw.route::geography,
      ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
      $3
    )
    ORDER BY distance_from_point
    LIMIT $4
  `, [latitude, longitude, radiusMeters, limit]);
}

/**
 * 10. Get coverage timeline (how coverage has grown over time)
 */
export async function getCoverageTimeline(branch: string, intervalDays: number = 7) {
  return executePostGISQuery(`
    WITH time_series AS (
      SELECT 
        date_trunc('day', generate_series(
          (SELECT MIN(first_prayed_at) FROM prayer_coverage WHERE branch = $1),
          NOW(),
          interval '${intervalDays} days'
        )) as period_start
    ),
    cumulative_coverage AS (
      SELECT 
        ts.period_start,
        ST_Union(pc.geometry) as covered_area
      FROM time_series ts
      LEFT JOIN prayer_coverage pc ON 
        pc.branch = $1 AND 
        pc.first_prayed_at <= ts.period_start
      GROUP BY ts.period_start
    )
    SELECT 
      period_start,
      ST_Area(covered_area::geography) / 1000000 as covered_area_km2,
      COUNT(DISTINCT pc.id) as total_coverage_polygons
    FROM cumulative_coverage cc
    LEFT JOIN prayer_coverage pc ON 
      pc.branch = $1 AND 
      pc.first_prayed_at <= cc.period_start
    GROUP BY period_start, covered_area
    ORDER BY period_start
  `, [branch]);
}

/**
 * 11. Get prayer density by area (prayers per square kilometer)
 */
export async function getPrayerDensity(branch: string) {
  return executePostGISQuery(`
    SELECT 
      pc.id,
      pc.prayer_count,
      ST_AsGeoJSON(pc.geometry) as geometry,
      ST_Area(pc.geometry::geography) / 1000000 as area_km2,
      pc.prayer_count / (ST_Area(pc.geometry::geography) / 1000000) as prayers_per_km2
    FROM prayer_coverage pc
    WHERE pc.branch = $1
    AND ST_Area(pc.geometry::geography) > 0
    ORDER BY prayers_per_km2 DESC
  `, [branch]);
}

/**
 * 12. Find gaps in coverage (areas between covered zones)
 */
export async function getCoverageGaps(branch: string, maxGapSizeKm2: number = 1) {
  return executePostGISQuery(`
    WITH covered_union AS (
      SELECT ST_Union(geometry) as covered
      FROM prayer_coverage
      WHERE branch = $1
    ),
    branch_boundary AS (
      SELECT ST_ConvexHull(ST_Union(geometry)) as boundary
      FROM streets
      WHERE branch = $1
    )
    SELECT 
      ST_AsGeoJSON(
        (ST_Dump(
          ST_Difference(bb.boundary, cu.covered)
        )).geom
      ) as gap_geometry,
      ST_Area(
        (ST_Dump(
          ST_Difference(bb.boundary, cu.covered)
        )).geom::geography
      ) / 1000000 as gap_area_km2
    FROM branch_boundary bb
    CROSS JOIN covered_union cu
    WHERE ST_Area(
      (ST_Dump(
        ST_Difference(bb.boundary, cu.covered)
      )).geom::geography
    ) / 1000000 <= $2
  `, [branch, maxGapSizeKm2]);
}

/**
 * 13. Get branch leaderboard (most active branches)
 */
export async function getBranchLeaderboard() {
  return executePostGISQuery(`
    SELECT 
      pw.branch,
      COUNT(DISTINCT pw.id) as total_walks,
      COUNT(DISTINCT p.user_id) as unique_participants,
      SUM(pw.distance_meters) as total_distance_meters,
      ST_Area(ST_Union(pc.geometry)::geography) / 1000000 as covered_area_km2,
      MAX(pw.end_time) as last_walk_date
    FROM prayer_walks pw
    LEFT JOIN participants p ON pw.id = p.walk_id
    LEFT JOIN prayer_coverage pc ON pc.branch = pw.branch
    WHERE pw.status = 'completed'
    GROUP BY pw.branch
    ORDER BY total_walks DESC, covered_area_km2 DESC
  `);
}

/**
 * 14. Get user prayer statistics
 */
export async function getUserPrayerStats(userId: string) {
  return executePostGISQuery(`
    SELECT 
      u.id,
      u.name,
      u.branch,
      COUNT(DISTINCT p.walk_id) as walks_participated,
      COUNT(DISTINCT CASE WHEN pw.leader_id = u.id THEN pw.id END) as walks_led,
      SUM(CASE WHEN p.walk_id IS NOT NULL THEN pw.distance_meters ELSE 0 END) as total_distance_meters,
      COUNT(DISTINCT pj.id) as journal_entries,
      MIN(p.joined_at) as first_walk_date,
      MAX(pw.end_time) as last_walk_date
    FROM users u
    LEFT JOIN participants p ON u.id = p.user_id
    LEFT JOIN prayer_walks pw ON p.walk_id = pw.id
    LEFT JOIN prayer_journals pj ON u.id = pj.user_id
    WHERE u.id = $1
    GROUP BY u.id
  `, [userId]);
}

/**
 * 15. Optimize spatial indexes (run periodically for performance)
 */
export async function optimizeSpatialIndexes() {
  await executePostGISQuery(`VACUUM ANALYZE prayer_walks`);
  await executePostGISQuery(`VACUUM ANALYZE prayer_coverage`);
  await executePostGISQuery(`VACUUM ANALYZE gps_points`);
  await executePostGISQuery(`VACUUM ANALYZE streets`);

  await executePostGISQuery(`REINDEX INDEX idx_prayer_walks_route`);
  await executePostGISQuery(`REINDEX INDEX idx_prayer_coverage_geometry`);
  await executePostGISQuery(`REINDEX INDEX idx_gps_points_location`);
  await executePostGISQuery(`REINDEX INDEX idx_streets_geometry`);

  console.log('Spatial indexes optimized');
}

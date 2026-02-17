-- Migration: 001_initial_schema
-- Description: Initial database schema with PostGIS support
-- Created: 2026-02-16

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    branch VARCHAR(100) NOT NULL,
    role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('admin', 'leader', 'member')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    otp_code VARCHAR(6),
    otp_expires_at TIMESTAMP WITH TIME ZONE
);

-- Prayer walks table
CREATE TABLE prayer_walks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch VARCHAR(100) NOT NULL,
    leader_id UUID REFERENCES users(id) ON DELETE SET NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    route GEOMETRY(LineString, 4326),
    distance_meters DECIMAL(10, 2),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_prayer_walks_route ON prayer_walks USING GIST(route);
CREATE INDEX idx_prayer_walks_branch ON prayer_walks(branch);
CREATE INDEX idx_prayer_walks_start_time ON prayer_walks(start_time);

-- Participants table
CREATE TABLE participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    walk_id UUID NOT NULL REFERENCES prayer_walks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(walk_id, user_id)
);

CREATE INDEX idx_participants_walk_id ON participants(walk_id);
CREATE INDEX idx_participants_user_id ON participants(user_id);

-- GPS tracking points
CREATE TABLE gps_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    walk_id UUID NOT NULL REFERENCES prayer_walks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location GEOMETRY(Point, 4326) NOT NULL,
    accuracy DECIMAL(10, 2),
    altitude DECIMAL(10, 2),
    speed DECIMAL(10, 2),
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_gps_points_location ON gps_points USING GIST(location);
CREATE INDEX idx_gps_points_walk_id ON gps_points(walk_id);
CREATE INDEX idx_gps_points_recorded_at ON gps_points(recorded_at);

-- Prayer journals table
CREATE TABLE prayer_journals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    walk_id UUID NOT NULL REFERENCES prayer_walks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    location GEOMETRY(Point, 4326),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_prayer_journals_walk_id ON prayer_journals(walk_id);
CREATE INDEX idx_prayer_journals_user_id ON prayer_journals(user_id);
CREATE INDEX idx_prayer_journals_location ON prayer_journals USING GIST(location);

-- Prayer coverage table
CREATE TABLE prayer_coverage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch VARCHAR(100) NOT NULL,
    geometry GEOMETRY(Polygon, 4326) NOT NULL,
    walk_id UUID REFERENCES prayer_walks(id) ON DELETE SET NULL,
    prayed BOOLEAN DEFAULT true,
    prayer_count INTEGER DEFAULT 1,
    first_prayed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_prayed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_prayer_coverage_geometry ON prayer_coverage USING GIST(geometry);
CREATE INDEX idx_prayer_coverage_branch ON prayer_coverage(branch);
CREATE INDEX idx_prayer_coverage_prayed ON prayer_coverage(prayed);

-- Streets table
CREATE TABLE streets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255),
    branch VARCHAR(100) NOT NULL,
    geometry GEOMETRY(LineString, 4326) NOT NULL,
    prayer_count INTEGER DEFAULT 0,
    last_prayed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_streets_geometry ON streets USING GIST(geometry);
CREATE INDEX idx_streets_branch ON streets(branch);
CREATE INDEX idx_streets_name ON streets(name);

-- Triggers and functions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prayer_walks_updated_at BEFORE UPDATE ON prayer_walks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prayer_journals_updated_at BEFORE UPDATE ON prayer_journals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION calculate_route_distance()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.route IS NOT NULL THEN
        NEW.distance_meters = ST_Length(NEW.route::geography);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_prayer_walk_distance 
    BEFORE INSERT OR UPDATE OF route ON prayer_walks
    FOR EACH ROW EXECUTE FUNCTION calculate_route_distance();

CREATE OR REPLACE FUNCTION update_prayer_coverage_from_walk()
RETURNS TRIGGER AS $$
DECLARE
    buffer_distance DECIMAL := 50;
    coverage_polygon GEOMETRY;
BEGIN
    IF NEW.status = 'completed' AND NEW.route IS NOT NULL THEN
        coverage_polygon := ST_Buffer(NEW.route::geography, buffer_distance)::geometry;
        
        INSERT INTO prayer_coverage (branch, geometry, walk_id, prayer_count, first_prayed_at, last_prayed_at)
        VALUES (NEW.branch, coverage_polygon, NEW.id, 1, NEW.end_time, NEW.end_time)
        ON CONFLICT DO NOTHING;
        
        UPDATE streets 
        SET prayer_count = prayer_count + 1,
            last_prayed_at = NEW.end_time
        WHERE branch = NEW.branch 
        AND ST_Intersects(geometry, NEW.route);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_coverage_on_walk_complete
    AFTER UPDATE OF status ON prayer_walks
    FOR EACH ROW 
    WHEN (NEW.status = 'completed')
    EXECUTE FUNCTION update_prayer_coverage_from_walk();

-- Views
CREATE OR REPLACE VIEW walk_statistics AS
SELECT 
    pw.id,
    pw.branch,
    pw.start_time,
    pw.end_time,
    pw.distance_meters,
    pw.status,
    u.name as leader_name,
    COUNT(DISTINCT p.user_id) as participant_count,
    COUNT(DISTINCT pj.id) as journal_entry_count,
    EXTRACT(EPOCH FROM (COALESCE(pw.end_time, NOW()) - pw.start_time)) / 60 as duration_minutes
FROM prayer_walks pw
LEFT JOIN users u ON pw.leader_id = u.id
LEFT JOIN participants p ON pw.id = p.walk_id
LEFT JOIN prayer_journals pj ON pw.id = pj.walk_id
GROUP BY pw.id, u.name;

CREATE OR REPLACE VIEW branch_coverage_stats AS
SELECT 
    branch,
    COUNT(DISTINCT id) as total_walks,
    SUM(distance_meters) as total_distance_meters,
    COUNT(DISTINCT CASE WHEN status = 'completed' THEN id END) as completed_walks,
    ST_Union(route) as combined_routes
FROM prayer_walks
WHERE route IS NOT NULL
GROUP BY branch;

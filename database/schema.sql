-- =====================================================
-- Charis Prayer Walk - PostgreSQL Schema with PostGIS
-- Neon Serverless PostgreSQL Database
-- =====================================================

-- Enable PostGIS extension
-- NOTE: On Neon, enable PostGIS via the Neon Console:
-- 1. Go to your project dashboard at https://console.neon.tech
-- 2. Navigate to your database
-- 3. Click on "Extensions" in the sidebar
-- 4. Enable "postgis" extension
-- Alternatively, run this if you have superuser access:
CREATE EXTENSION IF NOT EXISTS postgis;

-- Verify PostGIS is enabled
SELECT PostGIS_version();

-- =====================================================
-- TABLES
-- =====================================================

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
    route GEOMETRY(LineString, 4326), -- GeoJSON route as PostGIS geometry
    distance_meters DECIMAL(10, 2),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create spatial index on route
CREATE INDEX idx_prayer_walks_route ON prayer_walks USING GIST(route);
CREATE INDEX idx_prayer_walks_branch ON prayer_walks(branch);
CREATE INDEX idx_prayer_walks_start_time ON prayer_walks(start_time);

-- Participants table (many-to-many relationship)
CREATE TABLE participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    walk_id UUID NOT NULL REFERENCES prayer_walks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(walk_id, user_id)
);

CREATE INDEX idx_participants_walk_id ON participants(walk_id);
CREATE INDEX idx_participants_user_id ON participants(user_id);

-- GPS tracking points (for real-time tracking and route reconstruction)
CREATE TABLE gps_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    walk_id UUID NOT NULL REFERENCES prayer_walks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location GEOMETRY(Point, 4326) NOT NULL,
    accuracy DECIMAL(10, 2), -- GPS accuracy in meters
    altitude DECIMAL(10, 2),
    speed DECIMAL(10, 2), -- meters per second
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create spatial index on GPS points
CREATE INDEX idx_gps_points_location ON gps_points USING GIST(location);
CREATE INDEX idx_gps_points_walk_id ON gps_points(walk_id);
CREATE INDEX idx_gps_points_recorded_at ON gps_points(recorded_at);

-- Prayer journals table
CREATE TABLE prayer_journals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    walk_id UUID NOT NULL REFERENCES prayer_walks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    location GEOMETRY(Point, 4326), -- Optional: where the prayer was recorded
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_prayer_journals_walk_id ON prayer_journals(walk_id);
CREATE INDEX idx_prayer_journals_user_id ON prayer_journals(user_id);
CREATE INDEX idx_prayer_journals_location ON prayer_journals USING GIST(location);

-- Prayer coverage table (tracks which areas have been prayed over)
CREATE TABLE prayer_coverage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch VARCHAR(100) NOT NULL,
    geometry GEOMETRY(Polygon, 4326) NOT NULL, -- Area covered
    walk_id UUID REFERENCES prayer_walks(id) ON DELETE SET NULL,
    prayed BOOLEAN DEFAULT true,
    prayer_count INTEGER DEFAULT 1, -- How many times this area has been prayed over
    first_prayed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_prayed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create spatial index on coverage geometry
CREATE INDEX idx_prayer_coverage_geometry ON prayer_coverage USING GIST(geometry);
CREATE INDEX idx_prayer_coverage_branch ON prayer_coverage(branch);
CREATE INDEX idx_prayer_coverage_prayed ON prayer_coverage(prayed);

-- Streets table (for tracking which streets have been covered)
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

-- =====================================================
-- FUNCTIONS AND TRIGGERS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prayer_walks_updated_at BEFORE UPDATE ON prayer_walks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prayer_journals_updated_at BEFORE UPDATE ON prayer_journals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate route distance when route is updated
CREATE OR REPLACE FUNCTION calculate_route_distance()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.route IS NOT NULL THEN
        -- Calculate distance in meters using ST_Length with geography cast
        NEW.distance_meters = ST_Length(NEW.route::geography);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_prayer_walk_distance 
    BEFORE INSERT OR UPDATE OF route ON prayer_walks
    FOR EACH ROW EXECUTE FUNCTION calculate_route_distance();

-- Function to update prayer coverage when a walk is completed
CREATE OR REPLACE FUNCTION update_prayer_coverage_from_walk()
RETURNS TRIGGER AS $$
DECLARE
    buffer_distance DECIMAL := 50; -- 50 meters buffer around the route
    coverage_polygon GEOMETRY;
BEGIN
    IF NEW.status = 'completed' AND NEW.route IS NOT NULL THEN
        -- Create a buffer around the route to represent coverage area
        coverage_polygon := ST_Buffer(NEW.route::geography, buffer_distance)::geometry;
        
        -- Insert or update coverage
        INSERT INTO prayer_coverage (branch, geometry, walk_id, prayer_count, first_prayed_at, last_prayed_at)
        VALUES (NEW.branch, coverage_polygon, NEW.id, 1, NEW.end_time, NEW.end_time)
        ON CONFLICT DO NOTHING;
        
        -- Update streets that intersect with this walk
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

-- =====================================================
-- VIEWS
-- =====================================================

-- View for walk statistics
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

-- View for branch coverage statistics
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

-- =====================================================
-- SEED DATA (Optional - for testing)
-- =====================================================

-- Insert sample branches (you can customize these)
-- INSERT INTO users (phone, name, branch, role) VALUES
-- ('+1234567890', 'John Doe', 'Downtown', 'leader'),
-- ('+1234567891', 'Jane Smith', 'Downtown', 'member'),
-- ('+1234567892', 'Bob Johnson', 'Westside', 'leader');

-- =====================================================
-- GRANTS (Adjust based on your security requirements)
-- =====================================================

-- Example: Grant permissions to your application user
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_app_user;

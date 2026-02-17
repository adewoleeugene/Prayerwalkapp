-- =====================================================
-- Charis Prayer Walk - Phase 2 Schema
-- Prayer Discovery & Gamification System
-- =====================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- =====================================================
-- CORE TABLES
-- =====================================================

-- Users table (enhanced for email auth)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_users_email ON users(email);

-- Prayer locations (physical places to visit)
CREATE TABLE IF NOT EXISTS prayer_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    location GEOMETRY(Point, 4326) NOT NULL,
    address VARCHAR(500),
    prayer_text TEXT NOT NULL,
    category VARCHAR(100),
    difficulty VARCHAR(20) DEFAULT 'easy' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    points INTEGER DEFAULT 10,
    radius_meters DECIMAL(10, 2) DEFAULT 50, -- How close user must be
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_prayer_locations_location ON prayer_locations USING GIST(location);
CREATE INDEX idx_prayer_locations_category ON prayer_locations(category);
CREATE INDEX idx_prayer_locations_is_active ON prayer_locations(is_active);

-- Prayer sessions (active walks)
CREATE TABLE IF NOT EXISTS prayer_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location_id UUID REFERENCES prayer_locations(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    start_location GEOMETRY(Point, 4326),
    current_location GEOMETRY(Point, 4326),
    distance_traveled DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_prayer_sessions_user_id ON prayer_sessions(user_id);
CREATE INDEX idx_prayer_sessions_location_id ON prayer_sessions(location_id);
CREATE INDEX idx_prayer_sessions_status ON prayer_sessions(status);
CREATE INDEX idx_prayer_sessions_current_location ON prayer_sessions USING GIST(current_location);

-- Prayers (the actual prayer content)
CREATE TABLE IF NOT EXISTS prayers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL REFERENCES prayer_locations(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    scripture_reference VARCHAR(255),
    duration_minutes INTEGER DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_prayers_location_id ON prayers(location_id);

-- Completions (user achievements)
CREATE TABLE IF NOT EXISTS completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES prayer_locations(id) ON DELETE CASCADE,
    session_id UUID REFERENCES prayer_sessions(id) ON DELETE SET NULL,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completion_location GEOMETRY(Point, 4326),
    distance_from_target DECIMAL(10, 2),
    points_earned INTEGER DEFAULT 0,
    UNIQUE(user_id, location_id)
);

CREATE INDEX idx_completions_user_id ON completions(user_id);
CREATE INDEX idx_completions_location_id ON completions(location_id);
CREATE INDEX idx_completions_completed_at ON completions(completed_at);

-- Badges (achievements)
CREATE TABLE IF NOT EXISTS badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_type VARCHAR(50) NOT NULL,
    badge_name VARCHAR(100) NOT NULL,
    description TEXT,
    icon_url VARCHAR(500),
    earned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    milestone_value INTEGER
);

CREATE INDEX idx_badges_user_id ON badges(user_id);
CREATE INDEX idx_badges_badge_type ON badges(badge_type);

-- =====================================================
-- TRIGGERS
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prayer_locations_updated_at BEFORE UPDATE ON prayer_locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prayer_sessions_updated_at BEFORE UPDATE ON prayer_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VIEWS
-- =====================================================

CREATE OR REPLACE VIEW user_stats AS
SELECT 
    u.id,
    u.name,
    u.email,
    COUNT(DISTINCT c.id) as total_completions,
    COUNT(DISTINCT b.id) as total_badges,
    SUM(c.points_earned) as total_points,
    SUM(ps.distance_traveled) as total_distance_meters,
    COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'active') as active_sessions
FROM users u
LEFT JOIN completions c ON u.id = c.user_id
LEFT JOIN badges b ON u.id = b.user_id
LEFT JOIN prayer_sessions ps ON u.id = ps.user_id
GROUP BY u.id;

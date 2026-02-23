-- Migration: 002_branches_config
-- Description: Add admin-managed branch configuration table
-- Created: 2026-02-22

CREATE TABLE IF NOT EXISTS branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    center_lat DOUBLE PRECISION NOT NULL,
    center_lng DOUBLE PRECISION NOT NULL,
    service_radius_meters INTEGER NOT NULL DEFAULT 80000,
    country VARCHAR(100),
    region VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branches_is_active ON branches(is_active);
CREATE INDEX IF NOT EXISTS idx_branches_sort_order ON branches(sort_order);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'update_branches_updated_at'
    ) THEN
      CREATE TRIGGER update_branches_updated_at
      BEFORE UPDATE ON branches
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END IF;
END $$;

INSERT INTO branches (name, slug, center_lat, center_lng, service_radius_meters, country, region, sort_order, is_active)
VALUES
  ('London', 'london', 51.5074, -0.1278, 80000, 'United Kingdom', 'England', 10, true),
  ('Birmingham', 'birmingham', 52.4862, -1.8904, 80000, 'United Kingdom', 'England', 20, true),
  ('Brighton', 'brighton', 50.8225, -0.1372, 80000, 'United Kingdom', 'England', 30, true),
  ('Bristol', 'bristol', 51.4545, -2.5879, 80000, 'United Kingdom', 'England', 40, true),
  ('Chatham', 'chatham', 51.3736, 0.5280, 80000, 'United Kingdom', 'England', 50, true),
  ('Chelmsford', 'chelmsford', 51.7343, 0.4760, 80000, 'United Kingdom', 'England', 60, true),
  ('Coventry', 'coventry', 52.4068, -1.5197, 80000, 'United Kingdom', 'England', 70, true),
  ('Croydon', 'croydon', 51.3762, -0.0982, 80000, 'United Kingdom', 'England', 80, true),
  ('Luton', 'luton', 51.8787, -0.4200, 80000, 'United Kingdom', 'England', 90, true),
  ('Northampton', 'northampton', 52.2405, -0.9027, 80000, 'United Kingdom', 'England', 100, true),
  ('Nottingham', 'nottingham', 52.9548, -1.1581, 80000, 'United Kingdom', 'England', 110, true),
  ('Orpington', 'orpington', 51.3746, 0.1022, 80000, 'United Kingdom', 'England', 120, true),
  ('Reading', 'reading', 51.4543, -0.9781, 80000, 'United Kingdom', 'England', 130, true),
  ('Accra', 'accra', 5.6037, -0.1870, 80000, 'Ghana', 'Greater Accra', 140, true),
  ('Freetown', 'freetown', 8.4657, -13.2317, 80000, 'Sierra Leone', 'Western Area', 150, true)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  center_lat = EXCLUDED.center_lat,
  center_lng = EXCLUDED.center_lng,
  service_radius_meters = EXCLUDED.service_radius_meters,
  country = EXCLUDED.country,
  region = EXCLUDED.region,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

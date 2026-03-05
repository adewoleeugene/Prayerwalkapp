-- Migration: Offline sync idempotency + device event timestamps
-- Date: 2026-03-05

ALTER TABLE gps_events
  ADD COLUMN IF NOT EXISTS event_at TIMESTAMPTZ(6);

UPDATE gps_events
SET event_at = COALESCE(event_at, "timestamp", NOW())
WHERE event_at IS NULL;

ALTER TABLE gps_events
  ALTER COLUMN event_at SET NOT NULL,
  ALTER COLUMN event_at SET DEFAULT NOW();

ALTER TABLE gps_events
  ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gps_events_session_client_request
  ON gps_events(session_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gps_events_session_event_at
  ON gps_events(session_id, event_at DESC);

CREATE TABLE IF NOT EXISTS mobile_sync_requests (
  idempotency_key VARCHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint VARCHAR(64) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  response_code INTEGER NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_sync_requests_user_id
  ON mobile_sync_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_mobile_sync_requests_endpoint_created
  ON mobile_sync_requests(endpoint, created_at DESC);

-- Migration 008: Production hardening indexes and constraints
-- Adds missing indexes for common query patterns

-- Prayer sessions: frequently filtered by branch and time range
CREATE INDEX IF NOT EXISTS idx_prayer_sessions_branch ON prayer_sessions(branch);
CREATE INDEX IF NOT EXISTS idx_prayer_sessions_created_at ON prayer_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prayer_sessions_branch_status ON prayer_sessions(branch, status);

-- GPS flags: admin security dashboard queries
CREATE INDEX IF NOT EXISTS idx_gps_flags_severity_created ON gps_flags(severity, created_at DESC);

-- Completions: analytics queries by date
CREATE INDEX IF NOT EXISTS idx_completions_completed_at_desc ON completions(completed_at DESC);

-- Admin invites: cleanup queries for expired invites
CREATE INDEX IF NOT EXISTS idx_admin_invites_status_expires ON admin_invites(status, expires_at);

-- Audit logs: ip address and user agent for security forensics
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500);

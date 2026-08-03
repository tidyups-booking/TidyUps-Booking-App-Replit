-- Migration: create dispatcher_allowlist table
-- Idempotent: safe to run multiple times.
--
-- This table is the authoritative source of dispatcher identity.
-- Any authenticated Clerk user whose clerk_user_id appears here is treated
-- as a dispatcher with full API access.
--
-- Initial seeding (run once per deployment):
--   INSERT INTO dispatcher_allowlist (clerk_user_id) VALUES ('<clerk_user_id>');
--
-- Get the clerk_user_id for a user from the Clerk dashboard → Users.

CREATE TABLE IF NOT EXISTS dispatcher_allowlist (
  clerk_user_id TEXT PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

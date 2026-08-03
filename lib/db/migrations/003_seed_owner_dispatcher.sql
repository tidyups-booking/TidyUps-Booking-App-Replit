-- Migration: seed the owner's Clerk account as the first dispatcher.
-- Idempotent: safe to run multiple times.
--
-- The dispatcher allowlist gates all dispatcher routes. Without at least one
-- entry, every dispatcher API call returns 403 and the app appears empty.
INSERT INTO dispatcher_allowlist (clerk_user_id)
VALUES ('user_3HLfIvfWjzve8TpHZXXhKZVSTzx')
ON CONFLICT DO NOTHING;

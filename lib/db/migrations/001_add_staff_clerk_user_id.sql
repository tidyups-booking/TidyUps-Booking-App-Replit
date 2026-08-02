-- Migration: add clerk_user_id to staff table
-- Idempotent: safe to run multiple times.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_clerk_user_id_unique;
ALTER TABLE staff ADD CONSTRAINT staff_clerk_user_id_unique UNIQUE (clerk_user_id);

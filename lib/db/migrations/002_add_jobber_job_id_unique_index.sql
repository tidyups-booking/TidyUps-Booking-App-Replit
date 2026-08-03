-- Migration: separate Jobber request IDs from Jobber job IDs
--
-- bookings.jobber_job_id stores Jobber REQUEST IDs (from outbound requestCreate).
-- Calendar sync imports Jobber JOBs, a distinct entity with different IDs.
-- Mixing them risks identity collisions and upsert corruption.
--
-- Steps (all idempotent):
--   1. Drop the mis-scoped unique index on jobber_job_id (earlier attempt).
--   2. Add the dedicated jobber_synced_job_id column.
--   3. Safe deduplication preflight: NULL out duplicate jobber_synced_job_id
--      values on the higher-id rows — booking records are NEVER deleted.
--      This is a no-op when all values are already NULL or distinct.
--   4. Create the unique index on jobber_synced_job_id.

-- Step 1: remove any mis-scoped index (idempotent)
DROP INDEX IF EXISTS bookings_jobber_job_id_unique;

-- Step 2: add dedicated calendar-sync column (idempotent)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS jobber_synced_job_id TEXT;

-- Step 3: safe deduplication — NULL out the duplicate value on higher-id rows.
-- The booking record is retained; only the Jobber job ID reference is cleared
-- so it can be re-imported cleanly on the next sync.
UPDATE bookings
SET jobber_synced_job_id = NULL
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY jobber_synced_job_id
        ORDER BY id
      ) AS rn
    FROM bookings
    WHERE jobber_synced_job_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Step 4: create unique index (non-partial; PostgreSQL allows multiple NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS bookings_jobber_synced_job_id_unique
  ON bookings (jobber_synced_job_id);

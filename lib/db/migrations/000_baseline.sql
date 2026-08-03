-- Baseline migration: create all tables that exist before any incremental migrations.
-- Idempotent: safe to run against an empty DB or one that already has these tables.
-- All incremental migrations (001, 002, 003 …) are designed to build on top of this.

-- ── Enum types ──────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE staff_role AS ENUM ('cleaner', 'lead_cleaner', 'supervisor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE service_type AS ENUM (
    'standard_clean', 'deep_clean', 'move_in_out', 'post_construction'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE frequency AS ENUM (
    'one_time', 'weekly', 'biweekly', 'monthly'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM (
    'pending', 'confirmed', 'in_progress', 'completed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── staff ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staff (
  id           SERIAL PRIMARY KEY,
  name         TEXT    NOT NULL,
  role         staff_role NOT NULL DEFAULT 'cleaner',
  phone        TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  home_address TEXT,
  home_lat     DOUBLE PRECISION,
  home_lng     DOUBLE PRECISION,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── bookings ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bookings (
  id                  SERIAL PRIMARY KEY,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  phone               TEXT NOT NULL,
  email               TEXT,
  address             TEXT NOT NULL,
  city                TEXT NOT NULL,
  province            TEXT NOT NULL DEFAULT 'AB',
  postal_code         TEXT,
  service_type        service_type NOT NULL,
  bedrooms            REAL NOT NULL DEFAULT 2,
  bathrooms           REAL NOT NULL DEFAULT 1,
  extras              TEXT[] NOT NULL DEFAULT '{}',
  scheduled_date      TEXT NOT NULL,
  scheduled_time      TEXT NOT NULL,
  frequency           frequency NOT NULL DEFAULT 'one_time',
  estimated_price     REAL,
  notes               TEXT,
  staff_id            INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  status              booking_status NOT NULL DEFAULT 'pending',
  address_lat         REAL,
  address_lng         REAL,
  jobber_job_id       TEXT,
  jobber_sync_status  TEXT NOT NULL DEFAULT 'not_started',
  jobber_sync_error   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── call_transcripts ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS call_transcripts (
  id                    SERIAL PRIMARY KEY,
  booking_id            INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  transcript            TEXT NOT NULL,
  call_duration_seconds INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── cleaner_locations ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cleaner_locations (
  id         SERIAL PRIMARY KEY,
  staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE UNIQUE,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  accuracy   REAL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── jobber_tokens ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS jobber_tokens (
  id            SERIAL PRIMARY KEY,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type    TEXT NOT NULL DEFAULT 'Bearer',
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

/**
 * Embedded migration runner.
 *
 * Each migration is listed in order below as an idempotent SQL string.
 * New migrations must be appended here AND added as a .sql file in
 * lib/db/migrations/ for human reference / manual psql runs.
 *
 * runMigrations() is called automatically by the API server at startup,
 * before it begins serving traffic, so the schema is always up to date
 * on both first deploy and re-deploys.
 *
 * Applied migrations are recorded in the `_migrations` table so each
 * migration runs exactly once, even across restarts.
 */

import { pool } from "./pool.js";

/**
 * Renamed migrations: if the old name is recorded in `_migrations`, the new
 * name is marked applied too, so the same migration never runs twice under
 * two names. Applies to both this runner and lib/db/migrate.sh.
 */
const RENAMED_MIGRATIONS: { oldName: string; newName: string }[] = [
  // Renamed when the jobber sync column migration was rewritten
  { oldName: "002_add_jobber_job_id_unique_index", newName: "003_add_jobber_synced_job_id" },
  // Renumbered during rebase: main took 005 for contact_messages
  { oldName: "005_add_price_breakdown", newName: "006_add_price_breakdown" },
  // Renumbered during rebase: main took 006 for price_breakdown
  { oldName: "006_add_contact_message_handled_at", newName: "007_add_contact_message_handled_at" },
];

// hint: Logic changed on both sides. Requires understanding intent of each change.
const MIGRATIONS: { name: string; sql: string }[] = [
  {
    // Baseline: all tables that exist before any incremental migrations.
    // Idempotent — safe on an empty DB or one that already has these tables.
    // Mirrors lib/db/migrations/000_baseline.sql.
    name: "000_baseline",
    sql: `
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

      CREATE TABLE IF NOT EXISTS call_transcripts (
        id                    SERIAL PRIMARY KEY,
        booking_id            INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        transcript            TEXT NOT NULL,
        call_duration_seconds INTEGER,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS cleaner_locations (
        id         SERIAL PRIMARY KEY,
        staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE UNIQUE,
        lat        DOUBLE PRECISION NOT NULL,
        lng        DOUBLE PRECISION NOT NULL,
        accuracy   REAL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS jobber_tokens (
        id            SERIAL PRIMARY KEY,
        access_token  TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        token_type    TEXT NOT NULL DEFAULT 'Bearer',
        expires_at    TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "001_add_staff_clerk_user_id",
    sql: `
      ALTER TABLE staff ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;
      -- Drop both the constraint and any index with this name before re-adding,
      -- because Drizzle may have created a unique INDEX rather than a CONSTRAINT
      -- and DROP CONSTRAINT does not remove standalone indexes.
      ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_clerk_user_id_unique;
      DROP INDEX IF EXISTS staff_clerk_user_id_unique;
      ALTER TABLE staff ADD CONSTRAINT staff_clerk_user_id_unique UNIQUE (clerk_user_id);
    `,
  },
  {
    name: "002_add_dispatcher_allowlist",
    sql: `
      CREATE TABLE IF NOT EXISTS dispatcher_allowlist (
        clerk_user_id TEXT PRIMARY KEY,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    // Separate Jobber request IDs from Jobber job IDs for calendar sync.
    // Full commentary in lib/db/migrations/003_add_jobber_synced_job_id.sql.
    // All steps are idempotent.
    name: "003_add_jobber_synced_job_id",
    sql: `
      DROP INDEX IF EXISTS bookings_jobber_job_id_unique;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS jobber_synced_job_id TEXT;
      UPDATE bookings
      SET jobber_synced_job_id = NULL
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY jobber_synced_job_id ORDER BY id
          ) AS rn
          FROM bookings
          WHERE jobber_synced_job_id IS NOT NULL
        ) ranked
        WHERE rn > 1
      );
      CREATE UNIQUE INDEX IF NOT EXISTS bookings_jobber_synced_job_id_unique
        ON bookings (jobber_synced_job_id);
    `,
  },
  {
    // Bootstrap the owner's dispatcher access. Without at least one allowlisted
    // dispatcher, every route returns 403 and the app appears empty.
    // A Clerk user ID is an identifier, not a secret.
    name: "003_seed_owner_dispatcher",
    sql: `
      INSERT INTO dispatcher_allowlist (clerk_user_id)
      VALUES ('user_3HLfIvfWjzve8TpHZXXhKZVSTzx')
      ON CONFLICT DO NOTHING;
    `,
  },
  {
    // Move-in and move-out are separate services; move_in_out is kept for
    // legacy rows but no longer offered in the booking forms.
    name: "004_split_move_in_out_service_types",
    sql: `
      ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'move_in';
      ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'move_out';
    `,
  },
  {
    // Contact form submissions from the public Contact page.
    // Mirrors lib/db/migrations/005_add_contact_messages.sql.
    name: "005_add_contact_messages",
    sql: `
      CREATE TABLE IF NOT EXISTS contact_messages (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        email      TEXT NOT NULL,
        phone      TEXT,
        message    TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    // Itemized price breakdown (hours, rate, discounts, fuel surcharge)
    // recorded at booking creation so dispatchers can see how the quoted
    // price was built. Mirrors lib/db/migrations/006_add_price_breakdown.sql.
    // (Renumbered from 005 during rebase: main added 005_add_contact_messages.)
    name: "006_add_price_breakdown",
    sql: `
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_breakdown JSONB;
    `,
  },
  {
    // Dispatcher inbox: track when a contact message was marked handled.
    // NULL = new/unread. Mirrors lib/db/migrations/007_add_contact_message_handled_at.sql.
    // (Renumbered from 006 during rebase: main added 006_add_price_breakdown.)
    name: "007_add_contact_message_handled_at",
    sql: `
      ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ;
    `,
  },
  {
    // Per-IP throttle ledger for the public contact form rate limiter, so
    // limits survive restarts and are shared across instances.
    // Mirrors lib/db/migrations/008_add_contact_form_throttle.sql.
    // (Renumbered from 007 during rebase: main added 007_add_contact_message_handled_at.)
    name: "008_add_contact_form_throttle",
    sql: `
      CREATE TABLE IF NOT EXISTS contact_form_throttle (
        id           BIGSERIAL PRIMARY KEY,
        ip           TEXT NOT NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS contact_form_throttle_ip_submitted_at_idx
        ON contact_form_throttle (ip, submitted_at);
    `,
  },
];

/**
 * Run all pending migrations in order.
 * Each migration is recorded in `_migrations` on success and will not
 * be re-executed on subsequent startups.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Ensure the tracking table exists before anything else.
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Reconcile renamed migrations: if the old name was recorded, mark the
    // new name as applied so the same migration never re-runs under a new name.
    for (const { oldName, newName } of RENAMED_MIGRATIONS) {
      await client.query(
        `INSERT INTO _migrations (name)
         SELECT $1 WHERE EXISTS (SELECT 1 FROM _migrations WHERE name = $2)
         ON CONFLICT (name) DO NOTHING`,
        [newName, oldName],
      );
    }

    for (const { name, sql } of MIGRATIONS) {
      const { rows } = await client.query(
        "SELECT 1 FROM _migrations WHERE name = $1",
        [name],
      );
      if (rows.length > 0) {
        console.log(`[db] migration already applied, skipping: ${name}`);
        continue;
      }

      // Apply the migration and record it atomically, so a crash between the
      // two can never leave an applied-but-unrecorded migration behind.
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
      console.log(`[db] migration applied: ${name}`);
    }
  } finally {
    client.release();
  }
}

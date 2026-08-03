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

const MIGRATIONS: { name: string; sql: string }[] = [
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

    for (const { name, sql } of MIGRATIONS) {
      const { rows } = await client.query(
        "SELECT 1 FROM _migrations WHERE name = $1",
        [name],
      );
      if (rows.length > 0) {
        console.log(`[db] migration already applied, skipping: ${name}`);
        continue;
      }

      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
      console.log(`[db] migration applied: ${name}`);
    }
  } finally {
    client.release();
  }
}

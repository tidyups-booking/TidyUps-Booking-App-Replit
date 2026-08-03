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
 * Every SQL block is idempotent — safe to execute on every startup.
 * Throws on the first failure so the process never starts with a broken schema.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const { name, sql } of MIGRATIONS) {
      await client.query(sql);
      console.log(`[db] migration applied: ${name}`);
    }
  } finally {
    client.release();
  }
}

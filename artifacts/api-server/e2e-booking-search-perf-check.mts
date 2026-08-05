/**
 * Perf regression check for booking search (GET /api/bookings?q= and
 * GET /api/bookings/customers/search).
 *
 * Booking search is index-backed via pg_trgm GIN indexes (migration 016).
 * A future ILIKE condition on a new column, or a changed expression, would
 * silently fall back to sequential scans as the bookings table grows.
 *
 * This script:
 *  1. Creates a scratch schema with a `bookings` table (LIKE public.bookings)
 *     and seeds it with 50,000 realistic rows.
 *  2. Applies migration 016 verbatim inside the scratch schema, so the scratch
 *     table has exactly the indexes production has — no more, no fewer.
 *  3. Builds the REAL search queries by importing the same condition builders
 *     the routes use (src/routes/bookingSearchConditions.ts), so any new
 *     search condition added to the routes is automatically covered here.
 *  4. Runs EXPLAIN (ANALYZE) for representative search terms and FAILS if
 *     any plan contains a Seq Scan on bookings, or execution exceeds the
 *     latency budget (default 100ms, override E2E_SEARCH_BUDGET_MS).
 *
 * Requirements: DATABASE_URL set (dev DB). The scratch schema is dropped on
 * exit; no rows are written to the real bookings table.
 * Run from artifacts/api-server:  pnpm exec tsx e2e-booking-search-perf-check.mts
 */
import { readFileSync } from "node:fs";
import { db, pool, bookingsTable } from "@workspace/db";
import {
  buildBookingSearchCondition,
  buildCustomerSearchQuery,
} from "./src/routes/bookingSearchConditions.js";

const SCHEMA = "booking_search_perf_scratch";
const ROWS = 50_000;
const BUDGET_MS = Number(process.env.E2E_SEARCH_BUDGET_MS ?? 100);
const MIGRATION = new URL(
  "../../lib/db/migrations/016_add_booking_search_trgm_indexes.sql",
  import.meta.url,
);

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// Inline drizzle's $N params into the SQL text so we can EXPLAIN it directly
// (EXPLAIN is a utility statement and can't take bind parameters).
function inlineParams(text: string, params: unknown[]): string {
  let out = text;
  for (let i = params.length; i >= 1; i--) {
    const v = params[i - 1];
    if (typeof v !== "string" && typeof v !== "number") {
      throw new Error(`unsupported param type at $${i}: ${typeof v}`);
    }
    const lit =
      typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
    out = out.replaceAll(`$${i}`, lit);
  }
  return out;
}

function findSeqScans(node: any, hits: string[] = []): string[] {
  if (node["Node Type"] === "Seq Scan") {
    hits.push(node["Relation Name"] ?? "?");
  }
  for (const child of node["Plans"] ?? []) findSeqScans(child, hits);
  return hits;
}

const client = await pool.connect();

async function explainCheck(label: string, query: { toSQL(): { sql: string; params: unknown[] } }) {
  const { sql: text, params } = query.toSQL();
  const stmt = `EXPLAIN (ANALYZE, FORMAT JSON) ${inlineParams(text, params)}`;
  // Run twice; judge the warm run so cold shared-buffer reads don't flake.
  await client.query(stmt);
  const res = await client.query(stmt);
  const [plan] = res.rows[0]["QUERY PLAN"];
  const execMs = plan["Execution Time"] as number;
  const seqScans = findSeqScans(plan["Plan"]);
  check(`${label}: no Seq Scan`, seqScans.length === 0, seqScans.length ? `Seq Scan on ${seqScans.join(", ")}` : undefined);
  check(`${label}: under ${BUDGET_MS}ms`, execMs <= BUDGET_MS, `${execMs.toFixed(1)}ms`);
}

try {
  console.log(`Seeding scratch schema ${SCHEMA} with ${ROWS} bookings…`);
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  // Unqualified "bookings" (what the routes' SQL uses) now resolves to the
  // scratch table; enum/extension types still resolve via public.
  await client.query(`SET search_path TO ${SCHEMA}, public`);
  await client.query(`CREATE TABLE bookings (LIKE public.bookings INCLUDING DEFAULTS)`);
  // LIKE doesn't copy the primary key; production has one, and the grouped
  // customers/search query joins back on id, so mirror it here.
  await client.query(`ALTER TABLE bookings ADD PRIMARY KEY (id)`);

  await client.query(`
    INSERT INTO bookings
      (first_name, last_name, phone, email, address, city, province,
       service_type, bedrooms, bathrooms, extras, scheduled_date,
       scheduled_time, frequency, status)
    SELECT
      (ARRAY['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda',
             'David','Elizabeth','William','Barbara','Richard','Susan','Joseph','Jessica'])[1 + g % 16],
      (ARRAY['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis',
             'Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas'])[1 + (g / 16) % 16],
      CASE WHEN g % 2 = 0
        THEN '(780) 5' || lpad((g % 100)::text, 2, '0') || '-' || lpad((g % 10000)::text, 4, '0')
        ELSE '7805' || lpad((g % 100)::text, 2, '0') || lpad((g % 10000)::text, 4, '0')
      END,
      'seed' || g || '@example.com',
      (100 + g % 9900)::text || ' ' ||
        (ARRAY['Maple','Oak','Birch','Cedar','Spruce','Aspen','Willow','Poplar'])[1 + g % 8] ||
        ' ' || (ARRAY['Street','Avenue','Crescent','Drive'])[1 + g % 4] || ' NW',
      (ARRAY['Edmonton','St. Albert','Sherwood Park','Leduc','Spruce Grove','Beaumont'])[1 + g % 6],
      'AB',
      'standard_clean',
      1 + g % 4,
      1 + g % 3,
      '{}',
      to_char(date '2026-01-01' + (g % 365), 'YYYY-MM-DD'),
      lpad((8 + g % 10)::text, 2, '0') || ':00',
      'one_time',
      'pending'
    FROM generate_series(1, ${ROWS}) AS g
  `);

  // Apply migration 016 VERBATIM — unqualified table name resolves to the
  // scratch table, so this stays in lockstep with production indexes.
  await client.query(readFileSync(MIGRATION, "utf8"));
  await client.query(`ANALYZE bookings`);
  console.log("Scratch table seeded and indexed; running EXPLAIN checks…\n");

  // Real GET /bookings?q= query shape: search condition + order + limit.
  const bookingSearch = (term: string) =>
    db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(buildBookingSearchCondition(term))
      .orderBy(bookingsTable.scheduledDate, bookingsTable.scheduledTime)
      .limit(50);

  // Real GET /bookings/customers/search query shape: grouped one-row-per-
  // customer aggregation with true booking counts (imported from the route's
  // own builder, so shape changes there are covered automatically).
  const customerSearch = (term: string) => buildCustomerSearchQuery(term);

  const terms: [string, string][] = [
    ["last-name term", "martinez"],
    ["full-name term", "mary johnson"],
    ["address term", "maple crescent"],
    ["city term", "sherwood"],
    ["digits-only phone term", "7805551"],
    ["formatted phone term", "(780) 555-01"],
    ["no-match term", "zzqqxxvv"],
  ];
  for (const [label, term] of terms) {
    await explainCheck(`bookings?q= ${label} ("${term}")`, bookingSearch(term));
    await explainCheck(`customers/search ${label} ("${term}")`, customerSearch(term));
  }
} finally {
  await client.query(`RESET search_path`).catch(() => {});
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  client.release();
  await pool.end();
  console.log("\nDropped scratch schema");
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All booking-search perf checks passed");

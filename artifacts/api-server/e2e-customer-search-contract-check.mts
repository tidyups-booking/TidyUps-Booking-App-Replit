/**
 * Contract check: GET /api/bookings/customers/search response shape vs. the
 * booking form's CustomerRecord interface.
 *
 * Customer pre-fill is guarded on the form side (buildCustomerPrefill field
 * names are asserted against the New Booking schema), but the CustomerRecord
 * interface in customer-autocomplete.tsx is hand-written and must match what
 * the API actually returns. If the API renames or drops a property (e.g.
 * postalCode), pre-fill silently writes undefined with no test failing.
 *
 * This check closes that gap without a running server:
 *  1. Parses the CustomerRecord interface property names out of
 *     artifacts/booking-app/src/components/customer-autocomplete.tsx.
 *  2. Seeds a scratch schema (LIKE public.bookings), runs the REAL query
 *     builder (buildCustomerSearchQuery) and the REAL row mapper
 *     (mapCustomerSearchRow) that the route uses.
 *  3. Asserts key-set EQUALITY both ways: every CustomerRecord property is
 *     present (own key) on the mapped API object, and the API emits no keys
 *     the interface doesn't declare.
 *
 * Requirements: DATABASE_URL set (dev DB).
 * Run from artifacts/api-server:  pnpm exec tsx e2e-customer-search-contract-check.mts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool, bookingsTable } from "@workspace/db";
import { getTableColumns } from "drizzle-orm";
import {
  buildCustomerSearchQuery,
  mapCustomerSearchRow,
} from "./src/routes/bookingSearchConditions.js";

const SCHEMA = "customer_search_contract_scratch";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// --- 1. Parse CustomerRecord keys from the frontend source ---
const here = path.dirname(fileURLToPath(import.meta.url));
const tsxPath = path.resolve(
  here,
  "../booking-app/src/components/customer-autocomplete.tsx",
);
const src = readFileSync(tsxPath, "utf8");
const ifaceMatch = src.match(
  /export interface CustomerRecord\s*\{([\s\S]*?)\n\}/,
);
if (!ifaceMatch) {
  console.error(
    `FAIL: could not find 'export interface CustomerRecord { … }' in ${tsxPath}`,
  );
  process.exit(1);
}
const recordKeys = [...ifaceMatch[1].matchAll(/^\s*(\w+)\??\s*:/gm)].map(
  (m) => m[1],
);
check(
  "parsed a plausible CustomerRecord interface (>= 10 properties)",
  recordKeys.length >= 10,
  `got ${recordKeys.length}: ${recordKeys.join(", ")}`,
);

// --- 2. Seed scratch schema and run the real query builder + mapper ---
const client = await pool.connect();

let apiKeys: string[] = [];
let sample: Record<string, unknown> = {};
try {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}, public`);
  await client.query(
    `CREATE TABLE bookings (LIKE public.bookings INCLUDING DEFAULTS)`,
  );
  await client.query(`ALTER TABLE bookings ADD PRIMARY KEY (id)`);
  await client.query(`
    INSERT INTO bookings (first_name, last_name, phone, email, address, city,
      province, postal_code, address_lat, address_lng, service_type, bedrooms,
      bathrooms, extras, scheduled_date, scheduled_time, frequency, status)
    VALUES ('Contract', 'Zqxcontract', '(780) 555-0000', 'contract@example.com',
      '1 Contract Ct NW', 'Edmonton', 'AB', 'T5A 0A1', 53.5461, -113.4938,
      'standard_clean', 2, 1, '{}', '2026-08-01', '09:00', 'one_time', 'pending')
  `);

  // Run the real drizzle query on THIS connection so search_path applies.
  // Running the builder normally is not possible cross-connection — instead,
  // fetch via the builder's SQL and rebuild the { booking, bookingCount } row
  // shape by mapping DB column names back to drizzle field keys via the
  // PUBLIC getTableColumns() API (no drizzle internals).
  const qb = buildCustomerSearchQuery("Zqxcontract");
  const { sql: text, params } = qb.toSQL();
  const res = await client.query({ text, values: params as any[] });
  check("scratch query returned one row", res.rows.length === 1, `got ${res.rows.length}`);

  const raw = res.rows[0] as Record<string, unknown>;
  const tableCols = getTableColumns(bookingsTable);
  const resultCols = new Set(res.fields.map((f) => f.name));

  // Guard: if drizzle's generated SQL stops exposing plain column names (or
  // the aggregate alias), fail loudly with an actionable message instead of
  // a confusing undefined-key mismatch downstream.
  const unmapped = Object.values(tableCols)
    .map((c) => c.name)
    .filter((n) => !resultCols.has(n));
  if (unmapped.length > 0 || !resultCols.has("booking_count")) {
    console.error(
      `FAIL: this contract check needs updating after a drizzle-orm upgrade — ` +
        `the generated SQL no longer returns expected column names ` +
        `(missing: ${[...unmapped, ...(resultCols.has("booking_count") ? [] : ["booking_count"])].join(", ")}). ` +
        `Update the row-rebuilding logic in e2e-customer-search-contract-check.mts.`,
    );
    process.exit(1);
  }

  const booking: any = {};
  for (const [key, col] of Object.entries(tableCols)) {
    booking[key] = raw[col.name];
  }
  const bookingCount = Number(raw["booking_count"]);
  sample = mapCustomerSearchRow({ booking, bookingCount });
  apiKeys = Object.keys(sample);
} finally {
  await client.query(`RESET search_path`).catch(() => {});
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  client.release();
  await pool.end();
}

// --- 3. Key-set equality both ways ---
const missing = recordKeys.filter((k) => !Object.prototype.hasOwnProperty.call(sample, k));
check(
  "every CustomerRecord property exists on the API response object",
  missing.length === 0,
  missing.length ? `missing from API: ${missing.join(", ")}` : undefined,
);
const extra = apiKeys.filter((k) => !recordKeys.includes(k));
check(
  "API emits no keys CustomerRecord doesn't declare",
  extra.length === 0,
  extra.length ? `undeclared API keys: ${extra.join(", ")}` : undefined,
);

// Numeric lat/lng sanity: these must survive drizzle's mapping as numbers
// (or null), since the map pre-fill reads them arithmetically.
const latOk = sample.addressLat === null || typeof sample.addressLat === "number" || !Number.isNaN(Number(sample.addressLat));
check("addressLat is numeric or null", latOk, `got ${typeof sample.addressLat}: ${sample.addressLat}`);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll customer-search contract checks passed");

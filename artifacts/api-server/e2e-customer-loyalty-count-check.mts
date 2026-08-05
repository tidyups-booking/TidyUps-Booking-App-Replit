/**
 * Functional check for the grouped customer autocomplete
 * (GET /api/bookings/customers/search → buildCustomerSearchQuery).
 *
 * The perf e2e proves the query plan is index-backed; this check proves the
 * grouping SEMANTICS: a repeat customer with many bookings under
 * differently-formatted phone numbers ("(780) 555-1234" vs "7805551234") must
 * collapse into ONE suggestion with the TRUE total booking count, and the
 * suggestion must carry the MOST RECENT booking's details for form pre-fill.
 * Also covers the no-phone fallback key (lowercased name+address).
 *
 * Like the perf check, it seeds a scratch schema (LIKE public.bookings) and
 * runs the REAL query builder the route uses against it — no rows are written
 * to the real bookings table, and the scratch schema is dropped on exit.
 *
 * Requirements: DATABASE_URL set (dev DB).
 * Run from artifacts/api-server:  pnpm exec tsx e2e-customer-loyalty-count-check.mts
 */
import { pool } from "@workspace/db";
import { buildCustomerSearchQuery } from "./src/routes/bookingSearchConditions.js";

const SCHEMA = "customer_loyalty_count_scratch";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const client = await pool.connect();

// Run the real drizzle query builder's SQL on THIS connection so the scratch
// search_path applies (drizzle's own db/pool would use other connections).
async function search(q: string): Promise<any[]> {
  const { sql: text, params } = buildCustomerSearchQuery(q).toSQL();
  const res = await client.query(text, params as any[]);
  return res.rows;
}

const baseCols = `(first_name, last_name, phone, email, address, city, province,
   service_type, bedrooms, bathrooms, extras, scheduled_date, scheduled_time,
   frequency, status)`;

try {
  console.log(`Seeding scratch schema ${SCHEMA}…`);
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}, public`);
  await client.query(`CREATE TABLE bookings (LIKE public.bookings INCLUDING DEFAULTS)`);
  await client.query(`ALTER TABLE bookings ADD PRIMARY KEY (id)`);

  // 1) Repeat customer "Loyalta Zqxrepeat": 60 bookings, phone stored in a
  //    different format on every other row but the SAME digits (7805551234).
  //    Addresses vary; the highest-id row is the "latest" booking and carries
  //    distinctive pre-fill details.
  await client.query(`
    INSERT INTO bookings ${baseCols}
    SELECT
      'Loyalta', 'Zqxrepeat',
      CASE WHEN g % 2 = 0 THEN '(780) 555-1234' ELSE '7805551234' END,
      'loyalta' || g || '@example.com',
      g || ' Older Address Way NW', 'Edmonton', 'AB',
      'standard_clean', 2, 1, '{}',
      to_char(date '2026-01-01' + g, 'YYYY-MM-DD'), '09:00',
      'one_time', 'completed'
    FROM generate_series(1, 59) AS g
  `);
  await client.query(`
    INSERT INTO bookings ${baseCols} VALUES
      ('Loyalta', 'Zqxrepeat', '780-555-1234', 'loyalta-latest@example.com',
       '999 Latest Address Blvd NW', 'St. Albert', 'AB',
       'deep_clean', 4, 3, '{}', '2026-08-01', '13:00', 'weekly', 'pending')
  `);

  // 2) No-phone customer "Nophone Zqxwalkin", keyed by name+address: 3 bookings.
  await client.query(`
    INSERT INTO bookings ${baseCols}
    SELECT
      'Nophone', 'Zqxwalkin', '', 'walkin@example.com',
      '77 Walkin Street NW', 'Edmonton', 'AB',
      'standard_clean', 1, 1, '{}',
      to_char(date '2026-03-01' + g, 'YYYY-MM-DD'), '10:00',
      'one_time', 'completed'
    FROM generate_series(1, 3) AS g
  `);
  // 2b) Same name, DIFFERENT address, no phone — must be a separate customer.
  await client.query(`
    INSERT INTO bookings ${baseCols} VALUES
      ('Nophone', 'Zqxwalkin', '', 'other@example.com',
       '500 Different Road SW', 'Leduc', 'AB',
       'standard_clean', 1, 1, '{}', '2026-04-01', '10:00', 'one_time', 'pending')
  `);

  // 3) Noise: unrelated customer who must not merge with anyone.
  await client.query(`
    INSERT INTO bookings ${baseCols} VALUES
      ('Random', 'Zqxother', '(403) 555-9999', 'other2@example.com',
       '1 Noise Ave', 'Calgary', 'AB',
       'standard_clean', 1, 1, '{}', '2026-05-01', '11:00', 'one_time', 'pending')
  `);
  console.log("Seeded; running grouped-search checks…\n");

  // --- Repeat customer: searched by name ---
  let rows = await search("Zqxrepeat");
  check("name search: exactly one suggestion for repeat customer", rows.length === 1, `got ${rows.length}`);
  const r = rows[0];
  check("true total booking count is 60 (mixed phone formats merged)", r?.booking_count === 60, `got ${r?.booking_count}`);
  check("latest booking's address returned for pre-fill", r?.address === "999 Latest Address Blvd NW", `got ${r?.address}`);
  check("latest booking's service details returned", r?.service_type === "deep_clean" && r?.bedrooms === 4 && r?.bathrooms === 3, `got ${r?.service_type}/${r?.bedrooms}/${r?.bathrooms}`);
  check("latest booking's city/frequency returned", r?.city === "St. Albert" && r?.frequency === "weekly", `got ${r?.city}/${r?.frequency}`);
  check("latest booking's date returned", r?.scheduled_date === "2026-08-01", `got ${r?.scheduled_date}`);

  // --- Repeat customer: searched by digits-only phone ---
  rows = await search("7805551234");
  check("digits-only phone search: one suggestion", rows.length === 1, `got ${rows.length}`);
  check("digits-only phone search: count is 60", rows[0]?.booking_count === 60, `got ${rows[0]?.booking_count}`);

  // --- Repeat customer: searched by formatted phone ---
  rows = await search("(780) 555-1234");
  check("formatted phone search: one suggestion", rows.length === 1, `got ${rows.length}`);
  check("formatted phone search: count is 60", rows[0]?.booking_count === 60, `got ${rows[0]?.booking_count}`);

  // --- No-phone customers: keyed by name+address, not collapsed together ---
  rows = await search("Zqxwalkin");
  check("no-phone customers: two suggestions (distinct addresses)", rows.length === 2, `got ${rows.length}`);
  const walkin = rows.find((x) => x.address === "77 Walkin Street NW");
  const other = rows.find((x) => x.address === "500 Different Road SW");
  check("no-phone repeat customer count is 3", walkin?.booking_count === 3, `got ${walkin?.booking_count}`);
  check("same-name different-address customer stays separate (count 1)", other?.booking_count === 1, `got ${other?.booking_count}`);

  // --- Noise customer untouched ---
  rows = await search("Zqxother");
  check("unrelated customer: one suggestion, count 1", rows.length === 1 && rows[0]?.booking_count === 1, `got ${rows.length}/${rows[0]?.booking_count}`);
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
console.log("All customer loyalty-count checks passed");

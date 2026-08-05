/**
 * e2e: geocode backfill for upcoming bookings.
 *
 * Verifies that runGeocodeBackfill():
 *  1. geocodes an upcoming booking with a real address and persists coords;
 *  2. skips unresolvable addresses WITHOUT blocking later rows (skip list);
 *  3. never rescans skipped rows within the same process.
 *
 * Run: cd artifacts/api-server && pnpm exec tsx e2e-geocode-backfill-check.mts
 * (Uses the dev database and the real Google Geocoding API — a handful of
 * lookups per run.)
 */
import { inArray } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";
import {
  runGeocodeBackfill,
  _skippedIdsForTest,
} from "./src/services/geocodeBackfill.js";
import { geocodeToCoords } from "./src/services/geocode.js";

const UNRESOLVABLE_CITY = "Zzzzqqvillexx";
/**
 * Google resolves almost anything to SOME approximate location, so the
 * unresolvable path is exercised deterministically: rows in the marker city
 * fail, everything else goes through the real Google-backed geocoder.
 */
const testGeocode: typeof geocodeToCoords = (addr, city, province, postal) =>
  city === UNRESOLVABLE_CITY
    ? Promise.resolve(null)
    : geocodeToCoords(addr, city, province, postal);

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const marker = `geocode-backfill-e2e-${Date.now()}`;
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
  .toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });

const base = {
  firstName: "Backfill",
  lastName: marker,
  phone: "780-555-0000",
  email: "backfill-e2e@example.com",
  city: "Edmonton",
  province: "AB",
  serviceType: "standard_clean" as const,
  scheduledDate: tomorrow,
  scheduledTime: "10:00",
};

const ids: number[] = [];
try {
  // Two unresolvable rows FIRST (lower ids → selected first) then a valid one,
  // so the test proves the skip list lets the valid row through.
  const inserted = await db
    .insert(bookingsTable)
    .values([
      { ...base, address: "Zzqqxx 00000 Nonexistent Xyzzy Way", city: UNRESOLVABLE_CITY },
      { ...base, address: "Qqzzyy 99999 Unresolvable Plugh Blvd", city: UNRESOLVABLE_CITY },
      { ...base, address: "10060 Jasper Avenue NW" },
    ])
    .returning({ id: bookingsTable.id });
  ids.push(...inserted.map((r) => r.id));
  const [badA, badB, good] = ids;
  console.log(`Inserted test bookings: bad=${badA},${badB} good=${good}`);

  const run1 = await runGeocodeBackfill(testGeocode);
  console.log(`run1: ${JSON.stringify(run1)}`);

  const rows = await db
    .select({
      id: bookingsTable.id,
      lat: bookingsTable.addressLat,
      lng: bookingsTable.addressLng,
    })
    .from(bookingsTable)
    .where(inArray(bookingsTable.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));

  check(
    "valid address got stored coordinates despite bad rows ahead of it",
    byId.get(good)?.lat != null && byId.get(good)?.lng != null,
    `lat=${byId.get(good)?.lat} lng=${byId.get(good)?.lng}`
  );
  check(
    "coords are in the Edmonton area",
    Math.abs((byId.get(good)?.lat ?? 0) - 53.54) < 0.3 &&
      Math.abs((byId.get(good)?.lng ?? 0) + 113.49) < 0.5
  );
  check(
    "unresolvable addresses stayed without coords",
    byId.get(badA)?.lat == null && byId.get(badB)?.lat == null
  );
  const skipped = _skippedIdsForTest();
  check(
    "unresolvable rows are on the skip list",
    skipped.has(badA) && skipped.has(badB),
    `skiplist size=${skipped.size}`
  );

  const before = skipped.size;
  const run2 = await runGeocodeBackfill(testGeocode);
  check(
    "second run does not rescan skipped rows (skip list stable)",
    _skippedIdsForTest().size === before,
    `run2=${JSON.stringify(run2)}`
  );
} finally {
  if (ids.length > 0) {
    await db.delete(bookingsTable).where(inArray(bookingsTable.id, ids));
    console.log(`Cleanup: removed ${ids.length} test booking(s)`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
process.exit(0);

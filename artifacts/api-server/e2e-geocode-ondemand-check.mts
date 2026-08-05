/**
 * e2e: on-demand geocode for older/past bookings (schedule search mini map).
 *
 * The upcoming-only backfill never fills coords for past bookings, so the
 * schedule search geocodes the selected result on demand via
 * geocodeBookingOnDemand(). Verifies:
 *  1. a past booking without coords gets geocoded and persisted;
 *  2. a booking that already has coords is returned as-is WITHOUT calling
 *     the geocoder (no change, no Google spend);
 *  3. an unresolvable address reports "unresolvable" and stores nothing
 *     (stub geocoder — Google resolves almost anything, so ZERO_RESULTS is
 *     exercised deterministically);
 *  4. the conditional write refuses stale coords when the address changed
 *     mid-lookup;
 *  5. a missing booking id reports "not_found".
 *
 * Run: cd artifacts/api-server && pnpm exec tsx e2e-geocode-ondemand-check.mts
 * (Uses the dev database; the geocoder is fully stubbed — no Google calls.)
 */
import { eq, inArray } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";
import { geocodeBookingOnDemand } from "./src/services/geocodeBackfill.js";
import type { geocodeToCoords } from "./src/services/geocode.js";

const STUB_COORDS = { lat: 53.5461, lng: -113.4938 }; // Edmonton
const UNRESOLVABLE_CITY = "Zzzzqqvillexx";

let geocodeCalls = 0;
const stubGeocode: typeof geocodeToCoords = async (_addr, city) => {
  geocodeCalls++;
  return city === UNRESOLVABLE_CITY ? null : STUB_COORDS;
};

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const marker = `geocode-ondemand-e2e-${Date.now()}`;
// A date safely in the past — exactly the rows the backfill never touches.
const pastDate = new Date(Date.now() - 90 * 24 * 3600 * 1000)
  .toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });

const base = {
  firstName: "OnDemand",
  lastName: marker,
  phone: "780-555-0001",
  email: "ondemand-e2e@example.com",
  city: "Edmonton",
  province: "AB",
  serviceType: "standard_clean" as const,
  scheduledDate: pastDate,
  scheduledTime: "10:00",
};

const ids: number[] = [];
try {
  const inserted = await db
    .insert(bookingsTable)
    .values([
      { ...base, address: "10060 Jasper Avenue NW" }, // past, no coords
      { ...base, address: "1 Existing Way", addressLat: 51.05, addressLng: -114.07 }, // has coords
      { ...base, address: "Zzqqxx 00000 Nonexistent Xyzzy Way", city: UNRESOLVABLE_CITY },
      { ...base, address: "5 Race Condition Rd" }, // address edited mid-lookup
    ])
    .returning({ id: bookingsTable.id });
  ids.push(...inserted.map((r) => r.id));
  const [past, existing, bad, raced] = ids;
  console.log(`Inserted test bookings: past=${past} existing=${existing} bad=${bad} raced=${raced}`);

  // 1. Past booking without coords gets geocoded + persisted
  const r1 = await geocodeBookingOnDemand(past, stubGeocode);
  check(
    "past booking geocoded on demand",
    r1.status === "ok" && r1.lat === STUB_COORDS.lat && r1.lng === STUB_COORDS.lng,
    JSON.stringify(r1)
  );
  const [row1] = await db
    .select({ lat: bookingsTable.addressLat, lng: bookingsTable.addressLng })
    .from(bookingsTable)
    .where(eq(bookingsTable.id, past));
  check(
    "coords persisted to the booking row",
    row1?.lat === STUB_COORDS.lat && row1?.lng === STUB_COORDS.lng,
    `lat=${row1?.lat} lng=${row1?.lng}`
  );

  // 2. Booking with existing coords: returned as-is, geocoder NOT called
  const callsBefore = geocodeCalls;
  const r2 = await geocodeBookingOnDemand(existing, stubGeocode);
  check(
    "existing coords returned unchanged",
    r2.status === "ok" && r2.lat === 51.05 && r2.lng === -114.07,
    JSON.stringify(r2)
  );
  check("geocoder not called for booking with coords", geocodeCalls === callsBefore);
  const [row2] = await db
    .select({ lat: bookingsTable.addressLat, lng: bookingsTable.addressLng })
    .from(bookingsTable)
    .where(eq(bookingsTable.id, existing));
  check(
    "stored coords untouched",
    row2?.lat === 51.05 && row2?.lng === -114.07
  );

  // 3. Unresolvable address (stubbed ZERO_RESULTS): reported, nothing stored
  const r3 = await geocodeBookingOnDemand(bad, stubGeocode);
  check("unresolvable address reported", r3.status === "unresolvable", JSON.stringify(r3));
  const [row3] = await db
    .select({ lat: bookingsTable.addressLat })
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bad));
  check("unresolvable booking stayed without coords", row3?.lat == null);

  // 4. Conditional write: address changed mid-lookup → no stale coords stored
  const racingGeocode: typeof geocodeToCoords = async (...args) => {
    // Simulate a dispatcher editing the address while Google is resolving
    await db
      .update(bookingsTable)
      .set({ address: "6 Edited After Lookup Ave" })
      .where(eq(bookingsTable.id, raced));
    return stubGeocode(...args);
  };
  const r4 = await geocodeBookingOnDemand(raced, racingGeocode);
  check(
    "mid-lookup edit still returns coords for display",
    r4.status === "ok",
    JSON.stringify(r4)
  );
  const [row4] = await db
    .select({ lat: bookingsTable.addressLat })
    .from(bookingsTable)
    .where(eq(bookingsTable.id, raced));
  check(
    "stale coords NOT persisted after address edit",
    row4?.lat == null,
    `lat=${row4?.lat}`
  );

  // 5. Missing booking id
  const r5 = await geocodeBookingOnDemand(999999999, stubGeocode);
  check("missing booking reports not_found", r5.status === "not_found", JSON.stringify(r5));
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

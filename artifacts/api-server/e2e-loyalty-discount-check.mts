/**
 * E2E verification for task: loyalty discount only appears for true repeat
 * customers on the Edit Booking page.
 *
 * The edit page's eligibility effect (booking-detail.tsx) marks a customer
 * loyalty-eligible when GET /api/bookings/customers/search?q=<phone digits>
 * returns a customer whose phone digits match exactly and bookingCount > 1.
 *
 * This script inserts temporary bookings, calls the endpoint as a dispatcher,
 * and re-implements the client's eligibility rule to assert:
 *   1. single-booking customer  → bookingCount = 1 → NOT eligible
 *   2. repeat customer (2 bookings) → bookingCount = 2 → eligible
 *   3. shared phone across two "different" names → counted together (count 2)
 *   4. blank phone booking → client short-circuits (digits < 7) → not eligible,
 *      and server keys blank-phone rows by name+address (no cross-count bleed)
 *   5. formatting differences in stored phone still match by digits
 * Cleanup removes all inserted rows.
 *
 * Requirements: dev API server running, CLERK_SECRET_KEY set.
 */
import { inArray } from "drizzle-orm";
import { db, bookingsTable, dispatcherAllowlistTable } from "@workspace/db";

const API_BASE = process.env.E2E_API_BASE ?? "http://127.0.0.1:8080/api";
const CLERK_API = "https://api.clerk.com";
const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error("FAIL: CLERK_SECRET_KEY is not set");
  process.exit(1);
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function clerk(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Clerk ${init?.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function mintToken(userId: string): Promise<string> {
  const session = await clerk(`/v1/sessions`, { method: "POST", body: JSON.stringify({ user_id: userId }) });
  const token = await clerk(`/v1/sessions/${session.id}/tokens`, { method: "POST", body: JSON.stringify({}) });
  return token.jwt;
}

// Act as an existing dispatcher.
const allowlist = await db.select().from(dispatcherAllowlistTable);
if (allowlist.length === 0) {
  console.error("FAIL: dispatcher_allowlist is empty — no dispatcher to act as");
  process.exit(1);
}
const jwt = await mintToken(allowlist[0].clerkUserId);

async function search(q: string): Promise<any[]> {
  const res = await fetch(`${API_BASE}/bookings/customers/search?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`search '${q}' → ${res.status}`);
  const data = await res.json();
  return data.customers ?? [];
}

// Client-side eligibility rule, mirrored from booking-detail.tsx.
function clientEligible(bookingPhone: string, customers: any[]): boolean {
  const digits = (bookingPhone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return false;
  const match = customers.find((c) => (c.phone ?? "").replace(/\D/g, "") === digits);
  return !!match && (match.bookingCount ?? 1) > 1;
}

// Distinctive fake data unlikely to collide with real rows.
const P_SINGLE = "7805550171";   // one booking only
const P_REPEAT = "7805550172";   // two bookings
const P_SHARED = "7805550173";   // same phone, two different names
const baseRow = {
  address: "9999 Loyalty Test Ave NW",
  city: "Edmonton",
  province: "AB",
  serviceType: "standard_clean" as const,
  bedrooms: 2,
  bathrooms: 1,
  extras: [] as string[],
  scheduledDate: "2026-09-01",
  scheduledTime: "09:00",
  frequency: "one_time" as const,
  status: "pending" as const,
};

const inserted = await db
  .insert(bookingsTable)
  .values([
    { ...baseRow, firstName: "LoyalSingle", lastName: "E2ECheck", phone: "(780) 555-0171" },
    { ...baseRow, firstName: "LoyalRepeat", lastName: "E2ECheck", phone: "780-555-0172" },
    { ...baseRow, firstName: "LoyalRepeat", lastName: "E2ECheck", phone: "7805550172", scheduledDate: "2026-09-08" },
    { ...baseRow, firstName: "SharedOne", lastName: "E2ECheck", phone: "7805550173" },
    { ...baseRow, firstName: "SharedTwo", lastName: "E2ECheckB", phone: "(780) 555-0173", address: "1 Other St" },
    { ...baseRow, firstName: "BlankPhone", lastName: "E2ECheck", phone: "" },
    { ...baseRow, firstName: "BlankPhoneTwo", lastName: "E2ECheckB", phone: "", address: "2 Other St" },
  ])
  .returning({ id: bookingsTable.id });
const ids = inserted.map((r) => r.id);
console.log(`Inserted test bookings: ${ids.join(", ")}`);

try {
  // 1. Single-booking customer: bookingCount 1, not eligible
  let cs = await search(P_SINGLE);
  const single = cs.find((c) => (c.phone ?? "").replace(/\D/g, "") === P_SINGLE);
  check("single-booking customer has bookingCount 1", single?.bookingCount === 1, `count=${single?.bookingCount}`);
  check("single-booking customer NOT eligible", !clientEligible("(780) 555-0171", cs));

  // 2. Repeat customer: bookingCount 2, eligible; phone formats normalize
  cs = await search(P_REPEAT);
  const repeat = cs.find((c) => (c.phone ?? "").replace(/\D/g, "") === P_REPEAT);
  check("repeat customer has bookingCount 2 (formats normalized)", repeat?.bookingCount === 2, `count=${repeat?.bookingCount}`);
  check("repeat customer IS eligible", clientEligible("780-555-0172", cs));

  // 3. Shared phone across two names: keyed by phone → single entry, count 2
  cs = await search(P_SHARED);
  const sharedEntries = cs.filter((c) => (c.phone ?? "").replace(/\D/g, "") === P_SHARED);
  check("shared phone collapses to one customer entry", sharedEntries.length === 1, `entries=${sharedEntries.length}`);
  check("shared phone bookingCount 2 (counted together)", sharedEntries[0]?.bookingCount === 2, `count=${sharedEntries[0]?.bookingCount}`);

  // 4. Blank phone: client never queries (digits < 7) → not eligible
  check("blank phone booking NOT eligible (client short-circuit)", !clientEligible("", []));
  // Server side: blank-phone rows keyed by name+address — two different blank-phone
  // customers must not be merged/counted together
  cs = await search("BlankPhone");
  const blank1 = cs.find((c) => c.firstName === "BlankPhone");
  const blank2 = cs.find((c) => c.firstName === "BlankPhoneTwo");
  check("blank-phone customers not merged", !!blank1 && !!blank2, `found=${cs.map((c) => c.firstName).join(",")}`);
  check("blank-phone customer counts stay at 1", blank1?.bookingCount === 1 && blank2?.bookingCount === 1,
    `counts=${blank1?.bookingCount},${blank2?.bookingCount}`);

  // 5. Sub-7-digit phone on the booking: client never fetches
  check("short phone (<7 digits) NOT eligible", !clientEligible("555-01", []));
} finally {
  await db.delete(bookingsTable).where(inArray(bookingsTable.id, ids));
  console.log("Cleaned up test bookings");
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

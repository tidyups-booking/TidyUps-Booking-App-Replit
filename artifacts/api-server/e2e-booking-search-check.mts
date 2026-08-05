/**
 * E2E verification for server-side booking search (GET /api/bookings?q=).
 *
 * Inserts distinctive temporary bookings, calls the endpoint as a dispatcher,
 * and asserts:
 *   1. q matches address (case-insensitive substring)
 *   2. q matches city
 *   3. q matches first/last/full client name
 *   4. q matches phone, including digits-only vs formatted storage
 *   5. q composes with the status filter
 *   6. limit is capped at 200 even when a larger limit is requested
 *   7. offset pagination returns disjoint pages
 * Cleanup removes all inserted rows.
 *
 * Requirements: dev API server running, CLERK_SECRET_KEY set.
 * Run: npx tsx e2e-booking-search-check.mts  (from artifacts/api-server)
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

const allowlist = await db.select().from(dispatcherAllowlistTable);
if (allowlist.length === 0) {
  console.error("FAIL: dispatcher_allowlist is empty — no dispatcher to act as");
  process.exit(1);
}
const jwt = await mintToken(allowlist[0].clerkUserId);

async function list(params: Record<string, string>): Promise<any[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/bookings?${qs}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`GET /bookings?${qs} → ${res.status}`);
  return res.json();
}

const baseRow = {
  city: "Edmonton",
  province: "AB",
  serviceType: "standard_clean" as const,
  bedrooms: 2,
  bathrooms: 1,
  extras: [] as string[],
  scheduledDate: "2026-09-15",
  scheduledTime: "09:00",
  frequency: "one_time" as const,
  status: "pending" as const,
};

const inserted = await db
  .insert(bookingsTable)
  .values([
    { ...baseRow, firstName: "Searchy", lastName: "AddrMatch", phone: "7805550181", address: "4242 Zqxwv Crescent NW" },
    { ...baseRow, firstName: "Searchy", lastName: "CityMatch", phone: "7805550182", address: "1 Plain St", city: "Zqxwvville" },
    { ...baseRow, firstName: "Zqxwvina", lastName: "NameMatch", phone: "7805550183", address: "2 Plain St" },
    { ...baseRow, firstName: "Searchy", lastName: "PhoneMatch", phone: "(780) 555-0184", address: "3 Plain St" },
    { ...baseRow, firstName: "Searchy", lastName: "StatusMatch", phone: "7805550185", address: "5 Zqxwv Way", status: "completed" as const },
  ])
  .returning({ id: bookingsTable.id });
const ids = inserted.map((r) => r.id);
console.log(`Inserted test bookings: ${ids.join(", ")}`);
const idSet = new Set(ids);
const mine = (rows: any[]) => rows.filter((r) => idSet.has(r.id));

try {
  // 1. address substring, case-insensitive
  let rows = mine(await list({ q: "zqxwv cres" }));
  check("address search matches (case-insensitive)", rows.length === 1 && rows[0].lastName === "AddrMatch", `got ${rows.length}`);

  // 2. city
  rows = mine(await list({ q: "Zqxwvville" }));
  check("city search matches", rows.length === 1 && rows[0].lastName === "CityMatch", `got ${rows.length}`);

  // 3. name: last, and full "first last"
  rows = mine(await list({ q: "zqxwvina namematch" }));
  check("full-name search matches", rows.length === 1 && rows[0].firstName === "Zqxwvina", `got ${rows.length}`);
  rows = mine(await list({ q: "NameMatch" }));
  check("last-name search matches", rows.length === 1, `got ${rows.length}`);

  // 4. phone digits vs formatted storage
  rows = mine(await list({ q: "7805550184" }));
  check("digits-only search finds formatted phone", rows.length === 1 && rows[0].lastName === "PhoneMatch", `got ${rows.length}`);
  rows = mine(await list({ q: "(780) 555-0181" }));
  check("formatted search finds digits-only phone", rows.length === 1 && rows[0].lastName === "AddrMatch", `got ${rows.length}`);

  // 5. q composes with status filter
  rows = mine(await list({ q: "Zqxwv", status: "completed" }));
  check("q + status filter compose", rows.length === 1 && rows[0].lastName === "StatusMatch", `got ${rows.length}`);

  // 6. limit cap
  const capped = await list({ limit: "5000" });
  check("limit capped at 200", capped.length <= 200, `got ${capped.length}`);

  // 7. offset pagination disjoint
  const page1 = await list({ limit: "2", offset: "0" });
  const page2 = await list({ limit: "2", offset: "2" });
  const overlap = page1.filter((a) => page2.some((b) => b.id === a.id));
  check("offset pages are disjoint", overlap.length === 0, `overlap=${overlap.length}`);
} finally {
  await db.delete(bookingsTable).where(inArray(bookingsTable.id, ids));
  console.log("Cleaned up test bookings");
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All booking-search checks passed");

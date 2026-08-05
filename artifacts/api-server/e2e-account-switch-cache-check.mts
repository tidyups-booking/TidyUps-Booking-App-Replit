/**
 * Regression check: a shared phone must never show the previous cleaner's
 * data after switching accounts (cleaner-app React Query cache scoping).
 *
 * Two client-side defenses landed and must never regress:
 *   1. useMapData scopes its cache key to the signed-in Clerk user:
 *      ['map-data', userId, date]  (artifacts/cleaner-app/hooks/useMapData.ts)
 *   2. Sign-out clears the entire React Query cache before the next user can
 *      sign in (artifacts/cleaner-app/app/(home)/profile.tsx).
 *   3. schedule.tsx must NOT override the generated per-endpoint query keys —
 *      the generated hooks use `options.query.queryKey ?? <generated key>`,
 *      so any override (even `[]`) collapses distinct queries into one shared
 *      cache entry.
 *
 * This check has two layers:
 *   A. Source-level guards: greps the three cleaner-app files for the exact
 *      defenses above, so a refactor that silently drops them fails CI.
 *   B. Behavioral simulation: drives a real @tanstack/react-query QueryClient
 *      (the same library and key builders the app uses) through the full
 *      account-switch flow against the live dev API with two real Clerk test
 *      users, A and B, each linked to a temporary staff record:
 *        - sign in as A, load schedule + map into the cache (A has a marker
 *          booking so the cached data is identifiable),
 *        - verify B-scoped keys are empty even BEFORE sign-out (key scoping),
 *        - sign out (queryClient.clear() exactly like profile.tsx) and verify
 *          the cache is completely empty,
 *        - sign in as B while "offline" (fetches fail) and verify no query
 *          ever surfaces A's data,
 *        - go online as B and verify B's fetched schedule doesn't contain
 *          A's booking and no A-scoped key re-appeared.
 *
 * Requirements: dev API server on port 8080, CLERK_SECRET_KEY set.
 * Run: pnpm exec tsx e2e-account-switch-cache-check.mts  (from artifacts/api-server)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db, staffTable, bookingsTable, dispatcherAllowlistTable } from "@workspace/db";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetStaffScheduleQueryKey,
  getGetDayScheduleQueryKey,
  getGetStaffMeQueryKey,
} from "@workspace/api-client-react";

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

// ---------------------------------------------------------------------------
// A. Source-level guards — the defenses must stay in the cleaner-app source.

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../cleaner-app");
const read = (rel: string) => readFileSync(path.join(appDir, rel), "utf8");

console.log("Source-level guards:");
{
  const mapSrc = read("hooks/useMapData.ts");
  check(
    "useMapData cache key is scoped to the Clerk userId",
    /queryKey:\s*\[\s*['"]map-data['"]\s*,\s*userId\s*,/.test(mapSrc),
  );
  check(
    "useMapData query is disabled until a user is signed in",
    /enabled:\s*!!userId/.test(mapSrc),
  );

  const profileSrc = read("app/(home)/profile.tsx");
  const signOutIdx = profileSrc.indexOf("await signOut()");
  const clearIdx = profileSrc.indexOf("queryClient.clear()");
  check(
    "profile sign-out clears the whole React Query cache after signOut",
    signOutIdx !== -1 && clearIdx !== -1 && clearIdx > signOutIdx,
    `signOut@${signOutIdx} clear@${clearIdx}`,
  );

  const scheduleSrc = read("app/(home)/schedule.tsx");
  check(
    "schedule.tsx does not override the generated query keys",
    !/queryKey\s*:/.test(scheduleSrc),
    "a queryKey override replaces the URL-scoped key (generated hooks use `?? default`)",
  );

  // Per-user state held OUTSIDE React Query must also reset on account switch.
  const staffCtxSrc = read("context/StaffContext.tsx");
  check(
    "StaffContext drops the cached /staff/me record when the Clerk userId changes",
    /removeQueries\(\s*\{\s*queryKey:\s*getGetStaffMeQueryKey\(\)/.test(staffCtxSrc) &&
      staffCtxSrc.includes("prevUserIdRef"),
    "removeQueries(getGetStaffMeQueryKey()) on userId change is required",
  );
  check(
    "StaffContext disables /staff/me and masks data without a signed-in user",
    /enabled:\s*!!userId/.test(staffCtxSrc) && /userChanged\s*\?\s*undefined\s*:\s*data/.test(staffCtxSrc),
  );

  const locCtxSrc = read("context/LocationContext.tsx");
  const clearedBranch = locCtxSrc.match(/if\s*\(!staffId\)\s*\{[\s\S]*?\}/)?.[0] ?? "";
  check(
    "LocationContext resets status AND lastUpdate when staffId clears",
    clearedBranch.includes("setStatus('idle')") && clearedBranch.includes("setLastUpdate(null)"),
    "both setStatus('idle') and setLastUpdate(null) must run in the !staffId branch",
  );
}

// ---------------------------------------------------------------------------
// B. Behavioral simulation with two real Clerk users against the live API.

async function clerk(p: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${CLERK_API}${p}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Clerk ${init?.method ?? "GET"} ${p} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function ensureTestUser(email: string, firstName: string): Promise<string> {
  const existing = await clerk(`/v1/users?email_address=${encodeURIComponent(email)}`);
  if (Array.isArray(existing) && existing.length > 0) return existing[0].id;
  const created = await clerk(`/v1/users`, {
    method: "POST",
    body: JSON.stringify({
      email_address: [email],
      first_name: firstName,
      last_name: "AccountSwitch E2E",
      skip_password_requirement: true,
    }),
  });
  return created.id;
}

async function mintToken(userId: string): Promise<string> {
  const session = await clerk(`/v1/sessions`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
  const token = await clerk(`/v1/sessions/${session.id}/tokens`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return token.jwt;
}

/** The app's fetcher, reduced to what matters: URL + bearer token → JSON. */
async function apiJson(p: string, jwt: string): Promise<any> {
  const res = await fetch(`${API_BASE}${p}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`GET ${p} → ${res.status}`);
  return res.json();
}

/** Same shape as useMapData's key. Source guard above pins the real one. */
const mapDataKey = (userId: string, date: string) => ["map-data", userId, date];

const EMAIL_A = "account-switch-a+clerk_test@example.com";
const EMAIL_B = "account-switch-b+clerk_test@example.com";
const MARKER = "AccountSwitchMarker";
const today = new Date().toISOString().slice(0, 10);

console.log("\nBehavioral simulation:");
const userA = await ensureTestUser(EMAIL_A, "UserA");
const userB = await ensureTestUser(EMAIL_B, "UserB");
console.log(`User A: ${userA}  User B: ${userB}`);

// Neither test user may be a dispatcher (they must behave as cleaners).
await db
  .delete(dispatcherAllowlistTable)
  .where(inArray(dispatcherAllowlistTable.clerkUserId, [userA, userB]));

const createdStaffIds: number[] = [];
let markerBookingId: number | null = null;

async function ensureStaff(clerkUserId: string, name: string): Promise<number> {
  const existing = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(eq(staffTable.clerkUserId, clerkUserId));
  if (existing.length > 0) return existing[0].id;
  const [row] = await db
    .insert(staffTable)
    .values({ name, role: "cleaner", clerkUserId })
    .returning({ id: staffTable.id });
  createdStaffIds.push(row.id);
  return row.id;
}

try {
  const staffA = await ensureStaff(userA, "AccountSwitch A");
  const staffB = await ensureStaff(userB, "AccountSwitch B");

  // Marker booking assigned to A today, so A's cached schedule is identifiable.
  const [marker] = await db
    .insert(bookingsTable)
    .values({
      firstName: MARKER,
      lastName: "Customer",
      phone: "555-0000",
      address: "1 Marker Way",
      city: "Calgary",
      serviceType: "standard_clean",
      scheduledDate: today,
      scheduledTime: "09:00",
      staffId: staffA,
    })
    .returning({ id: bookingsTable.id });
  markerBookingId = marker.id;

  const jwtA = await mintToken(userA);

  // --- User A signs in and loads schedule + map (exactly the app's keys) ---
  const queryClient = new QueryClient();
  const keysA = {
    map: mapDataKey(userA, today),
    mySchedule: getGetStaffScheduleQueryKey(staffA, { date: today }),
    daySchedule: getGetDayScheduleQueryKey({ date: today }),
    staffMe: getGetStaffMeQueryKey(),
  };

  await queryClient.fetchQuery({
    queryKey: keysA.map,
    queryFn: () => apiJson(`/map/data?date=${today}`, jwtA),
  });
  await queryClient.fetchQuery({
    queryKey: keysA.mySchedule,
    queryFn: () => apiJson(`/staff/${staffA}/schedule?date=${today}`, jwtA),
  });
  await queryClient.fetchQuery({
    queryKey: keysA.daySchedule,
    queryFn: () => apiJson(`/schedule?date=${today}`, jwtA),
  });
  await queryClient.fetchQuery({
    queryKey: keysA.staffMe,
    queryFn: () => apiJson(`/staff/me`, jwtA),
  });

  const aSchedule = queryClient.getQueryData<any[]>(keysA.mySchedule);
  check(
    "A's cached schedule contains A's marker booking",
    Array.isArray(aSchedule) && aSchedule.some((b) => b.firstName === MARKER),
  );
  const aMap = queryClient.getQueryData<any>(keysA.map);
  check("A's cached map data is present", aMap != null && Array.isArray(aMap.bookings));

  // --- Key scoping: even BEFORE sign-out, B-scoped keys must be empty ------
  check(
    "B's map-data key is empty while A is signed in (user-scoped key)",
    queryClient.getQueryData(mapDataKey(userB, today)) === undefined,
  );
  check(
    "B's own-schedule key is empty while A is signed in (staff-scoped key)",
    queryClient.getQueryData(getGetStaffScheduleQueryKey(staffB, { date: today })) === undefined,
  );

  // --- Sign out: profile.tsx does queryClient.clear() ----------------------
  queryClient.clear();
  const remaining = queryClient.getQueryCache().getAll();
  check(
    "sign-out clear() leaves ZERO cached queries (schedule, day schedule, map, staff/me)",
    remaining.length === 0,
    `${remaining.length} queries remain`,
  );

  // --- User B signs in while OFFLINE: every first fetch fails --------------
  const keysB = {
    map: mapDataKey(userB, today),
    mySchedule: getGetStaffScheduleQueryKey(staffB, { date: today }),
    daySchedule: getGetDayScheduleQueryKey({ date: today }),
  };
  const offline = () => Promise.reject(new Error("network unreachable (simulated offline)"));
  for (const key of Object.values(keysB)) {
    await queryClient
      .fetchQuery({ queryKey: key as any, queryFn: offline, retry: false })
      .catch(() => {});
  }
  const leakedOffline = queryClient
    .getQueryCache()
    .getAll()
    .filter((q) => JSON.stringify(q.state.data ?? null).includes(MARKER));
  check(
    "offline B sees no data at all — never A's cached marker booking",
    Object.values(keysB).every((k) => queryClient.getQueryData(k as any) === undefined) &&
      leakedOffline.length === 0,
    `${leakedOffline.length} leaked entries`,
  );

  // --- B goes online: real fetches under B's identity ----------------------
  const jwtB = await mintToken(userB);
  const bSchedule = await queryClient.fetchQuery({
    queryKey: keysB.mySchedule,
    queryFn: () => apiJson(`/staff/${staffB}/schedule?date=${today}`, jwtB),
  });
  check(
    "B's fetched schedule does NOT contain A's marker booking",
    Array.isArray(bSchedule) && !bSchedule.some((b: any) => b.firstName === MARKER),
  );
  await queryClient.fetchQuery({
    queryKey: keysB.map,
    queryFn: () => apiJson(`/map/data?date=${today}`, jwtB),
  });
  // After B is fully signed in, no A-scoped key may have data.
  check(
    "no A-scoped cache key re-appeared after B signed in",
    Object.values(keysA).every((k) => queryClient.getQueryData(k as any) === undefined),
  );

  // Server-side boundary: B must not be able to read A's schedule directly.
  const cross = await fetch(`${API_BASE}/staff/${staffA}/schedule?date=${today}`, {
    headers: { Authorization: `Bearer ${jwtB}` },
  });
  check(
    "B gets 403 fetching A's schedule endpoint directly",
    cross.status === 403,
    `status=${cross.status}`,
  );
} finally {
  if (markerBookingId !== null) {
    await db.delete(bookingsTable).where(eq(bookingsTable.id, markerBookingId));
  }
  if (createdStaffIds.length > 0) {
    await db.delete(staffTable).where(inArray(staffTable.id, createdStaffIds));
  }
  const strayBookings = await db
    .select({ id: bookingsTable.id })
    .from(bookingsTable)
    .where(eq(bookingsTable.firstName, MARKER));
  check("temporary marker booking cleaned up", strayBookings.length === 0);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

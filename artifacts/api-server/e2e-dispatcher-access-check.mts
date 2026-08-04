/**
 * End-to-end regression check for dispatcher access management
 * (routes/dispatchers.ts + lib/callerRole.ts).
 *
 * Runs the same flow that was verified manually: creates/reuses a
 * +clerk_test Clerk user, mints real session tokens via the Clerk backend
 * API, and exercises /api/dispatchers on the running dev server:
 *   - 403 before grant
 *   - 201 on grant
 *   - 200 after grant
 *   - 403 after revoke
 *   - 409 when removing the last dispatcher
 *
 * It also verifies the cleaner role boundary: a +clerk_test user linked to a
 * temporary staff record gets 403 on all dispatcher-only routes (dispatcher
 * management, staff admin, full schedule, Jobber/Twilio config) but 200 on
 * their own schedule endpoint. The temporary staff record is removed after.
 *
 * Cleanup: the allowlist is snapshotted up-front and restored in `finally`,
 * so the table always returns to its prior state (owner can't be locked out).
 *
 * Requirements: dev API server running on port 8080, CLERK_SECRET_KEY set.
 * Run: npx tsx e2e-dispatcher-access-check.mts  (from artifacts/api-server)
 */
import { eq, inArray } from "drizzle-orm";
import { db, dispatcherAllowlistTable, staffTable, contactMessagesTable } from "@workspace/db";

const API_BASE = process.env.E2E_API_BASE ?? "http://127.0.0.1:8080/api";
const CLERK_API = "https://api.clerk.com";
const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error("FAIL: CLERK_SECRET_KEY is not set");
  process.exit(1);
}

const TEST_EMAIL = "dispatcher-e2e+clerk_test@example.com";

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
  if (!res.ok) {
    throw new Error(`Clerk ${init?.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

/** Create or reuse the +clerk_test user and return its Clerk user ID. */
async function ensureTestUser(): Promise<string> {
  const existing = await clerk(`/v1/users?email_address=${encodeURIComponent(TEST_EMAIL)}`);
  if (Array.isArray(existing) && existing.length > 0) return existing[0].id;
  const created = await clerk(`/v1/users`, {
    method: "POST",
    body: JSON.stringify({
      email_address: [TEST_EMAIL],
      first_name: "Dispatcher",
      last_name: "E2E Check",
      skip_password_requirement: true,
    }),
  });
  return created.id;
}

/** Mint a fresh session JWT for a user via the Clerk backend API. */
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

async function api(method: string, path: string, jwt: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res;
}

// ---------------------------------------------------------------------------

// Snapshot the allowlist so we can always restore it, no matter what fails.
const snapshot = await db.select().from(dispatcherAllowlistTable);
if (snapshot.length === 0) {
  console.error("FAIL: dispatcher_allowlist is empty — cannot run (no dispatcher to act as)");
  process.exit(1);
}

const testUserId = await ensureTestUser();
console.log(`Test Clerk user: ${testUserId} (${TEST_EMAIL})`);

// Pick an existing dispatcher (not the test user) to act as the admin caller.
const admin = snapshot.find((r) => r.clerkUserId !== testUserId);
if (!admin) {
  console.error("FAIL: the only dispatcher is the test user — refusing to run");
  process.exit(1);
}

try {
  // Make sure the test user starts outside the allowlist.
  await db
    .delete(dispatcherAllowlistTable)
    .where(eq(dispatcherAllowlistTable.clerkUserId, testUserId));

  const adminJwt = await mintToken(admin.clerkUserId);
  let testJwt = await mintToken(testUserId);

  // 1. 403 before grant
  const before = await api("GET", "/dispatchers", testJwt);
  check("403 before grant", before.status === 403, `status=${before.status}`);

  // 2. 201 on grant (by an existing dispatcher)
  const grant = await api("POST", "/dispatchers", adminJwt, { clerkUserId: testUserId });
  check("201 on grant", grant.status === 201, `status=${grant.status}`);

  // 3. 200 after grant (fresh token — session tokens expire in ~60s)
  testJwt = await mintToken(testUserId);
  const after = await api("GET", "/dispatchers", testJwt);
  check("200 after grant", after.status === 200, `status=${after.status}`);
  if (after.status === 200) {
    const list = await after.json();
    check(
      "granted user appears in dispatcher list",
      Array.isArray(list) && list.some((d: any) => d.clerkUserId === testUserId),
    );
  }

  // 4. revoke, then 403
  const revoke = await api("DELETE", `/dispatchers/${testUserId}`, adminJwt);
  check("revoke succeeds", revoke.status === 200, `status=${revoke.status}`);
  testJwt = await mintToken(testUserId);
  const afterRevoke = await api("GET", "/dispatchers", testJwt);
  check("403 after revoke", afterRevoke.status === 403, `status=${afterRevoke.status}`);

  // 5. 409 when removing the last dispatcher.
  // Make the test user the ONLY dispatcher (real rows are restored in finally),
  // then have them try to remove themselves — the guard must refuse.
  await db.delete(dispatcherAllowlistTable);
  await db.insert(dispatcherAllowlistTable).values({ clerkUserId: testUserId });
  testJwt = await mintToken(testUserId);
  const last = await api("DELETE", `/dispatchers/${testUserId}`, testJwt);
  check("409 removing the last dispatcher", last.status === 409, `status=${last.status}`);
  const stillThere = await db
    .select()
    .from(dispatcherAllowlistTable)
    .where(eq(dispatcherAllowlistTable.clerkUserId, testUserId));
  check("last dispatcher row was NOT deleted", stillThere.length === 1);
} finally {
  // Restore the allowlist exactly as it was before the run.
  await db.delete(dispatcherAllowlistTable);
  if (snapshot.length > 0) {
    await db.insert(dispatcherAllowlistTable).values(snapshot).onConflictDoNothing();
  }
  const restored = await db.select().from(dispatcherAllowlistTable);
  const restoredIds = new Set(restored.map((r) => r.clerkUserId));
  const ok =
    restored.length === snapshot.length &&
    snapshot.every((r) => restoredIds.has(r.clerkUserId)) &&
    !(!snapshot.some((r) => r.clerkUserId === testUserId) && restoredIds.has(testUserId));
  check("allowlist restored to prior state", ok);
}

// ---------------------------------------------------------------------------
// Cleaner role boundary: a Clerk user linked to a staff record must get 403 on
// dispatcher-only routes, but 200 on their own schedule endpoint.

const CLEANER_EMAIL = "cleaner-e2e+clerk_test@example.com";

async function ensureCleanerTestUser(): Promise<string> {
  const existing = await clerk(`/v1/users?email_address=${encodeURIComponent(CLEANER_EMAIL)}`);
  if (Array.isArray(existing) && existing.length > 0) return existing[0].id;
  const created = await clerk(`/v1/users`, {
    method: "POST",
    body: JSON.stringify({
      email_address: [CLEANER_EMAIL],
      first_name: "Cleaner",
      last_name: "E2E Check",
      skip_password_requirement: true,
    }),
  });
  return created.id;
}

const cleanerUserId = await ensureCleanerTestUser();
console.log(`\nCleaner test Clerk user: ${cleanerUserId} (${CLEANER_EMAIL})`);

let tempStaffId: number | null = null;
try {
  // The cleaner must NOT be a dispatcher.
  await db
    .delete(dispatcherAllowlistTable)
    .where(eq(dispatcherAllowlistTable.clerkUserId, cleanerUserId));

  // Link (or reuse) a temporary staff record for this Clerk user.
  const existingStaff = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(eq(staffTable.clerkUserId, cleanerUserId));
  let staffId: number;
  if (existingStaff.length > 0) {
    staffId = existingStaff[0].id;
  } else {
    const [row] = await db
      .insert(staffTable)
      .values({ name: "Cleaner E2E Check", role: "cleaner", clerkUserId: cleanerUserId })
      .returning({ id: staffTable.id });
    staffId = row.id;
    tempStaffId = staffId; // only delete rows we created
  }

  const cleanerJwt = await mintToken(cleanerUserId);

  // Dispatcher-only routes must all return 403 for a cleaner.
  const dispatcherOnly: [string, string][] = [
    ["GET", "/dispatchers"],
    ["GET", "/dispatchers/clerk-users"],
    ["POST", "/dispatchers"],
    ["GET", "/dispatchers/invites"],
    ["POST", "/dispatchers/invites"],
    ["DELETE", "/dispatchers/invites/1"],
    ["GET", "/staff"],
    ["POST", "/staff"],
    ["GET", "/schedule?date=2026-01-01"],
    ["GET", "/jobber/auth"],
    ["GET", "/twilio/webhook-url"],
    ["GET", "/contact/messages"],
    ["PATCH", "/contact/messages/1"],
    ["DELETE", "/contact/messages/1"],
  ];
  for (const [method, path] of dispatcherOnly) {
    const res = await api(
      method,
      path,
      cleanerJwt,
      method === "POST" ? {} : method === "PATCH" ? { handled: true } : undefined,
    );
    check(`cleaner gets 403 on ${method} ${path}`, res.status === 403, `status=${res.status}`);
  }

  // But the cleaner CAN read their own schedule.
  const today = new Date().toISOString().slice(0, 10);
  const own = await api("GET", `/staff/${staffId}/schedule?date=${today}`, cleanerJwt);
  check("cleaner gets 200 on own schedule", own.status === 200, `status=${own.status}`);

  // And NOT another staff member's schedule.
  const other = await api("GET", `/staff/${staffId + 999999}/schedule?date=${today}`, cleanerJwt);
  check(
    "cleaner gets 403 on another staff member's schedule",
    other.status === 403,
    `status=${other.status}`,
  );
} finally {
  if (tempStaffId !== null) {
    await db.delete(staffTable).where(eq(staffTable.id, tempStaffId));
    const leftover = await db
      .select({ id: staffTable.id })
      .from(staffTable)
      .where(eq(staffTable.id, tempStaffId));
    check("temporary staff record cleaned up", leftover.length === 0);
  }
}

// ---------------------------------------------------------------------------
// Contact-messages inbox: unauthenticated → 401, dispatcher → 200/204.
// (Non-dispatcher 403 is covered by the cleaner section above.)

console.log("\nContact messages inbox:");
{
  // Unauthenticated requests must get 401 (requireAuth middleware).
  const unauthChecks: [string, string][] = [
    ["GET", "/contact/messages"],
    ["PATCH", "/contact/messages/1"],
    ["DELETE", "/contact/messages/1"],
  ];
  for (const [method, path] of unauthChecks) {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "PATCH" ? JSON.stringify({ handled: true }) : undefined,
    });
    check(`unauthenticated gets 401 on ${method} ${path}`, res.status === 401, `status=${res.status}`);
  }

  // A dispatcher can list, mark handled, and delete. Use a temporary message
  // so the run doesn't touch real visitor data; DELETE removes it.
  const [msg] = await db
    .insert(contactMessagesTable)
    .values({
      name: "E2E Inbox Check",
      email: "e2e-inbox-check@example.com",
      message: "temporary message created by e2e-dispatcher-access-check",
    })
    .returning({ id: contactMessagesTable.id });
  try {
    const dispatcherJwt = await mintToken(admin.clerkUserId);

    const list = await api("GET", "/contact/messages", dispatcherJwt);
    check("dispatcher gets 200 on GET /contact/messages", list.status === 200, `status=${list.status}`);
    if (list.status === 200) {
      const page = await list.json();
      check(
        "temporary message appears in the list",
        Array.isArray(page?.messages) && page.messages.some((r: any) => r.id === msg.id),
      );
    }

    const patch = await api("PATCH", `/contact/messages/${msg.id}`, dispatcherJwt, { handled: true });
    check("dispatcher gets 200 on PATCH mark-handled", patch.status === 200, `status=${patch.status}`);
    if (patch.status === 200) {
      const updated = await patch.json();
      check("PATCH sets handledAt", updated.handledAt != null);
    }

    const del = await api("DELETE", `/contact/messages/${msg.id}`, dispatcherJwt);
    check("dispatcher gets 204 on DELETE", del.status === 204, `status=${del.status}`);

    const gone = await api("DELETE", `/contact/messages/${msg.id}`, dispatcherJwt);
    check("deleting a missing message returns 404", gone.status === 404, `status=${gone.status}`);
  } finally {
    // Belt-and-braces cleanup in case an assertion failed before DELETE ran.
    await db.delete(contactMessagesTable).where(eq(contactMessagesTable.id, msg.id));
  }
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

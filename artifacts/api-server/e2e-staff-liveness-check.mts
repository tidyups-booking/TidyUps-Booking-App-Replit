/**
 * End-to-end check for the Staff page's card indicators.
 *
 * GET /api/staff/liveness (routes/staff.ts) — the "Live" dot feed:
 *   - 401 unauthenticated
 *   - 403 for a cleaner (staff-linked account, not a dispatcher)
 *   - 200 for a dispatcher
 *   - a staff member with a fresh GPS ping (< 5 min) reports isLive=true
 *   - a staff member with a stale ping (> 5 min) reports isLive=false
 *
 * GET /api/dispatchers verifiedEmails contract — the "Add to Dispatch" state:
 *   - inviting a SECONDARY verified address of an existing account grants
 *     access immediately (mode "granted")
 *   - the dispatcher list then exposes that secondary address in
 *     verifiedEmails, so the staff card can show the Dispatcher badge instead
 *     of offering "Add to Dispatch" again (which would 409)
 *
 * Temp staff/location/allowlist rows are created up-front and removed in
 * `finally`; +clerk_test users are reused across runs.
 *
 * Requirements: dev API server running on port 8080, CLERK_SECRET_KEY set.
 * Run: npx tsx e2e-staff-liveness-check.mts  (from artifacts/api-server)
 */
import { eq, inArray } from "drizzle-orm";
import { db, dispatcherAllowlistTable, staffTable, cleanerLocationsTable } from "@workspace/db";

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
  if (!res.ok) {
    throw new Error(`Clerk ${init?.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
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

/** Create or reuse a +clerk_test user with the given addresses (first = primary). */
async function ensureTestUser(emails: string[], firstName: string): Promise<string> {
  const existing = await clerk(`/v1/users?email_address=${encodeURIComponent(emails[0])}`);
  if (Array.isArray(existing) && existing.length > 0) {
    const user = existing[0];
    // Make sure every wanted address exists (verified) on the reused account.
    const have = new Set(
      (user.email_addresses ?? []).map((e: any) => e.email_address.toLowerCase()),
    );
    for (const email of emails) {
      if (!have.has(email.toLowerCase())) {
        await clerk(`/v1/email_addresses`, {
          method: "POST",
          body: JSON.stringify({ user_id: user.id, email_address: email, verified: true }),
        });
      }
    }
    return user.id;
  }
  const created = await clerk(`/v1/users`, {
    method: "POST",
    body: JSON.stringify({
      email_address: emails,
      first_name: firstName,
      last_name: "E2E Check",
      skip_password_requirement: true,
    }),
  });
  return created.id;
}

// ---------------------------------------------------------------------------

// Act as an existing dispatcher (read-only against the allowlist).
const allowlist = await db.select().from(dispatcherAllowlistTable);
if (allowlist.length === 0) {
  console.error("FAIL: dispatcher_allowlist is empty — cannot run (no dispatcher to act as)");
  process.exit(1);
}
const admin = allowlist[0];

// Temp staff rows: one with a fresh ping, one with a stale ping.
const [freshStaff] = await db
  .insert(staffTable)
  .values({ name: "Liveness E2E Fresh", role: "cleaner", active: true })
  .returning();
const [staleStaff] = await db
  .insert(staffTable)
  .values({ name: "Liveness E2E Stale", role: "cleaner", active: true })
  .returning();
const tempStaffIds = [freshStaff.id, staleStaff.id];

try {
  await db.insert(cleanerLocationsTable).values([
    { staffId: freshStaff.id, lat: 53.5, lng: -113.5, accuracy: 10, updatedAt: new Date() },
    {
      staffId: staleStaff.id,
      lat: 53.5,
      lng: -113.5,
      accuracy: 10,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago — stale
    },
  ]);

  // 1. 401 unauthenticated
  const anon = await fetch(`${API_BASE}/staff/liveness`);
  check("401 unauthenticated", anon.status === 401, `status=${anon.status}`);

  // 2. 403 for a cleaner — a staff-linked account must not see team liveness
  const cleanerUserId = await ensureTestUser(
    ["staff-liveness-cleaner+clerk_test@example.com"],
    "Liveness Cleaner",
  );
  // Defensive: make sure the cleaner test user isn't allowlisted, then link it
  await db
    .delete(dispatcherAllowlistTable)
    .where(eq(dispatcherAllowlistTable.clerkUserId, cleanerUserId));
  await db
    .update(staffTable)
    .set({ clerkUserId: cleanerUserId })
    .where(eq(staffTable.id, freshStaff.id));
  const cleanerJwt = await mintToken(cleanerUserId);
  const asCleaner = await fetch(`${API_BASE}/staff/liveness`, {
    headers: { Authorization: `Bearer ${cleanerJwt}` },
  });
  check("403 for cleaner", asCleaner.status === 403, `status=${asCleaner.status}`);

  // 3. 200 for a dispatcher, with correct isLive flags
  const jwt = await mintToken(admin.clerkUserId);
  const res = await fetch(`${API_BASE}/staff/liveness`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  check("200 for dispatcher", res.status === 200, `status=${res.status}`);

  const rows: { staffId: number; lastSeen: string; isLive: boolean }[] = await res.json();
  check("response is an array", Array.isArray(rows));

  const fresh = rows.find((r) => r.staffId === freshStaff.id);
  const stale = rows.find((r) => r.staffId === staleStaff.id);
  check("fresh ping present", !!fresh);
  check("fresh ping isLive=true", fresh?.isLive === true, JSON.stringify(fresh));
  check("fresh ping has lastSeen", !!fresh?.lastSeen && !isNaN(new Date(fresh.lastSeen).getTime()));
  check("stale ping present", !!stale);
  check("stale ping isLive=false", stale?.isLive === false, JSON.stringify(stale));

  // 4. Secondary-verified-email grant + verifiedEmails status contract
  const PRIMARY = "dispatch-secondary-e2e+clerk_test@example.com";
  const SECONDARY = "dispatch-secondary-alt+clerk_test@example.com";
  const secUserId = await ensureTestUser([PRIMARY, SECONDARY], "Dispatch Secondary");
  // Start outside the allowlist so the invite takes the "granted" path
  await db
    .delete(dispatcherAllowlistTable)
    .where(eq(dispatcherAllowlistTable.clerkUserId, secUserId));

  try {
    const adminJwt2 = await mintToken(admin.clerkUserId);
    const inviteRes = await fetch(`${API_BASE}/dispatchers/invites`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt2}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dispatch Secondary E2E", email: SECONDARY }),
    });
    const inviteBody = await inviteRes.json().catch(() => null);
    check(
      "inviting a secondary verified email grants immediately",
      inviteRes.status === 201 && inviteBody?.mode === "granted",
      `status=${inviteRes.status} body=${JSON.stringify(inviteBody)}`,
    );

    const adminJwt3 = await mintToken(admin.clerkUserId);
    const listRes = await fetch(`${API_BASE}/dispatchers`, {
      headers: { Authorization: `Bearer ${adminJwt3}` },
    });
    check("dispatcher list 200", listRes.status === 200, `status=${listRes.status}`);
    const dispatchers: {
      clerkUserId: string;
      email: string | null;
      verifiedEmails?: string[];
    }[] = await listRes.json();
    const row = dispatchers.find((d) => d.clerkUserId === secUserId);
    check("granted user appears in dispatcher list", !!row);
    check(
      "verifiedEmails includes the secondary address (staff-card match key)",
      !!row?.verifiedEmails?.includes(SECONDARY.toLowerCase()),
      JSON.stringify(row?.verifiedEmails),
    );
    check(
      "verifiedEmails includes the primary address too",
      !!row?.verifiedEmails?.includes(PRIMARY.toLowerCase()),
      JSON.stringify(row?.verifiedEmails),
    );
  } finally {
    await db
      .delete(dispatcherAllowlistTable)
      .where(eq(dispatcherAllowlistTable.clerkUserId, secUserId));
  }
} finally {
  await db.delete(cleanerLocationsTable).where(inArray(cleanerLocationsTable.staffId, tempStaffIds));
  await db.delete(staffTable).where(inArray(staffTable.id, tempStaffIds));
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

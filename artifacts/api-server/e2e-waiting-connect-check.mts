/**
 * e2e check: "Waiting to connect" dispatcher feature.
 *
 * Verifies over real HTTP (dev server on 8080) that:
 *  1. GET /staff/unlinked-signups lists a fresh cleaner-app signup
 *  2. +clerk_test accounts are excluded from the list
 *  3. POST /staff/:id/connect-account links the account and stores its email
 *  4. The signup disappears from the list afterwards
 *  5. The connected cleaner's GET /staff/me works immediately
 *  6. Connecting an already-linked account elsewhere → 409
 *  7. Non-dispatchers get 403 on both endpoints
 *
 * Run from artifacts/api-server:  pnpm exec tsx e2e-waiting-connect-check.mts
 */
const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error("CLERK_SECRET_KEY missing");
  process.exit(1);
}
const CLERK_API = "https://api.clerk.com";
const API_BASE = process.env.E2E_API_BASE ?? "http://127.0.0.1:8080/api";

const { eq, inArray } = await import("drizzle-orm");
const { db, staffTable, dispatcherAllowlistTable } = await import("@workspace/db");

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

async function ensureUser(email: string, firstName: string): Promise<string> {
  const existing = await clerk(`/v1/users?email_address=${encodeURIComponent(email)}`);
  if (Array.isArray(existing) && existing.length > 0) return existing[0].id;
  const created = await clerk(`/v1/users`, {
    method: "POST",
    body: JSON.stringify({
      email_address: [email],
      first_name: firstName,
      last_name: "E2E Check",
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
  const token = await clerk(`/v1/sessions/${session.id}/tokens`, { method: "POST" });
  return token.jwt;
}

async function api(path: string, jwt: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// NOTE: signup emails must NOT contain +clerk_test — the endpoint filters
// those out on purpose. They are deleted in cleanup.
const SIGNUP_EMAIL = "waiting-connect-signup-e2e@example.com";
const RACE_EMAIL = "waiting-connect-race-e2e@example.com";
const INACTIVE_EMAIL = "waiting-connect-inactive-e2e@example.com";
const TESTFILTER_EMAIL = "waiting-connect-filtered-e2e+clerk_test@example.com";
const DISPATCHER_EMAIL = "waiting-connect-dispatcher-e2e+clerk_test@example.com";

console.log("Setting up Clerk test users...");
const [signupId, raceId, inactiveId, testFilterId, dispatcherId] = await Promise.all([
  ensureUser(SIGNUP_EMAIL, "Waiting"),
  ensureUser(RACE_EMAIL, "Race"),
  ensureUser(INACTIVE_EMAIL, "InactiveMatch"),
  ensureUser(TESTFILTER_EMAIL, "Filtered"),
  ensureUser(DISPATCHER_EMAIL, "Dispatcher"),
]);
const signupIds = [signupId, raceId, inactiveId];
console.log(`signup=${signupId} race=${raceId} inactive=${inactiveId} filtered=${testFilterId} dispatcher=${dispatcherId}\n`);

const staffIds: number[] = [];
try {
  // Clean start: signup users must not be linked anywhere
  for (const id of signupIds) {
    await db.update(staffTable).set({ clerkUserId: null }).where(eq(staffTable.clerkUserId, id));
  }
  await db
    .insert(dispatcherAllowlistTable)
    .values({ clerkUserId: dispatcherId })
    .onConflictDoNothing();

  const [staffA] = await db
    .insert(staffTable)
    .values({ name: "Waiting Connect A (e2e)", role: "cleaner", active: true })
    .returning({ id: staffTable.id });
  const [staffB] = await db
    .insert(staffTable)
    .values({ name: "Waiting Connect B (e2e)", role: "cleaner", active: true })
    .returning({ id: staffTable.id });
  const [staffC] = await db
    .insert(staffTable)
    .values({ name: "Waiting Connect C (e2e)", role: "cleaner", active: true })
    .returning({ id: staffTable.id });
  // Inactive row whose email matches INACTIVE_EMAIL — auto-connect ignores
  // inactive rows, so that signup must still show in the waiting list.
  const [staffD] = await db
    .insert(staffTable)
    .values({
      name: "Waiting Connect D inactive (e2e)",
      role: "cleaner",
      active: false,
      email: INACTIVE_EMAIL,
    })
    .returning({ id: staffTable.id });
  staffIds.push(staffA.id, staffB.id, staffC.id, staffD.id);

  const dispatcherJwt = await mintToken(dispatcherId);

  // 1 + 2: list contains the real signup, excludes the +clerk_test user
  const list1 = await api("/staff/unlinked-signups", dispatcherJwt);
  check("list returns 200", list1.status === 200, `status=${list1.status}`);
  const emails1 = Array.isArray(list1.body) ? list1.body.map((s: any) => s.email) : [];
  check("fresh signup appears in list", emails1.includes(SIGNUP_EMAIL), JSON.stringify(emails1));
  check(
    "+clerk_test accounts are excluded",
    !emails1.some((e: string) => e.includes("+clerk_test")),
  );
  check(
    "signup matching only an INACTIVE staff email still listed",
    emails1.includes(INACTIVE_EMAIL),
  );

  // 3: connect the signup to staff A
  const conn = await api(`/staff/${staffA.id}/connect-account`, dispatcherJwt, {
    method: "POST",
    body: JSON.stringify({ clerkUserId: signupId }),
  });
  check("connect-account returns 200", conn.status === 200, `status=${conn.status} body=${JSON.stringify(conn.body)}`);
  check(
    "response has clerkUserId + email set",
    conn.body?.clerkUserId === signupId && conn.body?.email === SIGNUP_EMAIL,
  );
  const [rowA] = await db.select().from(staffTable).where(eq(staffTable.id, staffA.id));
  check("DB row linked with email", rowA?.clerkUserId === signupId && rowA?.email === SIGNUP_EMAIL);

  // 4: signup no longer listed
  const list2 = await api("/staff/unlinked-signups", dispatcherJwt);
  const emails2 = Array.isArray(list2.body) ? list2.body.map((s: any) => s.email) : [];
  check("connected signup disappears from list", !emails2.includes(SIGNUP_EMAIL));

  // 5: cleaner's /staff/me works immediately
  const cleanerJwt = await mintToken(signupId);
  const me = await api("/staff/me", cleanerJwt);
  check(
    "cleaner /staff/me works right after connect",
    me.status === 200 && me.body?.id === staffA.id,
    `status=${me.status} id=${me.body?.id}`,
  );

  // 6: connecting the same account to staff B → 409
  const conn2 = await api(`/staff/${staffB.id}/connect-account`, dispatcherJwt, {
    method: "POST",
    body: JSON.stringify({ clerkUserId: signupId }),
  });
  check("double-connect rejected with 409", conn2.status === 409, `status=${conn2.status}`);

  // 6b: two SIMULTANEOUS connects of the same account to different staff rows
  // → exactly one wins, the loser gets a clean 409 (unique-violation mapping)
  const [raceB, raceC] = await Promise.all([
    api(`/staff/${staffB.id}/connect-account`, dispatcherJwt, {
      method: "POST",
      body: JSON.stringify({ clerkUserId: raceId }),
    }),
    api(`/staff/${staffC.id}/connect-account`, dispatcherJwt, {
      method: "POST",
      body: JSON.stringify({ clerkUserId: raceId }),
    }),
  ]);
  const raceStatuses = [raceB.status, raceC.status].sort();
  check(
    "parallel connect race: one 200, one 409",
    raceStatuses[0] === 200 && raceStatuses[1] === 409,
    `statuses=${raceB.status},${raceC.status}`,
  );
  const raceRows = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(eq(staffTable.clerkUserId, raceId));
  check("race account linked to exactly one staff row", raceRows.length === 1);

  // 7: non-dispatcher (the cleaner) gets 403 on both endpoints
  const forbidden1 = await api("/staff/unlinked-signups", cleanerJwt);
  const forbidden2 = await api(`/staff/${staffB.id}/connect-account`, cleanerJwt, {
    method: "POST",
    body: JSON.stringify({ clerkUserId: testFilterId }),
  });
  check(
    "non-dispatcher gets 403 on both endpoints",
    forbidden1.status === 403 && forbidden2.status === 403,
    `list=${forbidden1.status} connect=${forbidden2.status}`,
  );
} finally {
  console.log("\nCleaning up...");
  if (staffIds.length > 0) {
    await db.delete(staffTable).where(inArray(staffTable.id, staffIds));
  }
  await db
    .delete(dispatcherAllowlistTable)
    .where(eq(dispatcherAllowlistTable.clerkUserId, dispatcherId));
  // Delete the non-test-email signup users entirely so they never linger
  for (const id of signupIds) {
    await clerk(`/v1/users/${id}`, { method: "DELETE" }).catch(() => {});
  }
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

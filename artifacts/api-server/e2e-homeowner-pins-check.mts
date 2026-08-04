/**
 * e2e check: Homeowner pins on the Live Map.
 *
 * Verifies over real HTTP (dev server on 8080) that:
 *  1. GET /map/pins lists pins (dispatcher only)
 *  2. POST /map/pins saves a pin and returns it
 *  3. Validation: missing name → 400, bad lat/lng → 400
 *  4. DELETE /map/pins/:id removes the pin; deleting again → 404
 *  5. Non-dispatchers get 403 on all three endpoints
 *
 * Run from artifacts/api-server:  pnpm exec tsx e2e-homeowner-pins-check.mts
 */
const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error("CLERK_SECRET_KEY missing");
  process.exit(1);
}
const CLERK_API = "https://api.clerk.com";
const API_BASE = process.env.E2E_API_BASE ?? "http://127.0.0.1:8080/api";

const { eq } = await import("drizzle-orm");
const { db, dispatcherAllowlistTable, homeownerPinsTable } = await import("@workspace/db");

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

const DISPATCHER_EMAIL = "homeowner-pins-dispatcher-e2e+clerk_test@example.com";
const CLEANER_EMAIL = "homeowner-pins-cleaner-e2e+clerk_test@example.com";
const PIN_NAME = "Pins E2E Test Home";

console.log("Setting up Clerk test users...");
const [dispatcherId, cleanerId] = await Promise.all([
  ensureUser(DISPATCHER_EMAIL, "PinsDispatcher"),
  ensureUser(CLEANER_EMAIL, "PinsCleaner"),
]);
console.log(`dispatcher=${dispatcherId} cleaner=${cleanerId}\n`);

const createdPinIds: number[] = [];
try {
  await db
    .insert(dispatcherAllowlistTable)
    .values({ clerkUserId: dispatcherId })
    .onConflictDoNothing();

  const [dispatcherJwt, cleanerJwt] = await Promise.all([
    mintToken(dispatcherId),
    mintToken(cleanerId),
  ]);

  // 1. List works for dispatcher
  const list0 = await api("/map/pins", dispatcherJwt);
  check("GET /map/pins → 200 array", list0.status === 200 && Array.isArray(list0.body), `status=${list0.status}`);

  // 2. Create a pin
  const create = await api("/map/pins", dispatcherJwt, {
    method: "POST",
    body: JSON.stringify({ name: PIN_NAME, address: "123 Test St, Calgary", lat: 51.0447, lng: -114.0719 }),
  });
  check(
    "POST /map/pins → 201 with row",
    create.status === 201 && create.body?.name === PIN_NAME && create.body?.lat === 51.0447,
    `status=${create.status} body=${JSON.stringify(create.body)}`,
  );
  if (create.body?.id) createdPinIds.push(create.body.id);

  // Pin appears in list
  const list1 = await api("/map/pins", dispatcherJwt);
  check(
    "created pin appears in list",
    list1.status === 200 && list1.body.some((p: any) => p.id === create.body?.id),
  );

  // 3. Validation
  const noName = await api("/map/pins", dispatcherJwt, {
    method: "POST",
    body: JSON.stringify({ name: "   ", lat: 51, lng: -114 }),
  });
  check("blank name → 400", noName.status === 400, `status=${noName.status}`);

  const badLat = await api("/map/pins", dispatcherJwt, {
    method: "POST",
    body: JSON.stringify({ name: "Bad", lat: 123, lng: -114 }),
  });
  check("lat out of range → 400", badLat.status === 400, `status=${badLat.status}`);

  const strLng = await api("/map/pins", dispatcherJwt, {
    method: "POST",
    body: JSON.stringify({ name: "Bad", lat: 51, lng: "-114" }),
  });
  check("string lng → 400", strLng.status === 400, `status=${strLng.status}`);

  // 4. Delete — malformed ids must be rejected, not coerced by parseInt
  const badId1 = await api(`/map/pins/${create.body?.id}junk`, dispatcherJwt, { method: "DELETE" });
  check("malformed id '<id>junk' → 400", badId1.status === 400, `status=${badId1.status}`);
  const badId2 = await api(`/map/pins/${create.body?.id}.9`, dispatcherJwt, { method: "DELETE" });
  check("malformed id '<id>.9' → 400", badId2.status === 400, `status=${badId2.status}`);
  const stillThere = await api("/map/pins", dispatcherJwt);
  check(
    "pin survived malformed delete attempts",
    stillThere.status === 200 && stillThere.body.some((p: any) => p.id === create.body?.id),
  );

  const del = await api(`/map/pins/${create.body?.id}`, dispatcherJwt, { method: "DELETE" });
  check("DELETE /map/pins/:id → 200", del.status === 200 && del.body?.ok === true, `status=${del.status}`);
  const delAgain = await api(`/map/pins/${create.body?.id}`, dispatcherJwt, { method: "DELETE" });
  check("delete again → 404", delAgain.status === 404, `status=${delAgain.status}`);
  const list2 = await api("/map/pins", dispatcherJwt);
  check("pin gone from list", list2.status === 200 && !list2.body.some((p: any) => p.id === create.body?.id));

  // 5. Non-dispatcher blocked everywhere
  const c1 = await api("/map/pins", cleanerJwt);
  const c2 = await api("/map/pins", cleanerJwt, {
    method: "POST",
    body: JSON.stringify({ name: "Nope", lat: 51, lng: -114 }),
  });
  const c3 = await api("/map/pins/1", cleanerJwt, { method: "DELETE" });
  check("cleaner GET → 403", c1.status === 403, `status=${c1.status}`);
  check("cleaner POST → 403", c2.status === 403, `status=${c2.status}`);
  check("cleaner DELETE → 403", c3.status === 403, `status=${c3.status}`);
} finally {
  console.log("\nCleaning up...");
  for (const id of createdPinIds) {
    await db.delete(homeownerPinsTable).where(eq(homeownerPinsTable.id, id));
  }
  await db
    .delete(dispatcherAllowlistTable)
    .where(eq(dispatcherAllowlistTable.clerkUserId, dispatcherId));
  for (const userId of [dispatcherId, cleanerId]) {
    await clerk(`/v1/users/${userId}`, { method: "DELETE" }).catch(() => {});
  }
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

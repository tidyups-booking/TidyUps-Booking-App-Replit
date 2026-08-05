/**
 * e2e check: unassigned jobs keep appearing in GET /schedule.
 *
 * Verifies over real HTTP (dev server on 8080) that:
 *  1. A booking with staffId=null appears in the staff:null ("unassigned")
 *     bucket for both a dispatcher and a cleaner caller
 *  2. That booking does NOT appear in any staff bucket
 *  3. The unassigned bucket is omitted when no unassigned bookings exist
 *
 * Run from artifacts/api-server:  pnpm exec tsx e2e-unassigned-schedule-check.mts
 */
const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error("CLERK_SECRET_KEY missing");
  process.exit(1);
}
const CLERK_API = "https://api.clerk.com";
const API_BASE = process.env.E2E_API_BASE ?? "http://127.0.0.1:8080/api";

const { eq, inArray } = await import("drizzle-orm");
const { db, staffTable, bookingsTable, dispatcherAllowlistTable } = await import(
  "@workspace/db"
);

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
    throw new Error(
      `Clerk ${init?.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`,
    );
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

// +clerk_test emails so these accounts never show up in dispatcher UIs
const DISPATCHER_EMAIL = "unassigned-sched-dispatcher-e2e+clerk_test@example.com";
const CLEANER_EMAIL = "unassigned-sched-cleaner-e2e+clerk_test@example.com";

// Far-future dates so real bookings can't pollute the buckets under test
const DATE_WITH_UNASSIGNED = "2091-03-15";
const DATE_WITHOUT_UNASSIGNED = "2091-03-16";

console.log("Setting up Clerk test users...");
const [dispatcherId, cleanerId] = await Promise.all([
  ensureUser(DISPATCHER_EMAIL, "Dispatcher"),
  ensureUser(CLEANER_EMAIL, "Cleaner"),
]);
console.log(`dispatcher=${dispatcherId} cleaner=${cleanerId}\n`);

const staffIds: number[] = [];
const bookingIds: number[] = [];
try {
  await db
    .insert(dispatcherAllowlistTable)
    .values({ clerkUserId: dispatcherId })
    .onConflictDoNothing();
  // Reuse of the cleaner test user: clear any stale link, then link to our row
  await db
    .update(staffTable)
    .set({ clerkUserId: null })
    .where(eq(staffTable.clerkUserId, cleanerId));
  const [cleanerStaff] = await db
    .insert(staffTable)
    .values({
      name: "Unassigned Sched Cleaner (e2e)",
      role: "cleaner",
      active: true,
      clerkUserId: cleanerId,
    })
    .returning({ id: staffTable.id });
  staffIds.push(cleanerStaff.id);

  const baseBooking = {
    firstName: "Unassigned",
    lastName: "E2E",
    phone: "555-0000",
    address: "1 Test St",
    city: "Calgary",
    serviceType: "standard_clean" as const,
    scheduledTime: "10:00",
  };
  const [unassignedBooking] = await db
    .insert(bookingsTable)
    .values({
      ...baseBooking,
      scheduledDate: DATE_WITH_UNASSIGNED,
      staffId: null,
    })
    .returning({ id: bookingsTable.id });
  const [assignedBooking] = await db
    .insert(bookingsTable)
    .values({
      ...baseBooking,
      firstName: "Assigned",
      scheduledDate: DATE_WITHOUT_UNASSIGNED,
      staffId: cleanerStaff.id,
    })
    .returning({ id: bookingsTable.id });
  bookingIds.push(unassignedBooking.id, assignedBooking.id);

  const [dispatcherJwt, cleanerJwt] = await Promise.all([
    mintToken(dispatcherId),
    mintToken(cleanerId),
  ]);

  // 1 + 2: unassigned booking shows in the staff:null bucket only, for both roles
  for (const [role, jwt] of [
    ["dispatcher", dispatcherJwt],
    ["cleaner", cleanerJwt],
  ] as const) {
    const resp = await api(`/schedule?date=${DATE_WITH_UNASSIGNED}`, jwt);
    check(`${role}: GET /schedule returns 200`, resp.status === 200, `status=${resp.status}`);
    const buckets: any[] = Array.isArray(resp.body) ? resp.body : [];
    const nullBucket = buckets.find((b) => b.staff === null);
    check(`${role}: staff:null bucket present`, !!nullBucket);
    check(
      `${role}: unassigned booking in the null bucket`,
      !!nullBucket?.bookings?.some((b: any) => b.id === unassignedBooking.id),
    );
    const inStaffBucket = buckets.some(
      (b) =>
        b.staff !== null &&
        (b.bookings ?? []).some((bk: any) => bk.id === unassignedBooking.id),
    );
    check(`${role}: unassigned booking NOT in any staff bucket`, !inStaffBucket);
  }

  // 3: no unassigned bookings on the other date → bucket omitted entirely
  const resp2 = await api(`/schedule?date=${DATE_WITHOUT_UNASSIGNED}`, dispatcherJwt);
  check("no-unassigned date returns 200", resp2.status === 200, `status=${resp2.status}`);
  const buckets2: any[] = Array.isArray(resp2.body) ? resp2.body : [];
  check(
    "staff:null bucket omitted when no unassigned bookings exist",
    !buckets2.some((b) => b.staff === null),
  );
  check(
    "assigned booking sits in its cleaner's bucket",
    buckets2.some(
      (b) =>
        b.staff?.id === cleanerStaff.id &&
        (b.bookings ?? []).some((bk: any) => bk.id === assignedBooking.id),
    ),
  );
} finally {
  console.log("\nCleaning up...");
  if (bookingIds.length > 0) {
    await db.delete(bookingsTable).where(inArray(bookingsTable.id, bookingIds));
  }
  if (staffIds.length > 0) {
    await db.delete(staffTable).where(inArray(staffTable.id, staffIds));
  }
  await db
    .delete(dispatcherAllowlistTable)
    .where(eq(dispatcherAllowlistTable.clerkUserId, dispatcherId));
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

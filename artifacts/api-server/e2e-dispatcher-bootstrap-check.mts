/**
 * End-to-end regression check for the DISPATCHER_EMAILS bootstrap in
 * src/lib/callerRole.ts — the fix for the production lockout where dev and
 * prod Clerk user IDs differ, so an ID-based allowlist seeded in dev left
 * the owner with 403s on the deployed site.
 *
 * Exercises resolveCallerRole() in-process (real Clerk backend API + real
 * database), covering:
 *   1. VERIFIED email in DISPATCHER_EMAILS, missing from allowlist →
 *      dispatcher access AND a self-healed allowlist row.
 *   2. Matching but UNVERIFIED email → stays denied, no allowlist row.
 *   3. Staff-linked (cleaner) account → never elevated, even with a
 *      matching verified email.
 *   4. Non-matching denied user → exactly one Clerk lookup (negative cache
 *      prevents repeated Clerk API calls on subsequent requests).
 *
 * Global fetch is wrapped BEFORE importing callerRole so Clerk API calls
 * made by clerkClient can be counted for the negative-cache assertion.
 *
 * Cleanup: every allowlist/staff row this script creates is removed in
 * `finally`; pre-existing rows are never touched.
 *
 * Requirements: CLERK_SECRET_KEY and DATABASE_URL set (no dev server needed).
 * Run: npx tsx e2e-dispatcher-bootstrap-check.mts  (from artifacts/api-server)
 */

const CLERK_API = "https://api.clerk.com";
const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error("FAIL: CLERK_SECRET_KEY is not set");
  process.exit(1);
}

// --- Count Clerk API calls made by clerkClient (must wrap fetch before any
// --- import that pulls in @clerk/express).
let clerkApiCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("api.clerk.com")) clerkApiCalls++;
  return realFetch(input, init);
}) as typeof fetch;

const { and, eq, inArray, isNull, isNotNull } = await import("drizzle-orm");
const { db, dispatcherAllowlistTable, dispatcherInvitesTable, staffTable } = await import(
  "@workspace/db"
);
const { resolveCallerRole } = await import("./src/lib/callerRole.js");

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function clerk(path: string, init?: RequestInit): Promise<any> {
  const res = await realFetch(`${CLERK_API}${path}`, {
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

/** Create or reuse a +clerk_test user whose email is VERIFIED (Clerk verifies
 * backend-created emails automatically). */
async function ensureUser(email: string): Promise<string> {
  const existing = await clerk(`/v1/users?email_address=${encodeURIComponent(email)}`);
  if (Array.isArray(existing) && existing.length > 0) return existing[0].id;
  const created = await clerk(`/v1/users`, {
    method: "POST",
    body: JSON.stringify({
      email_address: [email],
      first_name: "Bootstrap",
      last_name: "E2E Check",
      skip_password_requirement: true,
    }),
  });
  return created.id;
}

/**
 * Create or reuse a user whose DISPATCHER_EMAILS-matching address is
 * UNVERIFIED. The Clerk instance requires every user to keep at least one
 * verified email, so the user gets a separate verified primary address
 * (not in DISPATCHER_EMAILS) plus the matching address added unverified.
 */
async function ensureUnverifiedMatchUser(matchEmail: string, primaryEmail: string): Promise<string> {
  // If some user already owns the match email (e.g. from a previous run),
  // reuse that user; otherwise create one with the primary email.
  const owners = await clerk(`/v1/users?email_address=${encodeURIComponent(matchEmail)}`);
  const userId =
    Array.isArray(owners) && owners.length > 0 ? owners[0].id : await ensureUser(primaryEmail);

  // If a DIFFERENT user owns the primary email (stray from an earlier run of
  // this test-only flow), delete it so the email can be attached here.
  const primaryOwners = await clerk(`/v1/users?email_address=${encodeURIComponent(primaryEmail)}`);
  if (Array.isArray(primaryOwners)) {
    for (const stray of primaryOwners) {
      if (stray.id !== userId) {
        await clerk(`/v1/users/${stray.id}`, { method: "DELETE" });
      }
    }
  }

  let user = await clerk(`/v1/users/${userId}`);

  // Ensure the verified primary email exists first (instance invariant:
  // every user must keep at least one verified email).
  const primary = user.email_addresses.find(
    (e: any) => e.email_address.toLowerCase() === primaryEmail.toLowerCase(),
  );
  if (!primary) {
    await clerk(`/v1/email_addresses`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, email_address: primaryEmail, verified: true }),
    });
    user = await clerk(`/v1/users/${userId}`);
  }

  const emailObj = user.email_addresses.find(
    (e: any) => e.email_address.toLowerCase() === matchEmail.toLowerCase(),
  );
  if (!emailObj) {
    await clerk(`/v1/email_addresses`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, email_address: matchEmail, verified: false }),
    });
  } else if (emailObj.verification?.status === "verified") {
    await clerk(`/v1/email_addresses/${emailObj.id}`, {
      method: "PATCH",
      body: JSON.stringify({ verified: false }),
    });
  }
  return userId;
}

const VERIFIED_EMAIL = "bootstrap-verified-e2e+clerk_test@example.com";
const UNVERIFIED_EMAIL = "bootstrap-unverified-e2e+clerk_test@example.com";
const CLEANER_EMAIL = "bootstrap-cleaner-e2e+clerk_test@example.com";
const NONMATCH_EMAIL = "bootstrap-nonmatch-e2e+clerk_test@example.com";
const INVITE_EMAIL = "bootstrap-invite-e2e+clerk_test@example.com";
const STAFF_LINK_EMAIL = "bootstrap-stafflink-e2e+clerk_test@example.com";
const STAFF_INACTIVE_EMAIL = "bootstrap-staffinactive-e2e+clerk_test@example.com";

// The bootstrap list contains the first three; NONMATCH_EMAIL is excluded.
// Mixed case + spaces to also cover the normalization path.
process.env.DISPATCHER_EMAILS = ` ${VERIFIED_EMAIL.toUpperCase()}, ${UNVERIFIED_EMAIL} , ${CLEANER_EMAIL}`;

console.log("Setting up Clerk test users...");
const [verifiedId, unverifiedId, cleanerId, nonmatchId, inviteId, staffLinkId, staffInactiveId] =
  await Promise.all([
    ensureUser(VERIFIED_EMAIL),
    ensureUnverifiedMatchUser(
      UNVERIFIED_EMAIL,
      "bootstrap-unverified-primary-e2e+clerk_test@example.com",
    ),
    ensureUser(CLEANER_EMAIL),
    ensureUser(NONMATCH_EMAIL),
    ensureUser(INVITE_EMAIL),
    ensureUser(STAFF_LINK_EMAIL),
    ensureUser(STAFF_INACTIVE_EMAIL),
  ]);
const allIds = [verifiedId, unverifiedId, cleanerId, nonmatchId, inviteId, staffLinkId, staffInactiveId];
console.log(
  `verified=${verifiedId} unverified=${unverifiedId} cleaner=${cleanerId} nonmatch=${nonmatchId} invite=${inviteId} stafflink=${staffLinkId} staffinactive=${staffInactiveId}\n`,
);

async function allowlistRow(id: string) {
  return db
    .select()
    .from(dispatcherAllowlistTable)
    .where(eq(dispatcherAllowlistTable.clerkUserId, id));
}

let tempStaffId: number | null = null;
const extraStaffIds: number[] = [];
try {
  // Start clean: none of the test users may be in the allowlist.
  await db
    .delete(dispatcherAllowlistTable)
    .where(inArray(dispatcherAllowlistTable.clerkUserId, allIds));

  // ------------------------------------------------------------------
  // 1. Verified email in DISPATCHER_EMAILS, missing from allowlist →
  //    dispatcher + self-healed allowlist row.
  console.log("1. Verified-email bootstrap (self-heal):");
  const r1 = await resolveCallerRole(verifiedId);
  check("verified matching user gets dispatcher role", r1.role === "dispatcher", `role=${r1.role}`);
  const healed = await allowlistRow(verifiedId);
  check("allowlist row was self-healed (created)", healed.length === 1);
  // Second call must now resolve via the allowlist (still dispatcher).
  const r1b = await resolveCallerRole(verifiedId);
  check("still dispatcher on subsequent request", r1b.role === "dispatcher", `role=${r1b.role}`);

  // ------------------------------------------------------------------
  // 2. Matching but UNVERIFIED email → denied, no row.
  console.log("\n2. Unverified matching email stays denied:");
  const r2 = await resolveCallerRole(unverifiedId);
  check("unverified matching user is denied", r2.role === "denied", `role=${r2.role}`);
  const noRow = await allowlistRow(unverifiedId);
  check("no allowlist row created for unverified user", noRow.length === 0);

  // ------------------------------------------------------------------
  // 3. Staff-linked (cleaner) account is never elevated, even with a
  //    matching verified email in DISPATCHER_EMAILS.
  console.log("\n3. Cleaner account is never elevated:");
  const existingStaff = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(eq(staffTable.clerkUserId, cleanerId));
  let staffId: number;
  if (existingStaff.length > 0) {
    staffId = existingStaff[0].id;
  } else {
    const [row] = await db
      .insert(staffTable)
      .values({ name: "Bootstrap Cleaner E2E", role: "cleaner", clerkUserId: cleanerId })
      .returning({ id: staffTable.id });
    staffId = row.id;
    tempStaffId = staffId;
  }
  const r3 = await resolveCallerRole(cleanerId);
  check("staff-linked user resolves as cleaner (not dispatcher)", r3.role === "cleaner", `role=${r3.role}`);
  check("cleaner keeps their staffId", r3.role === "cleaner" && r3.staffId === staffId);
  const cleanerRow = await allowlistRow(cleanerId);
  check("no allowlist row created for cleaner", cleanerRow.length === 0);

  // ------------------------------------------------------------------
  // 4. Non-matching denied user triggers exactly ONE Clerk lookup; repeat
  //    requests are served from the negative cache.
  console.log("\n4. Negative cache for non-matching denied users:");
  const callsBefore = clerkApiCalls;
  const r4a = await resolveCallerRole(nonmatchId);
  check("non-matching user is denied", r4a.role === "denied", `role=${r4a.role}`);
  const callsAfterFirst = clerkApiCalls;
  check(
    "first denied request performs a Clerk lookup",
    callsAfterFirst > callsBefore,
    `calls=${callsAfterFirst - callsBefore}`,
  );
  const r4b = await resolveCallerRole(nonmatchId);
  const r4c = await resolveCallerRole(nonmatchId);
  check("repeat requests stay denied", r4b.role === "denied" && r4c.role === "denied");
  check(
    "repeat denied requests make NO further Clerk calls (negative cache)",
    clerkApiCalls === callsAfterFirst,
    `extra calls=${clerkApiCalls - callsAfterFirst}`,
  );
  const nonmatchRow = await allowlistRow(nonmatchId);
  check("no allowlist row created for non-matching user", nonmatchRow.length === 0);

  // ------------------------------------------------------------------
  // 5. Empty DISPATCHER_EMAILS (and no pending invites) short-circuits
  //    without any Clerk call.
  console.log("\n5. Empty DISPATCHER_EMAILS short-circuits:");
  process.env.DISPATCHER_EMAILS = "";
  // Matching users are never negative-cached, so removing the verified
  // user's allowlist row makes them fall through to the bootstrap again.
  await db
    .delete(dispatcherAllowlistTable)
    .where(eq(dispatcherAllowlistTable.clerkUserId, verifiedId));
  // Stray invites from earlier runs would defeat the short-circuit; clear ours.
  await db.delete(dispatcherInvitesTable).where(eq(dispatcherInvitesTable.email, INVITE_EMAIL));
  const pendingCount = (
    await db
      .select({ id: dispatcherInvitesTable.id })
      .from(dispatcherInvitesTable)
      .where(isNull(dispatcherInvitesTable.claimedAt))
  ).length;
  // Unlinked active staff with an email also trigger the Clerk lookup
  // (cleaner self-link), so they defeat the short-circuit too.
  const linkableCount = (
    await db
      .select({ id: staffTable.id })
      .from(staffTable)
      .where(
        and(
          isNull(staffTable.clerkUserId),
          isNotNull(staffTable.email),
          eq(staffTable.active, true),
        ),
      )
  ).length;
  const callsBeforeEmpty = clerkApiCalls;
  const r5 = await resolveCallerRole(verifiedId);
  check("denied when DISPATCHER_EMAILS is empty", r5.role === "denied", `role=${r5.role}`);
  if (pendingCount === 0 && linkableCount === 0) {
    check("no Clerk call when DISPATCHER_EMAILS is empty", clerkApiCalls === callsBeforeEmpty);
  } else {
    console.log(
      `SKIP: no-Clerk-call assertion (${pendingCount} pending invite(s), ${linkableCount} linkable staff row(s) exist in this DB)`,
    );
  }

  // ------------------------------------------------------------------
  // 6. Pending invite (added by name + email) grants access on sign-in and
  //    is marked claimed — works even with DISPATCHER_EMAILS empty.
  console.log("\n6. Pending invite claim flow:");
  await db
    .delete(dispatcherAllowlistTable)
    .where(eq(dispatcherAllowlistTable.clerkUserId, inviteId));
  await db
    .insert(dispatcherInvitesTable)
    .values({ email: INVITE_EMAIL, name: "Invite E2E Check" });
  const r6 = await resolveCallerRole(inviteId);
  check("invited user gets dispatcher role on first sign-in", r6.role === "dispatcher", `role=${r6.role}`);
  const invitedRow = await allowlistRow(inviteId);
  check("allowlist row created for invited user", invitedRow.length === 1);
  const claimed = await db
    .select()
    .from(dispatcherInvitesTable)
    .where(eq(dispatcherInvitesTable.email, INVITE_EMAIL));
  check(
    "invite marked claimed with the claimer's user id",
    claimed.length === 1 &&
      claimed[0].claimedAt !== null &&
      claimed[0].claimedClerkUserId === inviteId,
  );
  const r6b = await resolveCallerRole(inviteId);
  check("still dispatcher on subsequent request", r6b.role === "dispatcher", `role=${r6b.role}`);

  // ------------------------------------------------------------------
  // 7. A revoked invite grants nothing: deleting the pending invite before
  //    the claim leaves the caller denied with no allowlist row.
  console.log("\n7. Revoked invite grants nothing:");
  await db
    .delete(dispatcherAllowlistTable)
    .where(eq(dispatcherAllowlistTable.clerkUserId, inviteId));
  await db.delete(dispatcherInvitesTable).where(eq(dispatcherInvitesTable.email, INVITE_EMAIL));
  // Recreate then immediately revoke, as a dispatcher would from the UI.
  await db
    .insert(dispatcherInvitesTable)
    .values({ email: INVITE_EMAIL, name: "Invite E2E Check (revoked)" });
  await db.delete(dispatcherInvitesTable).where(eq(dispatcherInvitesTable.email, INVITE_EMAIL));
  const r7 = await resolveCallerRole(inviteId);
  check("user with revoked invite stays denied", r7.role === "denied", `role=${r7.role}`);
  const revokedRow = await allowlistRow(inviteId);
  check("no allowlist row created after revoked invite", revokedRow.length === 0);

  // ------------------------------------------------------------------
  // 8. Staff-email self-link (cleaner self-service): a staff record with a
  //    matching email but no linked account links itself on first sign-in.
  console.log("\n8. Staff email self-link:");
  const [staffLinkRow] = await db
    .insert(staffTable)
    .values({ name: "Staff Link E2E", role: "cleaner", email: STAFF_LINK_EMAIL })
    .returning({ id: staffTable.id });
  extraStaffIds.push(staffLinkRow.id);
  const r8 = await resolveCallerRole(staffLinkId);
  check(
    "user with matching staff email resolves as cleaner",
    r8.role === "cleaner" && r8.staffId === staffLinkRow.id,
    `role=${r8.role} staffId=${r8.staffId}`,
  );
  const [linkedStaff] = await db
    .select({ clerkUserId: staffTable.clerkUserId })
    .from(staffTable)
    .where(eq(staffTable.id, staffLinkRow.id));
  check("staff record now linked to the caller's user id", linkedStaff?.clerkUserId === staffLinkId);
  const r8b = await resolveCallerRole(staffLinkId);
  check("still cleaner on subsequent request", r8b.role === "cleaner", `role=${r8b.role}`);
  const staffLinkAllowlist = await allowlistRow(staffLinkId);
  check("self-linked cleaner got NO dispatcher access", staffLinkAllowlist.length === 0);

  // ------------------------------------------------------------------
  // 9. An INACTIVE staff record never self-links.
  console.log("\n9. Inactive staff record grants nothing:");
  const [inactiveRow] = await db
    .insert(staffTable)
    .values({ name: "Staff Inactive E2E", role: "cleaner", email: STAFF_INACTIVE_EMAIL, active: false })
    .returning({ id: staffTable.id });
  extraStaffIds.push(inactiveRow.id);
  const r9 = await resolveCallerRole(staffInactiveId);
  check("user matching an inactive staff record stays denied", r9.role === "denied", `role=${r9.role}`);
  const [inactiveAfter] = await db
    .select({ clerkUserId: staffTable.clerkUserId })
    .from(staffTable)
    .where(eq(staffTable.id, inactiveRow.id));
  check("inactive staff record stays unlinked", inactiveAfter?.clerkUserId === null);
} finally {
  // Remove every row this script may have created.
  await db
    .delete(dispatcherAllowlistTable)
    .where(inArray(dispatcherAllowlistTable.clerkUserId, allIds));
  await db.delete(dispatcherInvitesTable).where(eq(dispatcherInvitesTable.email, INVITE_EMAIL));
  if (tempStaffId !== null) {
    await db.delete(staffTable).where(eq(staffTable.id, tempStaffId));
  }
  if (extraStaffIds.length > 0) {
    await db.delete(staffTable).where(inArray(staffTable.id, extraStaffIds));
  }
  const leftover = await db
    .select()
    .from(dispatcherAllowlistTable)
    .where(inArray(dispatcherAllowlistTable.clerkUserId, allIds));
  check("\ncleanup: no test allowlist rows remain", leftover.length === 0);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { type Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import {
  db,
  staffTable,
  dispatcherAllowlistTable,
  dispatcherInvitesTable,
} from "@workspace/db";

/**
 * Caller roles in the system
 *
 * DISPATCHER — Clerk userId is in the `dispatcher_allowlist` table.
 *              Full access to all routes.
 *
 * CLEANER    — Clerk userId matches exactly one `staff` record's clerkUserId.
 *              Restricted to their own schedule, own bookings (read + status
 *              update only), and their own location endpoint.
 *
 * DENIED     — Authenticated user not present in either table.
 *              All protected routes return 403.
 *
 * The first dispatcher (owner) is seeded by migration 003. After that,
 * dispatchers manage the allowlist from the Staff page in the booking app
 * (routes in routes/dispatchers.ts). Manual fallback:
 *   INSERT INTO dispatcher_allowlist (clerk_user_id) VALUES ('<clerk_user_id>');
 */
export type CallerRole =
  | { role: "dispatcher"; staffId: null }
  | { role: "cleaner";    staffId: number }
  | { role: "denied";     staffId: null };

export async function resolveCallerRole(callerId: string): Promise<CallerRole> {
  // Check both tables in parallel for performance
  const [dispatcherRows, staffRows] = await Promise.all([
    db
      .select({ clerkUserId: dispatcherAllowlistTable.clerkUserId })
      .from(dispatcherAllowlistTable)
      .where(eq(dispatcherAllowlistTable.clerkUserId, callerId))
      .limit(1),
    db
      .select({ id: staffTable.id })
      .from(staffTable)
      .where(eq(staffTable.clerkUserId, callerId))
      .limit(1),
  ]);

  if (dispatcherRows.length > 0) {
    return { role: "dispatcher", staffId: null };
  }

  if (staffRows.length > 0) {
    return { role: "cleaner", staffId: staffRows[0].id };
  }

  return await tryBootstrapDispatcherByEmail(callerId);
}

/**
 * Email-based dispatcher bootstrap. Two sources of matching emails:
 *
 * 1. `DISPATCHER_EMAILS` env (comma-separated) — environment-portable owner
 *    rescue list. Clerk user IDs differ between development and production
 *    (separate user stores), so an allowlist seeded in one environment does
 *    not carry over to the other — which locks the owner out of the deployed
 *    app. Emails on this list always get dispatcher access.
 *
 * 2. `dispatcher_invites` rows — pending invites created by a dispatcher
 *    from the Staff page ("add by name + email"). Claiming an invite also
 *    stamps `claimed_at`/`claimed_clerk_user_id` so it disappears from the
 *    pending list.
 *
 * 3. `staff` rows with an email but no linked Clerk account — cleaner
 *    self-service. A dispatcher creates the staff record with the cleaner's
 *    email; when the cleaner signs up in the cleaner app with that same
 *    email (and it is verified), their account links automatically via an
 *    atomic UPDATE ... WHERE clerk_user_id IS NULL, so a record that was
 *    linked or deactivated in the meantime never grants access.
 *
 * In all cases only VERIFIED Clerk emails count (verification is what
 * proves the caller owns the address).
 *
 * Unmatched callers are negative-cached with a short TTL so repeated denied
 * requests do not hammer the Clerk API, while a freshly created invite still
 * takes effect within a minute for someone who signed in too early.
 */
const BOOTSTRAP_RECHECK_MS = 60_000;
const bootstrapNegativeCache = new Map<string, number>();

async function tryBootstrapDispatcherByEmail(callerId: string): Promise<CallerRole> {
  const denied: CallerRole = { role: "denied", staffId: null };

  const bootstrapEmails = (process.env.DISPATCHER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  // Pending invites and linkable staff live in our own DB, so these checks
  // are cheap and always fresh.
  const [pendingInvites, linkableStaff] = await Promise.all([
    db
      .select({ id: dispatcherInvitesTable.id, email: dispatcherInvitesTable.email })
      .from(dispatcherInvitesTable)
      .where(isNull(dispatcherInvitesTable.claimedAt)),
    db
      .select({ id: staffTable.id, email: staffTable.email })
      .from(staffTable)
      .where(
        and(
          isNull(staffTable.clerkUserId),
          isNotNull(staffTable.email),
          eq(staffTable.active, true),
        ),
      ),
  ]);

  if (bootstrapEmails.length === 0 && pendingInvites.length === 0 && linkableStaff.length === 0) {
    return denied;
  }

  const checkedAt = bootstrapNegativeCache.get(callerId);
  if (checkedAt !== undefined && Date.now() - checkedAt < BOOTSTRAP_RECHECK_MS) {
    return denied;
  }

  try {
    const user = await clerkClient.users.getUser(callerId);

    const verifiedEmails = user.emailAddresses
      .filter((e) => e.verification?.status === "verified")
      .map((e) => e.emailAddress.toLowerCase());

    const matchesEnv = verifiedEmails.some((e) => bootstrapEmails.includes(e));
    const matchedInvite = pendingInvites.find((inv) =>
      verifiedEmails.includes(inv.email.toLowerCase()),
    );
    const matchedStaff = linkableStaff.find(
      (s) => s.email && verifiedEmails.includes(s.email.trim().toLowerCase()),
    );

    if (!matchesEnv && !matchedInvite && !matchedStaff) {
      // Confirmed nonmatch — negative-cache with a TTL so future denied
      // requests skip the Clerk call for a while. Matching callers are never
      // cached: once the allowlist insert succeeds they resolve via the
      // allowlist, and if the insert fails transiently they stay retryable.
      bootstrapNegativeCache.set(callerId, Date.now());
      return denied;
    }

    if (matchesEnv) {
      // Env-listed owner emails grant unconditionally.
      await db
        .insert(dispatcherAllowlistTable)
        .values({ clerkUserId: callerId })
        .onConflictDoNothing();
      // Tidy up: a pending invite for the same email can't be left behind,
      // or it would re-grant access after a later revocation.
      if (matchedInvite) {
        await db
          .update(dispatcherInvitesTable)
          .set({ claimedAt: new Date(), claimedClerkUserId: callerId })
          .where(
            and(
              eq(dispatcherInvitesTable.id, matchedInvite.id),
              isNull(dispatcherInvitesTable.claimedAt),
            ),
          );
      }
      console.log(`[callerRole] bootstrapped dispatcher access for ${callerId} via DISPATCHER_EMAILS`);
      return { role: "dispatcher", staffId: null };
    }

    if (matchedInvite) {
      // Invite match: the caller must WIN the claim before any access is
      // granted. The conditional UPDATE and the allowlist insert run in one
      // transaction, so a concurrent revoke (DELETE) or competing claim makes
      // the UPDATE affect zero rows and NO access is granted — an invite
      // revoked mid-sign-in can never leak dispatcher privileges.
      const granted = await db.transaction(async (tx) => {
        const claimed = await tx
          .update(dispatcherInvitesTable)
          .set({ claimedAt: new Date(), claimedClerkUserId: callerId })
          .where(
            and(
              eq(dispatcherInvitesTable.id, matchedInvite.id),
              isNull(dispatcherInvitesTable.claimedAt),
            ),
          )
          .returning({ id: dispatcherInvitesTable.id });
        if (claimed.length === 0) return false;
        await tx
          .insert(dispatcherAllowlistTable)
          .values({ clerkUserId: callerId })
          .onConflictDoNothing();
        return true;
      });

      if (!granted) {
        // The invite vanished between the read and the claim. If this same
        // caller already claimed it in a concurrent request, the allowlist
        // row exists and the next resolveCallerRole call grants normally.
        bootstrapNegativeCache.set(callerId, Date.now());
        return denied;
      }

      console.log(`[callerRole] dispatcher invite claimed by ${callerId}`);
      return { role: "dispatcher", staffId: null };
    }

    // Staff-email self-link (cleaner self-service): the caller signed up with
    // an email a dispatcher put on an unlinked, active staff record. The link
    // is a conditional UPDATE — if the record was linked to someone else or
    // deactivated in the meantime, zero rows update and nothing is granted.
    const linked = await db
      .update(staffTable)
      .set({ clerkUserId: callerId })
      .where(
        and(
          eq(staffTable.id, matchedStaff!.id),
          isNull(staffTable.clerkUserId),
          eq(staffTable.active, true),
        ),
      )
      .returning({ id: staffTable.id });

    if (linked.length === 0) {
      // Two first-sign-in requests from the SAME user can race here: both see
      // the unlinked row, one UPDATE wins, the other updates zero rows. If the
      // row now belongs to this caller, treat it as the same success instead
      // of denying (which would negative-cache a freshly linked account).
      const [nowLinked] = await db
        .select({ id: staffTable.id })
        .from(staffTable)
        .where(
          and(eq(staffTable.id, matchedStaff!.id), eq(staffTable.clerkUserId, callerId)),
        );
      if (nowLinked) {
        return { role: "cleaner", staffId: nowLinked.id };
      }
      bootstrapNegativeCache.set(callerId, Date.now());
      return denied;
    }

    console.log(`[callerRole] staff record ${linked[0].id} self-linked by ${callerId}`);
    return { role: "cleaner", staffId: linked[0].id };
  } catch (err) {
    // Transient Clerk failure — do NOT cache, so the next request retries.
    console.warn("[callerRole] dispatcher email bootstrap check failed:", err);
    return denied;
  }
}

/**
 * Soft dispatcher guard — for routes already behind `requireAuth` middleware.
 * Unauthenticated requests are passed through (the auth middleware catches them
 * before this runs). Authenticated non-dispatchers receive 403.
 * Returns `true` if the request was rejected (caller should `return` immediately).
 */
export async function guardDispatcher(req: any, res: Response): Promise<boolean> {
  const callerId = getAuth(req)?.userId;
  if (!callerId) return false; // unauthenticated — pass through (requireAuth handles it)

  const callerRole = await resolveCallerRole(callerId);
  if (callerRole.role !== "dispatcher") {
    res.status(403).json({ error: "Forbidden: dispatcher access required" });
    return true;
  }
  return false;
}

/**
 * Strict dispatcher guard — for routes mounted BEFORE `requireAuth` middleware
 * (e.g. Jobber management, Twilio config). Returns 401 for unauthenticated
 * callers and 403 for authenticated non-dispatchers.
 * Returns `true` if the request was rejected (caller should `return` immediately).
 */
export async function requireDispatcherAuth(req: any, res: Response): Promise<boolean> {
  const callerId = getAuth(req)?.userId;
  if (!callerId) {
    res.status(401).json({ error: "Unauthorized" });
    return true;
  }

  const callerRole = await resolveCallerRole(callerId);
  if (callerRole.role !== "dispatcher") {
    res.status(403).json({ error: "Forbidden: dispatcher access required" });
    return true;
  }
  return false;
}

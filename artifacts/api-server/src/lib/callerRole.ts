import { eq } from "drizzle-orm";
import { type Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, staffTable, dispatcherAllowlistTable } from "@workspace/db";

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
 * Environment-portable dispatcher bootstrap.
 *
 * Clerk user IDs differ between development and production (separate user
 * stores), so an allowlist seeded in one environment does not carry over to
 * the other — which locks the owner out of the deployed app. To fix this,
 * `DISPATCHER_EMAILS` (comma-separated) names owner emails that always get
 * dispatcher access: when an authenticated caller is not in the allowlist,
 * we check their VERIFIED Clerk emails against the list and, on match,
 * insert them into `dispatcher_allowlist` (self-healing, one-time per user).
 *
 * Unmatched callers are cached per process so repeated denied requests do
 * not hammer the Clerk API.
 */
const bootstrapCheckedCallers = new Set<string>();

async function tryBootstrapDispatcherByEmail(callerId: string): Promise<CallerRole> {
  const denied: CallerRole = { role: "denied", staffId: null };

  const bootstrapEmails = (process.env.DISPATCHER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (bootstrapEmails.length === 0) return denied;
  if (bootstrapCheckedCallers.has(callerId)) return denied;

  try {
    const user = await clerkClient.users.getUser(callerId);

    const verifiedEmails = user.emailAddresses
      .filter((e) => e.verification?.status === "verified")
      .map((e) => e.emailAddress.toLowerCase());

    if (!verifiedEmails.some((e) => bootstrapEmails.includes(e))) {
      // Confirmed nonmatch — cache so future denied requests skip the Clerk
      // call. Matching callers are never cached: once the allowlist insert
      // succeeds they resolve via the allowlist, and if the insert fails
      // transiently they stay retryable on the next request.
      bootstrapCheckedCallers.add(callerId);
      return denied;
    }

    await db
      .insert(dispatcherAllowlistTable)
      .values({ clerkUserId: callerId })
      .onConflictDoNothing();
    console.log(`[callerRole] bootstrapped dispatcher access for ${callerId} via DISPATCHER_EMAILS`);
    return { role: "dispatcher", staffId: null };
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

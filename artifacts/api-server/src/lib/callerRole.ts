import { eq } from "drizzle-orm";
import { type Response } from "express";
import { getAuth } from "@clerk/express";
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
 * Seeding the first dispatcher:
 *   INSERT INTO dispatcher_allowlist (clerk_user_id) VALUES ('<clerk_user_id>');
 *
 * Get a user's Clerk ID from the Clerk dashboard → Users.
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

  return { role: "denied", staffId: null };
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

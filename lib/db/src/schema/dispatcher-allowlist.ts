import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Explicit allowlist of Clerk user IDs that are authorized as dispatchers.
 *
 * This is the authoritative source of dispatcher identity. Any authenticated
 * Clerk user whose userId appears here is treated as a dispatcher with full
 * API access. Users NOT in this table and NOT in the staff table are denied
 * access to protected endpoints.
 *
 * Initial setup: a super-admin seeds this table directly via the database
 * console with the Clerk user IDs of the dispatcher accounts.
 * Ongoing management: a dedicated admin endpoint can be added later.
 */
export const dispatcherAllowlistTable = pgTable("dispatcher_allowlist", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Pending dispatcher invitations, added by name + email from the Staff page.
 *
 * Flow: a dispatcher enters a name + email. If a Clerk account already owns
 * that email (verified), the account is granted access immediately and no
 * invite row is created. Otherwise a row lands here, and the first time
 * someone signs in with that email VERIFIED on their Clerk account, the
 * bootstrap in api-server's callerRole.ts inserts them into
 * `dispatcher_allowlist` and stamps `claimedAt`/`claimedClerkUserId`.
 *
 * A partial unique index (migration 013) allows only one PENDING invite per
 * email (case-insensitive); claimed invites are kept as history.
 */
export const dispatcherInvitesTable = pgTable("dispatcher_invites", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimedClerkUserId: text("claimed_clerk_user_id"),
  // Clerk backend invitation id (inv_...) for the sign-up email we sent, so
  // revoking the invite can also revoke the emailed link. NULL if the email
  // failed to send (invite still works via manual sign-up).
  clerkInvitationId: text("clerk_invitation_id"),
});

import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import { db, dispatcherAllowlistTable, dispatcherInvitesTable } from "@workspace/db";
import { guardDispatcher } from "../lib/callerRole.js";

const router: IRouter = Router();

/**
 * Dispatcher access management.
 *
 * Dispatcher access is controlled by the `dispatcher_allowlist` table:
 * a Clerk user ID present in the table has full dispatcher access.
 * These routes let an existing dispatcher manage the allowlist from the UI
 * instead of via manual SQL.
 */

type ClerkUserSummary = {
  clerkUserId: string;
  name: string | null;
  email: string | null;
  /**
   * ALL verified addresses on the account (lowercased). Access is granted by
   * matching any verified address (see POST /dispatchers/invites), so status
   * displays must match against this list — the primary `email` is for
   * display only. Without it, a staff card whose saved email is a dispatcher's
   * secondary address would keep offering "Add to Dispatch" (and 409 on click).
   */
  verifiedEmails: string[];
  imageUrl: string | null;
};

function summarizeClerkUser(u: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string;
  emailAddresses: {
    id: string;
    emailAddress: string;
    verification?: { status?: string | null } | null;
  }[];
  primaryEmailAddressId: string | null;
}): ClerkUserSummary {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
  const primaryEmail =
    u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
    u.emailAddresses[0]?.emailAddress ??
    null;
  const verifiedEmails = u.emailAddresses
    .filter((e) => e.verification?.status === "verified")
    .map((e) => e.emailAddress.toLowerCase());
  return {
    clerkUserId: u.id,
    name,
    email: primaryEmail,
    verifiedEmails,
    imageUrl: u.imageUrl || null,
  };
}

// GET /dispatchers — list current dispatchers, enriched with Clerk profile info
router.get("/dispatchers", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const rows = await db
    .select()
    .from(dispatcherAllowlistTable)
    .orderBy(dispatcherAllowlistTable.createdAt);

  // Enrich with Clerk profile info; tolerate lookup failures (e.g. deleted users)
  const enriched = await Promise.all(
    rows.map(async (row) => {
      try {
        const user = await clerkClient.users.getUser(row.clerkUserId);
        return {
          ...summarizeClerkUser(user),
          createdAt: row.createdAt,
        };
      } catch {
        return {
          clerkUserId: row.clerkUserId,
          name: null,
          email: null,
          verifiedEmails: [] as string[],
          imageUrl: null,
          createdAt: row.createdAt,
        };
      }
    }),
  );

  res.json(enriched);
});

// GET /dispatchers/clerk-users — list Clerk users so a dispatcher can pick who to add
router.get("/dispatchers/clerk-users", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  try {
    const [{ data: users }, allowlist] = await Promise.all([
      clerkClient.users.getUserList({ limit: 200, orderBy: "-created_at" }),
      db
        .select({ clerkUserId: dispatcherAllowlistTable.clerkUserId })
        .from(dispatcherAllowlistTable),
    ]);
    const allowed = new Set(allowlist.map((r) => r.clerkUserId));

    res.json(
      users.map((u) => ({
        ...summarizeClerkUser(u),
        isDispatcher: allowed.has(u.id),
      })),
    );
  } catch (err) {
    console.error("[dispatchers] failed to list Clerk users:", err);
    res.status(502).json({ error: "Failed to list users from Clerk" });
  }
});

// ---------------------------------------------------------------------------
// Email invites — add a dispatcher by name + email.
//
// If a Clerk account already owns that email VERIFIED, access is granted
// immediately (no invite row). Otherwise a pending invite is stored and the
// person gets dispatcher access automatically the first time they sign in
// with that email verified on their account (bootstrap in lib/callerRole.ts).
// Only verified emails count in both paths: otherwise anyone could attach an
// unverified copy of an expected invitee's address to their own account and
// hijack the invite.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Where the invitation email's sign-up link should land. Clerk's dev and
 * prod instances have separate user stores, so the link must point at the
 * SAME environment that sent it: in production that's the live site
 * (bookcleaning.app), in development the .replit.dev preview domain.
 */
function inviteRedirectUrl(): string {
  if (process.env.REPLIT_DEPLOYMENT === "1") {
    const host = process.env.PRODUCTION_HOST ?? "bookcleaning.app";
    return `https://${host}/`;
  }
  const devDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  return devDomain ? `https://${devDomain}/` : "https://bookcleaning.app/";
}

/**
 * Send the invitation email via Clerk's backend invitations API. Failures
 * are reported to the caller (so the UI can show a note) but never block
 * invite creation — the pending-invite bootstrap works regardless.
 * Returns the Clerk invitation id so it can be revoked if the dispatcher
 * invite is later removed.
 */
export async function sendInviteEmail(
  email: string,
): Promise<{ sent: boolean; invitationId: string | null }> {
  try {
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: inviteRedirectUrl(),
      notify: true,
      ignoreExisting: true,
    });
    return { sent: true, invitationId: invitation.id };
  } catch (err) {
    console.error(`[dispatchers] failed to send invite email to ${email}:`, err);
    return { sent: false, invitationId: null };
  }
}

/**
 * Revoke the Clerk invitation whose email link is out in the wild, so a
 * removed invite's sign-up link stops working. Best-effort: a failure is
 * logged and surfaced to the caller but does not undo the invite removal.
 */
export async function revokeInviteEmail(invitationId: string): Promise<boolean> {
  try {
    await clerkClient.invitations.revokeInvitation(invitationId);
    return true;
  } catch (err) {
    console.error(
      `[dispatchers] failed to revoke Clerk invitation ${invitationId}:`,
      err,
    );
    return false;
  }
}

/**
 * Persist the Clerk invitation id onto a pending invite as a state
 * transition: the conditional UPDATE only succeeds if the invite row still
 * exists unclaimed. If it does not (deleted or claimed concurrently while
 * the Clerk call was in flight) — or if the DB write itself fails — the
 * fresh Clerk invitation would become untracked and unrevocable, so it is
 * revoked immediately instead. Returns true iff the id was persisted.
 */
export async function attachClerkInvitation(
  inviteId: number,
  invitationId: string,
): Promise<boolean> {
  try {
    const updated = await db
      .update(dispatcherInvitesTable)
      .set({ clerkInvitationId: invitationId })
      .where(
        and(
          eq(dispatcherInvitesTable.id, inviteId),
          isNull(dispatcherInvitesTable.claimedAt),
        ),
      )
      .returning({ id: dispatcherInvitesTable.id });
    if (updated.length > 0) return true;
    console.warn(
      `[dispatchers] invite ${inviteId} vanished before Clerk invitation ${invitationId} could be attached — revoking the emailed link`,
    );
  } catch (err) {
    console.error(
      `[dispatchers] failed to persist Clerk invitation ${invitationId} on invite ${inviteId} — revoking the emailed link:`,
      err,
    );
  }
  await revokeInviteEmail(invitationId);
  return false;
}

// GET /dispatchers/invites — list pending (unclaimed) invites
router.get("/dispatchers/invites", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const rows = await db
    .select()
    .from(dispatcherInvitesTable)
    .where(isNull(dispatcherInvitesTable.claimedAt))
    .orderBy(dispatcherInvitesTable.createdAt);
  res.json(rows);
});

// POST /dispatchers/invites — add a dispatcher by name + email
router.post("/dispatchers/invites", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const nameRaw = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const name = nameRaw.slice(0, 100) || null;

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: "A valid email address is required" });
    return;
  }

  // If a Clerk account already owns this address VERIFIED, grant access now.
  let owner: { id: string } | undefined;
  try {
    const { data: owners } = await clerkClient.users.getUserList({
      emailAddress: [email],
    });
    owner = owners.find((u) =>
      u.emailAddresses.some(
        (e) =>
          e.emailAddress.toLowerCase() === email &&
          e.verification?.status === "verified",
      ),
    );
    if (owner) {
      const ownerId = owner.id;
      const [row] = await db
        .insert(dispatcherAllowlistTable)
        .values({ clerkUserId: ownerId })
        .onConflictDoNothing()
        .returning();
      // Close out any pending invite for this email either way, so a stale
      // invite can't re-grant access after a later revocation.
      await db
        .update(dispatcherInvitesTable)
        .set({ claimedAt: new Date(), claimedClerkUserId: ownerId })
        .where(
          and(
            sql`lower(${dispatcherInvitesTable.email}) = ${email}`,
            isNull(dispatcherInvitesTable.claimedAt),
          ),
        );
      if (!row) {
        res.status(409).json({ error: "This person is already a dispatcher" });
        return;
      }
      res.status(201).json({ mode: "granted" });
      return;
    }
  } catch (err) {
    console.error("[dispatchers] Clerk email lookup failed:", err);
    res.status(502).json({ error: "Couldn't check existing accounts — please try again" });
    return;
  }

  // No account with that verified email yet — store a pending invite.
  try {
    const [invite] = await db
      .insert(dispatcherInvitesTable)
      .values({ email, name })
      .returning();
    // Email the invitee a sign-up link. A send failure never blocks the
    // invite itself — access still bootstraps when they sign up manually.
    const { sent, invitationId } = await sendInviteEmail(email);
    let emailSent = sent;
    if (invitationId) {
      // Remember the Clerk invitation so removing this invite also revokes
      // the emailed sign-up link. If the invite was already deleted/claimed
      // concurrently (or the write fails), the invitation is revoked instead
      // of being left as an untracked live link.
      const attached = await attachClerkInvitation(invite.id, invitationId);
      if (attached) {
        invite.clerkInvitationId = invitationId;
      } else {
        emailSent = false;
      }
    }
    res.status(201).json({ mode: "invited", invite, emailSent });
  } catch (err: any) {
    const code = err?.code ?? err?.cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "This email has already been invited" });
      return;
    }
    throw err;
  }
});

// DELETE /dispatchers/invites/:id — revoke a pending invite
router.delete("/dispatchers/invites/:id", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid invite id" });
    return;
  }

  const deleted = await db
    .delete(dispatcherInvitesTable)
    .where(and(eq(dispatcherInvitesTable.id, id), isNull(dispatcherInvitesTable.claimedAt)))
    .returning({
      id: dispatcherInvitesTable.id,
      clerkInvitationId: dispatcherInvitesTable.clerkInvitationId,
    });

  if (deleted.length === 0) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  // Also revoke the emailed Clerk sign-up link, if one was sent. Even if
  // revocation fails, no dispatcher access can leak — the pending-invite row
  // is gone, so the bootstrap in callerRole.ts will not grant anything — but
  // the recipient could still create a plain account from the stale link, so
  // we surface the failure to the UI.
  let emailRevoked = true;
  const invitationId = deleted[0].clerkInvitationId;
  if (invitationId) {
    emailRevoked = await revokeInviteEmail(invitationId);
  }
  res.json({ ok: true, emailRevoked });
});

// POST /dispatchers — grant dispatcher access to a Clerk user
router.post("/dispatchers", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const clerkUserId = typeof req.body?.clerkUserId === "string" ? req.body.clerkUserId.trim() : "";
  if (!clerkUserId) {
    res.status(400).json({ error: "clerkUserId is required" });
    return;
  }

  // Verify the user actually exists in Clerk before granting access
  try {
    await clerkClient.users.getUser(clerkUserId);
  } catch {
    res.status(404).json({ error: "No Clerk user found with that ID" });
    return;
  }

  const [row] = await db
    .insert(dispatcherAllowlistTable)
    .values({ clerkUserId })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    res.status(409).json({ error: "This user is already a dispatcher" });
    return;
  }

  res.status(201).json(row);
});

// DELETE /dispatchers/:clerkUserId — revoke dispatcher access
router.delete("/dispatchers/:clerkUserId", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const { clerkUserId } = req.params;

  // Prevent removing the last dispatcher, so no one can lock everyone out.
  // The check and delete run in one transaction with all allowlist rows locked
  // (SELECT ... FOR UPDATE), so two concurrent revocations serialize: the
  // second waits for the first to commit, then re-reads and sees the updated
  // count. It is therefore impossible for concurrent requests to empty the table.
  const outcome = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ clerkUserId: dispatcherAllowlistTable.clerkUserId })
      .from(dispatcherAllowlistTable)
      .for("update");

    const exists = rows.some((r) => r.clerkUserId === clerkUserId);
    if (!exists) return "not_found" as const;
    if (rows.length <= 1) return "last_dispatcher" as const;

    await tx
      .delete(dispatcherAllowlistTable)
      .where(eq(dispatcherAllowlistTable.clerkUserId, clerkUserId));
    return "deleted" as const;
  });

  if (outcome === "not_found") {
    res.status(404).json({ error: "This user is not a dispatcher" });
    return;
  }
  if (outcome === "last_dispatcher") {
    res.status(409).json({
      error: "Cannot remove the last dispatcher — add another dispatcher first.",
    });
    return;
  }

  const callerId = getAuth(req)?.userId;
  res.json({ ok: true, removedSelf: callerId === clerkUserId });
});

export default router;

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import { db, dispatcherAllowlistTable } from "@workspace/db";
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
  imageUrl: string | null;
};

function summarizeClerkUser(u: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string;
  emailAddresses: { id: string; emailAddress: string }[];
  primaryEmailAddressId: string | null;
}): ClerkUserSummary {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
  const primaryEmail =
    u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
    u.emailAddresses[0]?.emailAddress ??
    null;
  return { clerkUserId: u.id, name, email: primaryEmail, imageUrl: u.imageUrl || null };
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

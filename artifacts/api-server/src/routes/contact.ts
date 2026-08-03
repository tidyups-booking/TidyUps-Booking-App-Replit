import { Router, type IRouter } from "express";
import { db, contactMessagesTable } from "@workspace/db";
import {
  SubmitContactMessageBody,
  SubmitContactMessageResponse,
  ListContactMessagesResponse,
  UpdateContactMessageBody,
  UpdateContactMessageResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger.js";
import { desc, eq, sql } from "drizzle-orm";
import { guardDispatcher } from "../lib/callerRole.js";

const router: IRouter = Router();

export const contactMessagesRouter: IRouter = Router();

// --- Per-IP rate limiting for the public contact form -----------------------
// Sliding window backed by the contact_form_throttle table: max
// MAX_SUBMISSIONS per WINDOW_MINUTES per IP. Storing attempts in Postgres
// keeps the limit consistent across restarts and multiple server instances.
const WINDOW_MINUTES = 10;
const MAX_SUBMISSIONS = 5;

/**
 * Checks the sliding window and records this attempt.
 * A per-IP advisory transaction lock serializes concurrent admissions for the
 * same IP (even across server instances), so a burst of parallel requests
 * cannot slip past the limit via a check-then-insert race. The lock is
 * released automatically when the transaction commits or rolls back.
 * Returns true when the request should be rejected with 429.
 */
async function isRateLimited(ip: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended('contact_form_throttle:' || ${ip}, 0))`,
    );
    const counted = await tx.execute(sql`
      SELECT count(*)::int AS c
      FROM contact_form_throttle
      WHERE ip = ${ip}
        AND submitted_at > now() - make_interval(mins => ${WINDOW_MINUTES})
    `);
    const recent = Number((counted.rows[0] as { c: number }).c);
    if (recent >= MAX_SUBMISSIONS) return true;
    await tx.execute(
      sql`INSERT INTO contact_form_throttle (ip) VALUES (${ip})`,
    );
    return false;
  });
}

// Periodically prune throttle rows older than the window so the table can't
// grow unbounded. Multiple instances running this concurrently is harmless.
setInterval(
  () => {
    db.execute(
      sql`DELETE FROM contact_form_throttle
          WHERE submitted_at < now() - make_interval(mins => ${WINDOW_MINUTES})`,
    ).catch((err) => {
      logger.warn({ err }, "failed to prune contact_form_throttle");
    });
  },
  5 * 60 * 1000,
).unref();

// POST /contact — public (no auth): contact form on the public Contact page.
// Messages are captured server-side only; no email delivery for now.
router.post("/contact", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (await isRateLimited(ip)) {
    res.status(429).json({
      error:
        "Too many messages sent from this connection. Please wait a few minutes and try again, or call us directly.",
    });
    return;
  }

  const parsed = SubmitContactMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const name = parsed.data.name.trim();
  const email = parsed.data.email.trim();
  const message = parsed.data.message.trim();
  const phone = parsed.data.phone?.trim() || null;

  // Honeypot: the hidden "website" field is invisible to humans; anything
  // filling it is a bot. Pretend success so bots don't learn to adapt,
  // but don't persist the message.
  if (parsed.data.website && parsed.data.website.trim() !== "") {
    logger.info({ ip }, "contact form honeypot triggered; dropping submission");
    res.status(201).json(
      SubmitContactMessageResponse.parse({
        id: 0,
        name,
        email,
        phone,
        message,
        createdAt: new Date(),
        handledAt: null,
      }),
    );
    return;
  }

  if (!name || !message) {
    res.status(400).json({ error: "Name and message are required" });
    return;
  }

  const [row] = await db
    .insert(contactMessagesTable)
    .values({ name, email, phone, message })
    .returning();

  res.status(201).json(SubmitContactMessageResponse.parse(row));
});

// --- Dispatcher inbox routes (authenticated) ---------------------------------

// GET /contact/messages — paginated list of contact messages, newest first.
// Returns { messages, total, newCount } so the new-message count stays
// accurate regardless of which page is loaded.
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

contactMessagesRouter.get(
  "/contact/messages",
  async (req, res): Promise<void> => {
    if (await guardDispatcher(req, res)) return;

    const rawLimit = Number(req.query.limit);
    const rawOffset = Number(req.query.offset);
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE;
    const offset =
      Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const [rows, counts] = await Promise.all([
      db
        .select()
        .from(contactMessagesTable)
        .orderBy(
          desc(contactMessagesTable.createdAt),
          desc(contactMessagesTable.id),
        )
        .limit(limit)
        .offset(offset),
      db
        .select({
          total: sql<number>`count(*)::int`,
          newCount: sql<number>`count(*) FILTER (WHERE ${contactMessagesTable.handledAt} IS NULL)::int`,
        })
        .from(contactMessagesTable),
    ]);

    res.json(
      ListContactMessagesResponse.parse({
        messages: rows,
        total: counts[0]?.total ?? 0,
        newCount: counts[0]?.newCount ?? 0,
      }),
    );
  },
);

// PATCH /contact/messages/:id — mark a message handled or unhandled.
contactMessagesRouter.patch(
  "/contact/messages/:id",
  async (req, res): Promise<void> => {
    if (await guardDispatcher(req, res)) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid message id" });
      return;
    }

    const parsed = UpdateContactMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [row] = await db
      .update(contactMessagesTable)
      .set({ handledAt: parsed.data.handled ? new Date() : null })
      .where(eq(contactMessagesTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    res.json(UpdateContactMessageResponse.parse(row));
  },
);

// DELETE /contact/messages/:id — remove a message.
contactMessagesRouter.delete(
  "/contact/messages/:id",
  async (req, res): Promise<void> => {
    if (await guardDispatcher(req, res)) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid message id" });
      return;
    }

    const [row] = await db
      .delete(contactMessagesTable)
      .where(eq(contactMessagesTable.id, id))
      .returning({ id: contactMessagesTable.id });

    if (!row) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    res.status(204).end();
  },
);

export default router;

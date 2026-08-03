import { Router, type IRouter } from "express";
import { db, contactMessagesTable } from "@workspace/db";
import {
  SubmitContactMessageBody,
  SubmitContactMessageResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// --- Per-IP rate limiting for the public contact form -----------------------
// Simple in-memory sliding window: max MAX_SUBMISSIONS per WINDOW_MS per IP.
// In-memory is fine here — worst case a restart resets the counters.
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SUBMISSIONS = 5;
const submissionsByIp = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const timestamps = (submissionsByIp.get(ip) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= MAX_SUBMISSIONS) {
    submissionsByIp.set(ip, timestamps);
    return true;
  }
  timestamps.push(now);
  submissionsByIp.set(ip, timestamps);
  return false;
}

// Periodically prune stale IP entries so the map can't grow unbounded.
setInterval(
  () => {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [ip, timestamps] of submissionsByIp) {
      const recent = timestamps.filter((t) => t > cutoff);
      if (recent.length === 0) submissionsByIp.delete(ip);
      else submissionsByIp.set(ip, recent);
    }
  },
  5 * 60 * 1000,
).unref();

// POST /contact — public (no auth): contact form on the public Contact page.
// Messages are captured server-side only; no email delivery for now.
router.post("/contact", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (isRateLimited(ip)) {
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

export default router;

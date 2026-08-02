/**
 * Twilio Voice Webhook Authentication
 *
 * Protects POST /api/twilio/voice so that only requests carrying a valid
 * `?sig=<derived-token>` can obtain a one-time WebSocket stream token.
 *
 * The token is derived deterministically from SESSION_SECRET:
 *   derived = HMAC-SHA256(SESSION_SECRET, "twilio-webhook-auth-v1") → hex
 *
 * The dispatcher configures their Twilio Phone Number webhook URL to include
 * this parameter, e.g.:
 *   https://<domain>/api/twilio/voice?sig=<derived>
 *
 * Use GET /api/twilio/webhook-url (authenticated) to retrieve the full URL
 * with the correct `?sig=` value already appended.
 */

import crypto from "crypto";
import type { RequestHandler, Request } from "express";
import { logger } from "../lib/logger.js";
import { getClerkProxyHost } from "./clerkProxyMiddleware.js";

/** Derive the stable webhook sig token from SESSION_SECRET. Returns null if
 *  SESSION_SECRET is not configured (so callers can fail-secure). */
export function getDerivedWebhookSig(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return crypto
    .createHmac("sha256", secret)
    .update("twilio-webhook-auth-v1")
    .digest("hex");
}

/** Construct the full voice webhook URL including the ?sig= parameter.
 *  Returns null when SESSION_SECRET is absent. */
export function getVoiceWebhookUrl(req: Request): string | null {
  const sig = getDerivedWebhookSig();
  if (!sig) return null;
  const host = getClerkProxyHost(req) ?? process.env.REPLIT_DEV_DOMAIN;
  if (!host) return null;
  return `https://${host}/api/twilio/voice?sig=${sig}`;
}

/**
 * Express middleware: requires `?sig=<derived-token>` on the request.
 * If SESSION_SECRET is not configured the request is rejected with 503
 * (fail-secure: unconfigured is worse than broken).
 */
export const requireTwilioWebhookAuth: RequestHandler = (req, res, next) => {
  const derived = getDerivedWebhookSig();

  if (!derived) {
    logger.error("SESSION_SECRET is not configured — Twilio webhook auth cannot be validated");
    res.status(503).send("Webhook authentication not configured");
    return;
  }

  const provided = typeof req.query.sig === "string" ? req.query.sig : "";

  let valid = false;
  try {
    // Only compare buffers of equal length to avoid timing oracle
    if (provided.length === derived.length) {
      valid = crypto.timingSafeEqual(
        Buffer.from(provided, "hex"),
        Buffer.from(derived, "hex"),
      );
    }
  } catch {
    valid = false;
  }

  if (!valid) {
    logger.warn(
      { ip: req.ip, userAgent: req.headers["user-agent"] },
      "Twilio voice webhook rejected: missing or invalid sig parameter",
    );
    res.status(401).send("Unauthorized: invalid webhook signature");
    return;
  }

  next();
};

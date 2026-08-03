/**
 * Stream tokens for Twilio WebSocket authentication.
 *
 * Flow:
 *   1. POST /api/twilio/voice → calls issueStreamToken() → gets a token
 *   2. Token is embedded in the TwiML <Stream url="wss://host/api/twilio/stream?token=…">
 *   3. Twilio connects the WebSocket and passes the token in the query string
 *   4. WebSocket upgrade handler calls consumeStreamToken(token)
 *
 * Tokens are stateless HMAC signatures (keyed with SESSION_SECRET) over an
 * expiry timestamp, so validation works even when the webhook that issued the
 * token and the WebSocket upgrade land on DIFFERENT server instances (the
 * production deployment is autoscale). Tokens expire after TOKEN_TTL_MS.
 */

import crypto from "crypto";
import { logger } from "../lib/logger.js";

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function signingKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to issue stream tokens");
  return crypto.createHmac("sha256", secret).update("twilio-stream-token").digest();
}

function sign(expiry: number): string {
  return crypto.createHmac("sha256", signingKey()).update(String(expiry)).digest("hex");
}

/** Generate a stream token valid for TOKEN_TTL_MS on any server instance. */
export function issueStreamToken(): string {
  const expiry = Date.now() + TOKEN_TTL_MS;
  const token = `${expiry}.${sign(expiry)}`;
  logger.debug({ expiry }, "Stream token issued");
  return token;
}

/**
 * Validate a stream token: signature must match and expiry must be in the
 * future. Stateless, so any instance can validate a token issued by another.
 */
export function consumeStreamToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiry = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(expiry)) return false;
  if (expiry < Date.now()) {
    logger.warn("Stream token expired");
    return false;
  }
  const expected = sign(expiry);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    logger.warn("Stream token signature mismatch");
    return false;
  }
  logger.debug("Stream token accepted");
  return true;
}

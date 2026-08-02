/**
 * One-time stream tokens for Twilio WebSocket authentication.
 *
 * Flow:
 *   1. POST /api/twilio/voice → calls issueStreamToken() → gets a token
 *   2. Token is embedded in the TwiML <Stream url="wss://host/api/twilio/stream?token=…">
 *   3. Twilio connects the WebSocket and passes the token in the query string
 *   4. WebSocket upgrade handler calls consumeStreamToken(token) — returns true only once
 *
 * Tokens expire after TOKEN_TTL_MS and are single-use.
 */

import crypto from "crypto";
import { logger } from "../lib/logger.js";

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Map of token → expiry timestamp (ms)
const pendingTokens = new Map<string, number>();

// Prune expired tokens periodically so the map doesn't grow unboundedly
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of pendingTokens) {
    if (expiry < now) pendingTokens.delete(token);
  }
}, 60_000);

/** Generate a new one-time stream token and store it with a TTL. */
export function issueStreamToken(): string {
  const token = crypto.randomBytes(32).toString("hex");
  pendingTokens.set(token, Date.now() + TOKEN_TTL_MS);
  logger.debug({ tokenPrefix: token.slice(0, 8) }, "Stream token issued");
  return token;
}

/**
 * Validate and consume a stream token.
 * Returns true only if the token exists and has not expired.
 * Removes the token on success so it cannot be reused.
 */
export function consumeStreamToken(token: string | undefined): boolean {
  if (!token) return false;
  const expiry = pendingTokens.get(token);
  if (expiry === undefined) {
    logger.warn({ tokenPrefix: token.slice(0, 8) }, "Stream token not found");
    return false;
  }
  if (expiry < Date.now()) {
    pendingTokens.delete(token);
    logger.warn({ tokenPrefix: token.slice(0, 8) }, "Stream token expired");
    return false;
  }
  pendingTokens.delete(token);
  logger.debug({ tokenPrefix: token.slice(0, 8) }, "Stream token consumed");
  return true;
}

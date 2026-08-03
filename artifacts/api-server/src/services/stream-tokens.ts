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
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function signingKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to issue stream tokens");
  return crypto.createHmac("sha256", secret).update("twilio-stream-token").digest();
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", signingKey()).update(payload).digest("hex");
}

/** Generate a stream token valid for TOKEN_TTL_MS on any server instance.
 *  Includes a random nonce so two tokens issued in the same millisecond are
 *  still distinct (single-use enforcement keys on the signature). */
export function issueStreamToken(): string {
  const expiry = Date.now() + TOKEN_TTL_MS;
  const nonce = crypto.randomBytes(16).toString("hex");
  const token = `${expiry}.${nonce}.${sign(`${expiry}.${nonce}`)}`;
  logger.debug({ expiry }, "Stream token issued");
  return token;
}

/**
 * Validate AND consume a stream token. Signature must match, expiry must be
 * in the future, and the token must never have been used before — consumption
 * is recorded in the shared `stream_token_uses` table so single-use holds
 * across ALL autoscale instances (a replayed token is rejected everywhere).
 */
export async function consumeStreamToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiryStr, nonce, sig] = parts;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || !/^[0-9a-f]{32}$/.test(nonce)) return false;
  if (expiry < Date.now()) {
    logger.warn("Stream token expired");
    return false;
  }
  const expected = sign(`${expiryStr}.${nonce}`);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    logger.warn("Stream token signature mismatch");
    return false;
  }

  // Signature is valid — now enforce single use across instances.
  // Fail closed: if the DB is unreachable we reject rather than risk replay.
  try {
    // Opportunistic cleanup (tokens are rare — one per call — so this is cheap).
    await pool.query(`DELETE FROM stream_token_uses WHERE expires_at < now()`);
    const result = await pool.query(
      `INSERT INTO stream_token_uses (token_sig, expires_at)
       VALUES ($1, to_timestamp($2 / 1000.0))
       ON CONFLICT (token_sig) DO NOTHING`,
      [sig, expiry],
    );
    if (result.rowCount === 0) {
      logger.warn("Stream token replay rejected (already consumed)");
      return false;
    }
  } catch (err) {
    logger.error({ err }, "Stream token consumption failed (DB error) — rejecting");
    return false;
  }

  logger.debug("Stream token accepted");
  return true;
}

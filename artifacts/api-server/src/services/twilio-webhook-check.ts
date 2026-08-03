/**
 * Twilio voice-webhook drift monitor.
 *
 * The live-call flow once broke silently because the Twilio number's voice
 * webhook was pointed at a temporary dev preview URL instead of the production
 * site. Nothing surfaced this — calls just stopped popping the panel.
 *
 * This service reads the voice webhook configured on the inbound Twilio number
 * via the Twilio REST API (through the Replit Twilio connection) and compares
 * it with the expected production URL:
 *
 *   https://<PRODUCTION_HOST>/api/twilio/voice?sig=<derived>
 *
 * It exposes:
 *  - checkTwilioWebhookNow()      — run a fresh check, cache + return the result
 *  - getLastWebhookCheck()        — last cached result (may be null)
 *  - fixTwilioWebhook()           — re-point the webhook at production, re-check
 *  - startTwilioWebhookMonitor()  — periodic background check that logs loudly
 *                                   on drift so it shows up in production logs
 */

import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "../lib/logger.js";
import { getDerivedWebhookSig } from "../middlewares/twilioWebhookAuth.js";

/** Production host the webhook must point at. */
const PRODUCTION_HOST = process.env.PRODUCTION_HOST ?? "bookcleaning.app";

/** The inbound Twilio number whose webhook we monitor: (825) 533-4317. */
const INBOUND_NUMBER = process.env.TWILIO_INBOUND_NUMBER ?? "+18255334317";

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const INITIAL_DELAY_MS = 20 * 1000;

export interface WebhookCheckResult {
  /** true when the configured voice webhook exactly matches the expected production URL */
  ok: boolean;
  /** why the check is not ok (undefined when ok) */
  reason?: "mismatch" | "number_not_found" | "twilio_error" | "not_configured";
  phoneNumber: string;
  /** URL currently configured on the Twilio number (null if unavailable) */
  configuredUrl: string | null;
  /** URL the number should point at (null if SESSION_SECRET missing) */
  expectedUrl: string | null;
  checkedAt: string;
  error?: string;
}

/** Build the expected production voice webhook URL. Null when SESSION_SECRET is absent. */
export function getExpectedProductionVoiceUrl(): string | null {
  const sig = getDerivedWebhookSig();
  if (!sig) return null;
  return `https://${PRODUCTION_HOST}/api/twilio/voice?sig=${sig}`;
}

// ---------------------------------------------------------------------------
// Twilio REST access via the Replit Twilio connection.
// Never cache the client — connector tokens expire.
// ---------------------------------------------------------------------------

async function twilioProxy(path: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
  const connectors = new ReplitConnectors();
  return connectors.proxy("twilio", path, { method: "GET", ...init });
}

// The account SID is stable for the lifetime of the Twilio account, so it is
// safe to memoize (unlike auth tokens).
let cachedAccountSid: string | null = null;

async function getAccountSid(): Promise<string> {
  if (cachedAccountSid) return cachedAccountSid;
  const res = await twilioProxy("/2010-04-01/Accounts.json");
  if (!res.ok) {
    throw new Error(`Twilio Accounts.json returned ${res.status}`);
  }
  const data = (await res.json()) as { accounts?: Array<{ sid?: string }> };
  const sid = data.accounts?.[0]?.sid;
  if (!sid) throw new Error("No Twilio account found on the connection");
  cachedAccountSid = sid;
  return sid;
}

interface IncomingNumber {
  sid: string;
  phone_number: string;
  voice_url: string | null;
  voice_method: string | null;
}

async function findInboundNumber(): Promise<IncomingNumber | null> {
  const accountSid = await getAccountSid();
  const qs = new URLSearchParams({ PhoneNumber: INBOUND_NUMBER });
  const res = await twilioProxy(
    `/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?${qs}`,
  );
  if (!res.ok) {
    throw new Error(`Twilio IncomingPhoneNumbers returned ${res.status}`);
  }
  const data = (await res.json()) as { incoming_phone_numbers?: IncomingNumber[] };
  return data.incoming_phone_numbers?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Check + fix
// ---------------------------------------------------------------------------

let lastResult: WebhookCheckResult | null = null;

export function getLastWebhookCheck(): WebhookCheckResult | null {
  return lastResult;
}

export async function checkTwilioWebhookNow(): Promise<WebhookCheckResult> {
  const checkedAt = new Date().toISOString();
  const expectedUrl = getExpectedProductionVoiceUrl();

  let result: WebhookCheckResult;

  if (!expectedUrl) {
    result = {
      ok: false,
      reason: "not_configured",
      phoneNumber: INBOUND_NUMBER,
      configuredUrl: null,
      expectedUrl: null,
      checkedAt,
      error: "SESSION_SECRET is not configured — cannot derive the expected webhook URL",
    };
  } else {
    try {
      const number = await findInboundNumber();
      if (!number) {
        result = {
          ok: false,
          reason: "number_not_found",
          phoneNumber: INBOUND_NUMBER,
          configuredUrl: null,
          expectedUrl,
          checkedAt,
          error: `Twilio number ${INBOUND_NUMBER} was not found on the connected account`,
        };
      } else {
        const configuredUrl = number.voice_url ?? null;
        const ok = configuredUrl === expectedUrl && (number.voice_method ?? "POST").toUpperCase() === "POST";
        result = {
          ok,
          ...(ok ? {} : { reason: "mismatch" as const }),
          phoneNumber: INBOUND_NUMBER,
          configuredUrl,
          expectedUrl,
          checkedAt,
        };
      }
    } catch (err) {
      result = {
        ok: false,
        reason: "twilio_error",
        phoneNumber: INBOUND_NUMBER,
        configuredUrl: null,
        expectedUrl,
        checkedAt,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  lastResult = result;
  return result;
}

/**
 * Re-point the Twilio number's voice webhook at the production URL, then
 * re-run the check. Throws when the fix cannot be applied.
 */
export async function fixTwilioWebhook(): Promise<WebhookCheckResult> {
  const expectedUrl = getExpectedProductionVoiceUrl();
  if (!expectedUrl) {
    throw new Error("SESSION_SECRET is not configured — cannot derive the production webhook URL");
  }
  const number = await findInboundNumber();
  if (!number) {
    throw new Error(`Twilio number ${INBOUND_NUMBER} was not found on the connected account`);
  }
  const accountSid = await getAccountSid();
  const body = new URLSearchParams({ VoiceUrl: expectedUrl, VoiceMethod: "POST" });
  const res = await twilioProxy(
    `/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${number.sid}.json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio update failed (${res.status}): ${text.slice(0, 200)}`);
  }
  logger.info({ phoneNumber: INBOUND_NUMBER }, "Twilio voice webhook re-pointed at production");
  return checkTwilioWebhookNow();
}

// ---------------------------------------------------------------------------
// Background monitor
// ---------------------------------------------------------------------------

let monitorStarted = false;

export function startTwilioWebhookMonitor(): void {
  if (monitorStarted) return;
  monitorStarted = true;

  const tick = async () => {
    try {
      const result = await checkTwilioWebhookNow();
      if (!result.ok) {
        logger.error(
          {
            phoneNumber: result.phoneNumber,
            reason: result.reason,
            configuredUrl: result.configuredUrl,
            error: result.error,
          },
          "TWILIO WEBHOOK DRIFT — the phone number's voice webhook does not point at the live site; incoming calls will not reach the live-call panel",
        );
      } else {
        logger.debug({ phoneNumber: result.phoneNumber }, "Twilio voice webhook check OK");
      }
    } catch (err) {
      logger.error({ err }, "Twilio webhook monitor tick failed");
    }
  };

  setTimeout(tick, INITIAL_DELAY_MS).unref();
  setInterval(tick, CHECK_INTERVAL_MS).unref();
  logger.info(
    { intervalMs: CHECK_INTERVAL_MS, phoneNumber: INBOUND_NUMBER },
    "Twilio webhook drift monitor started",
  );
}

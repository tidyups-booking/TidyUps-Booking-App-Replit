import { Router } from "express";
import {
  getStoredTokens,
  exchangeCodeForTokens,
  getCallbackUrl,
  syncBookingToJobber,
} from "../services/jobber.js";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware.js";
import { requireAuth } from "../app.js";
import { db } from "@workspace/db";
import { bookingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireDispatcherAuth } from "../lib/callerRole.js";
import { randomBytes } from "crypto";
import { runCalendarSync, getAutoSyncStatus } from "../services/jobberCalendarSync.js";

const router = Router();

const JOBBER_AUTH_URL = "https://api.getjobber.com/api/oauth/authorize";

/**
 * Short-lived in-memory store of valid OAuth state nonces.
 * Each entry expires after 10 minutes — more than enough for the OAuth handshake.
 * Using a module-level Map keeps this simple without requiring an extra DB table.
 */
const pendingOAuthStates = new Map<string, number>(); // state → expiry timestamp (ms)

// GET /jobber/redirect-uri — returns the current OAuth callback URL so the
// frontend can display it for copy-paste into the Jobber developer portal
router.get("/jobber/redirect-uri", (req, res) => {
  try {
    res.json({ redirectUri: getCallbackUrl(getClerkProxyHost(req)) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /jobber/status — check whether Jobber is connected
router.get("/jobber/status", async (_req, res) => {
  try {
    const tokens = await getStoredTokens();
    if (!tokens) {
      res.json({ connected: false });
      return;
    }
    // Token exists — check it hasn't expired
    const expired = tokens.expiresAt && tokens.expiresAt < new Date();
    if (expired) {
      res.json({ connected: false, stale: true });
      return;
    }
    res.json({ connected: true, autoSync: getAutoSyncStatus() });
  } catch (err: any) {
    res.json({ connected: false, error: err.message });
  }
});

// GET /jobber/auth — kick off OAuth (dispatcher only)
router.get("/jobber/auth", async (req, res) => {
  if (await requireDispatcherAuth(req, res)) return;
  const clientId = process.env.JOBBER_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: "JOBBER_CLIENT_ID not configured" });
    return;
  }

  const callbackUrl = getCallbackUrl(getClerkProxyHost(req));
  const state = generateOAuthState();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "read_clients write_clients read_jobs write_jobs",
    state,
  });

  res.redirect(`${JOBBER_AUTH_URL}?${params.toString()}`);
});

// GET /jobber/callback — Jobber redirects here with ?code=
router.get("/jobber/callback", async (req, res) => {
  req.log.info({ query: req.query }, "Jobber OAuth callback received");
  const { code, error, error_description, state } = req.query as {
    code?: string;
    error?: string;
    error_description?: string;
    state?: string;
  };

  if (error) {
    const reason = error_description ? `${error}: ${error_description}` : error;
    req.log.warn({ error, error_description }, "Jobber OAuth error");
    res.redirect(`/?jobber=error&reason=${encodeURIComponent(reason ?? "unknown")}`);
    return;
  }

  // state is required — a missing or invalid nonce means the callback did not
  // originate from this server's /jobber/auth flow (CSRF / callback injection).
  if (!state || typeof state !== "string" || !consumeOAuthState(state)) {
    req.log.warn({ state }, "Jobber OAuth: missing or invalid state nonce — callback rejected");
    res.status(400).send("<h2>OAuth state mismatch — please try connecting again.</h2>");
    return;
  }

  if (!code) {
    // Show a helpful page instead of blank 400
    const allParams = JSON.stringify(req.query, null, 2);
    res.status(400).send(`
      <h2>Jobber callback — no code received</h2>
      <p>Jobber redirected here but did not include an authorization code.</p>
      <p>This usually means the <strong>redirect URI</strong> in your Jobber app doesn't match exactly.</p>
      <p>Make sure your Jobber developer app has this redirect URI registered:</p>
      <code>https://${getClerkProxyHost(req)}${req.path}</code>
      <p>Raw query params received: <pre>${allParams}</pre></p>
    `);
    return;
  }

  try {
    const redirectUri = getCallbackUrl(getClerkProxyHost(req));
    await exchangeCodeForTokens(code, redirectUri);
    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Jobber Connected</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;
       justify-content:center;height:100vh;margin:0;background:#f0fdf4;color:#166534}
  .box{text-align:center;padding:2rem;border-radius:1rem;background:#dcfce7;
       border:1px solid #bbf7d0;max-width:320px}
  h2{margin:0 0 .5rem}p{margin:0;font-size:.9rem;color:#4b7c5d}
</style>
</head>
<body>
<div class="box">
  <h2>✓ Jobber Connected</h2>
  <p>This tab will close automatically…</p>
</div>
<script>
  try {
    const ch = new BroadcastChannel("jobber_oauth");
    ch.postMessage({ type: "connected" });
    ch.close();
  } catch (_) {}
  try {
    localStorage.setItem("jobber_oauth_signal", Date.now().toString());
  } catch (_) {}
  setTimeout(() => window.close(), 1200);
</script>
</body>
</html>`);
  } catch (err: any) {
    req.log.error({ err: err.message }, "Jobber OAuth callback error");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Jobber Error</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;
       justify-content:center;height:100vh;margin:0;background:#fef2f2;color:#991b1b}
  .box{text-align:center;padding:2rem;border-radius:1rem;background:#fee2e2;
       border:1px solid #fecaca;max-width:360px}
  h2{margin:0 0 .5rem}p{margin:0;font-size:.85rem;color:#7f1d1d;word-break:break-word}
</style>
</head>
<body>
<div class="box">
  <h2>⚠ Jobber connection failed</h2>
  <p>${err.message}</p>
  <p style="margin-top:.75rem">You can close this tab and try again.</p>
</div>
<script>
  try {
    const ch = new BroadcastChannel("jobber_oauth");
    ch.postMessage({ type: "error", reason: ${JSON.stringify(err.message)} });
    ch.close();
  } catch (_) {}
  try {
    localStorage.setItem("jobber_oauth_signal", "error:" + Date.now());
  } catch (_) {}
</script>
</body>
</html>`);
  }
});

// POST /jobber/sync/:bookingId — manually sync one booking to Jobber (dispatcher only)
router.post("/jobber/sync/:bookingId", async (req, res) => {
  if (await requireDispatcherAuth(req, res)) return;
  const bookingId = Number(req.params.bookingId);
  if (isNaN(bookingId)) {
    res.status(400).json({ error: "Invalid booking ID" });
    return;
  }

  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId));

  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  // Mark as pending before attempting
  await db
    .update(bookingsTable)
    .set({ jobberSyncStatus: "pending", jobberSyncError: null })
    .where(eq(bookingsTable.id, bookingId));

  try {
    const jobberRequestId = await syncBookingToJobber(booking);

    // Store the Jobber ID and mark as synced
    await db
      .update(bookingsTable)
      .set({ jobberJobId: jobberRequestId, jobberSyncStatus: "synced", jobberSyncError: null })
      .where(eq(bookingsTable.id, bookingId));

    res.json({ success: true, jobberRequestId });
  } catch (err: any) {
    // Persist the failure so the UI can surface it
    await db
      .update(bookingsTable)
      .set({ jobberSyncStatus: "failed", jobberSyncError: err.message })
      .where(eq(bookingsTable.id, bookingId));

    req.log.warn({ bookingId, err: err.message }, "Jobber sync failed");
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true only if the string is a real calendar date in YYYY-MM-DD format.
 * Rejects impossible dates like 2025-02-31 by round-tripping through Date.
 */
function isRealCalendarDate(s: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) return false;
  const d = new Date(s + "T12:00:00Z"); // noon UTC avoids timezone day-shift
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ---------------------------------------------------------------------------
// POST /jobber/sync-calendar
// Body: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
//
// Requires authentication (dispatcher/admin). Uses POST because it has
// write side-effects (upserts booking records).
//
// Pulls Jobber JOBS filtered by scheduledBetween. Jobs carry startAt — the
// actual scheduled appointment date/time — and are the correct entity for
// populating calendar views. (Our outbound sync creates Jobber requests via
// requestCreate; those requests become jobs once scheduled in Jobber. Any
// work created directly in Jobber also arrives here as a job.)
//
// Max sync window: 93 days. Results are complete within that window (up to
// 5 pages × 100 jobs = 500 jobs); if a page boundary is hit the response
// includes a warning so the caller knows to narrow the range.
//
// Insert vs update is determined by a pre-SELECT of existing jobberJobIds,
// avoiding reliance on implementation-specific rowCount behaviour.
//
// Uses America/Edmonton timezone for correct DST-aware date boundaries.
// Jobber API errors are logged server-side; clients receive only a generic msg.
// ---------------------------------------------------------------------------

/** Max allowed sync window in days. Keeps results complete within 500 jobs. */
const MAX_SYNC_DAYS = 93;

router.post("/jobber/sync-calendar", requireAuth, async (req, res) => {
  const startDate =
    typeof req.body?.startDate === "string" ? req.body.startDate.trim() : null;
  const endDate =
    typeof req.body?.endDate === "string" ? req.body.endDate.trim() : null;

  if (!startDate || !endDate) {
    res.status(400).json({ error: "startDate and endDate are required" });
    return;
  }
  if (!isRealCalendarDate(startDate) || !isRealCalendarDate(endDate)) {
    res.status(400).json({ error: "Dates must be valid calendar dates in YYYY-MM-DD format" });
    return;
  }
  if (startDate > endDate) {
    res.status(400).json({ error: "startDate must be on or before endDate" });
    return;
  }

  // Enforce max window so results are always complete
  const dayDiff =
    (new Date(endDate).getTime() - new Date(startDate).getTime()) /
    (1000 * 60 * 60 * 24);
  if (dayDiff > MAX_SYNC_DAYS) {
    res.status(400).json({
      error: `Sync window cannot exceed ${MAX_SYNC_DAYS} days. Split into smaller ranges.`,
    });
    return;
  }

  try {
    const tokens = await getStoredTokens();
    if (!tokens) {
      res.json({ synced: 0, imported: 0, jobberCount: 0, warning: "Jobber not connected" });
      return;
    }

    let syncResult;
    try {
      syncResult = await runCalendarSync(startDate, endDate, (req as any).log ?? console);
    } catch (gqlErr: any) {
      (req as any).log?.warn({ err: gqlErr.message }, "Jobber sync-calendar: GraphQL error");
      res.json({
        synced: 0,
        imported: 0,
        jobberCount: 0,
        warning: "Jobber sync unavailable — check the Jobber connection",
      });
      return;
    }

    const { synced, imported, skipped, jobberCount, hitPageLimit } = syncResult;
    const result: Record<string, unknown> = { synced, imported, skipped, jobberCount };
    if (skipped > 0) {
      result.skippedNote = `${skipped} job(s) skipped — missing scheduled time or client/address data`;
    }
    if (hitPageLimit) {
      result.warning = `Result may be incomplete — more than 500 jobs found. Narrow the date range for a complete sync.`;
    }
    res.json(result);
  } catch (err: any) {
    (req as any).log?.error({ err: err.message }, "Jobber sync-calendar: unexpected error");
    res.status(500).json({ error: "Sync failed — please try again" });
  }
});

export default router;

/** Alias used at the callback site — consumes the nonce and returns validity. */
const validateOAuthState = consumeOAuthState;

function consumeOAuthState(state: string): boolean {
  const expiry = pendingOAuthStates.get(state);
  if (expiry === undefined) return false;
  pendingOAuthStates.delete(state);
  return Date.now() < expiry;
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000; // 10 minutes

function generateOAuthState(): string {
  const state = randomBytes(24).toString("hex");
  pendingOAuthStates.set(state, Date.now() + OAUTH_STATE_TTL_MS);
  // Prune any expired entries while we're here
  const now = Date.now();
  for (const [k, exp] of pendingOAuthStates) {
    if (exp < now) pendingOAuthStates.delete(k);
  }
  return state;
}

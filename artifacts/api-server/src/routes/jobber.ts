import { Router } from "express";
import {
  getStoredTokens,
  exchangeCodeForTokens,
  getCallbackUrl,
  syncBookingToJobber,
  jobberGQL,
} from "../services/jobber.js";
import { db } from "@workspace/db";
import { bookingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const JOBBER_AUTH_URL = "https://api.getjobber.com/api/oauth/authorize";

// GET /jobber/redirect-uri — returns the current OAuth callback URL so the
// frontend can display it for copy-paste into the Jobber developer portal
router.get("/jobber/redirect-uri", (req, res) => {
  try {
    res.json({ redirectUri: getCallbackUrl(req.get("host")) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /jobber/status — is Jobber connected?
router.get("/jobber/status", async (req, res) => {
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
    res.json({ connected: true });
  } catch (err: any) {
    res.json({ connected: false, error: err.message });
  }
});

// GET /jobber/auth — kick off OAuth
router.get("/jobber/auth", (req, res) => {
  const clientId = process.env.JOBBER_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: "JOBBER_CLIENT_ID not configured" });
    return;
  }

  let callbackUrl: string;
  try {
    // Use the live request host so this works on dev AND production domains
    callbackUrl = getCallbackUrl(req.get("host"));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "read_clients write_clients read_jobs write_jobs",
  });

  res.redirect(`${JOBBER_AUTH_URL}?${params.toString()}`);
});

// GET /jobber/callback — Jobber redirects here with ?code=
router.get("/jobber/callback", async (req, res) => {
  // Log everything Jobber sends so we can debug
  req.log.info({ query: req.query }, "Jobber OAuth callback received");

  const { code, error, error_description } = req.query as {
    code?: string;
    error?: string;
    error_description?: string;
  };

  if (error) {
    const reason = error_description ? `${error}: ${error_description}` : error;
    req.log.warn({ error, error_description }, "Jobber OAuth error");
    res.redirect(`/?jobber=error&reason=${encodeURIComponent(reason)}`);
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
      <code>${req.protocol}://${req.get("host")}${req.path}</code>
      <p>Raw query params received: <pre>${allParams}</pre></p>
    `);
    return;
  }

  try {
    const redirectUri = getCallbackUrl(req.get("host"));
    await exchangeCodeForTokens(code, redirectUri);
    // Serve a small page that signals the opener via BroadcastChannel then
    // closes itself, so the original dashboard tab updates without a manual
    // refresh (Jobber blocks iframe embedding so we open OAuth in a new tab).
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
  // Fall back to localStorage for browsers that don't support BroadcastChannel
  try {
    localStorage.setItem("jobber_oauth_signal", Date.now().toString());
  } catch (_) {}
  setTimeout(() => window.close(), 1200);
</script>
</body>
</html>`);
  } catch (err: any) {
    console.error("Jobber OAuth callback error:", err);
    // Serve an error page that also signals the opener, then closes
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

// POST /jobber/sync/:bookingId — manually sync one booking to Jobber
router.post("/jobber/sync/:bookingId", async (req, res) => {
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

export default router;

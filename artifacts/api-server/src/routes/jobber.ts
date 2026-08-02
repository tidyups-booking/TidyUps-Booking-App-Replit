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
    res.json({ redirectUri: getCallbackUrl() });
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
    callbackUrl = getCallbackUrl();
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
    await exchangeCodeForTokens(code);
    // Redirect back to the booking app
    res.redirect("/?jobber=connected");
  } catch (err: any) {
    console.error("Jobber OAuth callback error:", err);
    res.redirect(`/?jobber=error&reason=${encodeURIComponent(err.message)}`);
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

  try {
    const jobberRequestId = await syncBookingToJobber(booking);

    // Store the Jobber ID back on the booking
    await db
      .update(bookingsTable)
      .set({ jobberJobId: jobberRequestId })
      .where(eq(bookingsTable.id, bookingId));

    res.json({ success: true, jobberRequestId });
  } catch (err: any) {
    console.error(`Jobber sync failed for booking ${bookingId}:`, err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

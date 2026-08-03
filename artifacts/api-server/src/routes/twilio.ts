import { Router } from "express";
import { randomUUID } from "crypto";
import { addSseClient, removeSseClient, getCallState } from "../services/twilio-stream.js";
import { issueStreamToken } from "../services/stream-tokens.js";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware.js";
import {
  requireTwilioWebhookAuth,
  getVoiceWebhookUrl,
} from "../middlewares/twilioWebhookAuth.js";
import { requireDispatcherAuth } from "../lib/callerRole.js";

const router = Router();

/**
 * GET /twilio/webhook-url — dispatcher only
 * Returns the full voice webhook URL (including the required ?sig= parameter)
 * for pasting into the Twilio Console.
 */
router.get("/twilio/webhook-url", async (req, res) => {
  if (await requireDispatcherAuth(req, res)) return;
  const url = getVoiceWebhookUrl(req);
  if (!url) {
    res.status(503).json({ error: "SESSION_SECRET is not configured" });
    return;
  }
  res.json({ webhookUrl: url });
});

/**
 * POST /twilio/voice
 * Twilio webhook — called when your Twilio number receives a call.
 * Returns TwiML that starts a media stream back to our WebSocket so we can
 * transcribe the caller's audio in real time.
 *
 * Configure the Twilio webhook URL using GET /api/twilio/webhook-url
 * (it includes the required ?sig= authentication parameter).
 */
router.post("/twilio/voice", requireTwilioWebhookAuth, (req, res) => {
  // Use the live request host so the WebSocket URL is correct on dev AND production
  const host = getClerkProxyHost(req) ?? process.env.REPLIT_DEV_DOMAIN;
  if (!host) {
    res.status(500).send("Cannot determine host for WebSocket URL");
    return;
  }

  // Issue a one-time token so only Twilio (which received this TwiML) can open
  // the WebSocket. The token is validated and consumed on the upgrade request.
  const streamToken = issueStreamToken();
  const wsUrl = `wss://${host}/api/twilio/stream?token=${streamToken}`;
  const businessPhone = process.env.BUSINESS_PHONE_NUMBER;

  if (!businessPhone) {
    res.status(500).send("BUSINESS_PHONE_NUMBER not configured");
    return;
  }

  // TwiML: start the media stream for transcription, then dial the business.
  // <Start> is non-blocking so audio is captured while the real call rings through.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="inbound_track" />
  </Start>
  <Dial>${businessPhone}</Dial>
</Response>`;

  res.type("text/xml").send(twiml);
});

/**
 * GET /twilio/transcript
 * Server-Sent Events stream — the browser Live Call Panel subscribes here to
 * receive live transcript chunks as the call progresses.
 *
 * Events:
 *   { type: "call_started" }
 *   { type: "transcript", chunk: "...", full: "..." }
 *   { type: "call_ended",  full: "..." }
 *   { type: "state",       active: bool, transcript: "..." }  (on connect)
 */
router.get("/twilio/transcript", async (req, res) => {
  if (await requireDispatcherAuth(req, res)) return;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send current call state immediately so late-joining clients sync up
  const state = getCallState();
  res.write(`data: ${JSON.stringify({ type: "state", ...state })}\n\n`);

  const client = { id: randomUUID(), res };
  addSseClient(client);

  // Heartbeat every 25 s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeSseClient(client);
  });
});

export default router;

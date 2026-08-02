import { Router } from "express";
import { randomUUID } from "crypto";
import { addSseClient, removeSseClient, getCallState } from "../services/twilio-stream.js";

const router = Router();

/**
 * POST /twilio/voice
 * Twilio webhook — called when your Twilio number receives a call.
 * Returns TwiML that starts a media stream back to our WebSocket so we can
 * transcribe the caller's audio in real time.
 *
 * Set this URL in your Twilio console → Phone Numbers → Manage → your number
 * → "A call comes in" → Webhook → POST → https://<your-domain>/api/twilio/voice
 */
router.post("/twilio/voice", (req, res) => {
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!domain) {
    res.status(500).send("REPLIT_DEV_DOMAIN not set");
    return;
  }

  const wsUrl = `wss://${domain}/api/twilio/stream`;

  // TwiML: start the inbound audio stream, then keep the call alive
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="inbound_track" />
  </Start>
  <Say voice="alice">Thank you for calling 833 Tidyups. Please hold while we connect you.</Say>
  <Pause length="120"/>
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
router.get("/twilio/transcript", (req, res) => {
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
